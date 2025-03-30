const incidenceDB = require('./incidenceDB');
const moment = require('moment');
const config = require('../../config/config');

/**
 * detectFeedbackRequest - Detecta si un mensaje que cita una incidencia
 * contiene palabras o frases indicativas de solicitar retroalimentación.
 */
async function detectFeedbackRequest(client, message) {
  if (!message.hasQuotedMsg) {
    console.log("El mensaje no cita ningún mensaje.");
    return false;
  }
  const responseText = message.body.toLowerCase();
  const feedbackWords = client.keywordsData.respuestas.feedback?.palabras || [];
  const feedbackPhrases = client.keywordsData.respuestas.feedback?.frases || [];
  let feedbackDetected = false;
  for (let phrase of feedbackPhrases) {
    if (responseText.includes(phrase.toLowerCase())) {
      feedbackDetected = true;
      break;
    }
  }
  if (!feedbackDetected) {
    const responseWords = new Set(responseText.split(/\s+/));
    for (let word of feedbackWords) {
      if (responseWords.has(word.toLowerCase())) {
        feedbackDetected = true;
        break;
      }
    }
  }
  console.log(feedbackDetected 
    ? "Retroalimentación detectada en el mensaje de respuesta." 
    : "No se detectó retroalimentación en el mensaje de respuesta.");
  return feedbackDetected;
}

/**
 * extractFeedbackIdentifier - Extrae el identificador a partir del mensaje citado.
 * Si el mensaje citado proviene del comando /tareaDetalles (contiene "Detalles de la incidencia"),
 * se extrae el id numérico del texto; de lo contrario, se utiliza la metadata (originalMsgId).
 */
async function extractFeedbackIdentifier(quotedMessage) {
  const text = quotedMessage.body;
  console.log("Texto del mensaje citado:", text);
  if (text.includes("Detalles de la incidencia")) {
    const regex = /Detalles de la incidencia\s*\(ID:\s*(\d+)\)/i;
    const match = text.match(regex);
    if (match) {
      console.log("Identificador numérico encontrado en mensaje de detalles:", match[1]);
      return match[1];
    }
  }
  if (quotedMessage.id && quotedMessage.id._serialized) {
    console.log("Extrayendo identificador del mensaje citado (metadata):", quotedMessage.id._serialized);
    return quotedMessage.id._serialized;
  }
  console.log("No se encontró identificador en el mensaje citado.");
  return null;
}

/**
 * detectResponseType - Determina el tipo de respuesta a partir del texto.
 */
function detectResponseType(client, text) {
  const normalizedText = text.trim().toLowerCase();
  const confPalabras = client.keywordsData.respuestas.confirmacion?.palabras || [];
  const confFrases = client.keywordsData.respuestas.confirmacion?.frases || [];
  const fbRespPalabras = client.keywordsData.respuestas.feedback?.palabras || [];
  const fbRespFrases = client.keywordsData.respuestas.feedback?.frases || [];
  if (confPalabras.includes(normalizedText)) return "confirmacion";
  for (let frase of confFrases) {
    if (normalizedText.includes(frase.toLowerCase())) return "confirmacion";
  }
  for (let palabra of fbRespPalabras) {
    if (normalizedText.includes(palabra.toLowerCase())) return "feedbackrespuesta";
  }
  for (let frase of fbRespFrases) {
    if (normalizedText.includes(frase.toLowerCase())) return "feedbackrespuesta";
  }
  return "none";
}

/**
 * processFeedbackResponse - Procesa la respuesta de retroalimentación del solicitante.
 * Siempre guarda el registro en el historial, luego:
 * - Si es confirmación, actualiza la incidencia a "completada".
 * - Si es feedback, solo registra el feedback.
 */
async function processFeedbackResponse(client, message, incidence) {
  const responseText = message.body;
  const responseType = detectResponseType(client, responseText);
  const record = {
    usuario: message.author || message.from,
    comentario: responseText,
    fecha: new Date().toISOString(),
    equipo: "solicitante",
    tipo: responseType
  };
  await new Promise((resolve, reject) => {
    incidenceDB.updateFeedbackHistory(incidence.id, record, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
  if (responseType === "confirmacion") {
    return new Promise((resolve, reject) => {
      incidenceDB.updateIncidenciaStatus(incidence.id, "completada", async (err) => {
        if (err) return reject(err);
        const creationTime = moment(incidence.fechaCreacion);
        const completionTime = moment();
        const duration = moment.duration(completionTime.diff(creationTime));
        const days = Math.floor(duration.asDays());
        const hours = duration.hours();
        const minutes = duration.minutes();
        const finalMsg = `ESTA TAREA HA SIDO COMPLETADA.\nFecha de creación: ${incidence.fechaCreacion}\nFecha de finalización: ${completionTime.format("YYYY-MM-DD HH:mm")}\nTiempo activo: ${days} día(s), ${hours} hora(s), ${minutes} minuto(s)`;
        resolve(finalMsg);
      });
    });
  } else if (responseType === "feedbackrespuesta") {
    return "Su retroalimentación ha sido registrada.";
  } else {
    return "No se reconoció un tipo de respuesta válido.";
  }
}

/**
 * determineTeamFromGroup - Determina el equipo a partir del grupo de donde se envía el mensaje,
 * usando los identificadores definidos en la configuración.
 */
async function determineTeamFromGroup(message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;
  if (chatId === config.groupBotDestinoId) {
    return "it";
  } else if (chatId === config.groupMantenimientoId) {
    return "man";
  } else if (chatId === config.groupAmaId) {
    return "ama";
  }
  return "desconocido";
}

/**
 * processTeamFeedbackResponse - Procesa la respuesta de retroalimentación enviada
 * en los grupos destino (por el equipo).
 * Siempre guarda el registro en el historial.
 * Cada equipo puede responder con confirmación o feedback.
 * Luego se envía un mensaje parcial al grupo principal que muestra:
 * - Los equipos que han confirmado.
 * - Los equipos que han enviado feedback (con sus comentarios).
 * - El estado parcial de la tarea.
 */
async function processTeamFeedbackResponse(client, message) {
  if (!message.hasQuotedMsg) {
    console.log("El mensaje del equipo no cita ningún mensaje de solicitud.");
    return "El mensaje no cita la solicitud de retroalimentación.";
  }
  const quotedMessage = await message.getQuotedMessage();
  const quotedText = quotedMessage.body;
  if (!quotedText.toLowerCase().startsWith("*solicitud de retroalimentacion para la tarea")) {
    console.log("El mensaje citado no corresponde a una solicitud de retroalimentación.");
    return "El mensaje citado no es una solicitud válida de retroalimentación.";
  }
  const regex = /\*SOLICITUD DE RETROALIMENTACION PARA LA TAREA\s+(\d+):\*/i;
  const match = quotedText.match(regex);
  if (!match) {
    console.log("No se pudo extraer el ID de la incidencia del mensaje citado.");
    return "No se pudo extraer el ID de la incidencia del mensaje citado.";
  }
  const incidenceId = match[1];
  console.log("ID extraído del mensaje citado:", incidenceId);
  
  let incidence = await new Promise((resolve, reject) => {
    incidenceDB.getIncidenciaById(incidenceId, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
  if (!incidence) {
    console.log("No se encontró la incidencia con el ID:", incidenceId);
    return "No se encontró la incidencia correspondiente.";
  }
  
  const responseType = detectResponseType(client, message.body);
  const team = await determineTeamFromGroup(message);
  
  // Registrar la respuesta (ya sea confirmación o feedback) en el historial
  const record = {
    usuario: message.author || message.from,
    comentario: message.body,
    fecha: new Date().toISOString(),
    equipo: team,
    tipo: responseType
  };
  await new Promise((resolve, reject) => {
    incidenceDB.updateFeedbackHistory(incidence.id, record, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
  
  // Si es confirmación, actualizar solo la confirmación para ese equipo
  if (responseType === "confirmacion") {
    let updatedConfirmations = {};
    if (incidence.confirmaciones && typeof incidence.confirmaciones === "object") {
      updatedConfirmations = { ...incidence.confirmaciones, [team]: new Date().toISOString() };
    } else {
      updatedConfirmations = { [team]: new Date().toISOString() };
    }
    await new Promise((resolve, reject) => {
      incidenceDB.updateConfirmaciones(incidence.id, JSON.stringify(updatedConfirmations), (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  
  // Recuperar el estado actualizado de la incidencia
  let updatedIncidence = await new Promise((resolve, reject) => {
    incidenceDB.getIncidenciaById(incidence.id, (err, row) => {
      if (err) return reject(err);
      // Parsear confirmaciones y feedbackHistory
      if (row.confirmaciones) {
        try { row.confirmaciones = JSON.parse(row.confirmaciones); } catch (e) { row.confirmaciones = {}; }
      } else { row.confirmaciones = {}; }
      if (row.feedbackHistory) {
        try { row.feedbackHistory = JSON.parse(row.feedbackHistory); } catch (e) { row.feedbackHistory = []; }
      } else { row.feedbackHistory = []; }
      resolve(row);
    });
  });
  
  // Determinar equipos requeridos a partir de la incidencia (categorías separadas por coma)
  const requiredTeams = updatedIncidence.categoria.split(',').map(c => c.trim().toLowerCase());
  const confirmedTeams = Object.keys(updatedIncidence.confirmaciones);
  
  // Agregar feedback recibido, agrupando por equipo (tomando el último feedback de cada equipo)
  const feedbackByTeam = {};
  updatedIncidence.feedbackHistory.forEach(r => {
    if (requiredTeams.includes(r.equipo) && r.tipo === "feedbackrespuesta") {
      feedbackByTeam[r.equipo] = r.comentario;
    }
  });
  
  // Si no se han confirmado todos los equipos, enviar mensaje parcial
  if (confirmedTeams.length < requiredTeams.length) {
    const displayNamesMapping = { it: "IT", man: "MANTENIMIENTO", ama: "AMA" };
    const confirmedDisplay = confirmedTeams.map(t => displayNamesMapping[t] || t.toUpperCase()).join(', ') || "Ninguno";
    let feedbackDisplay = "";
    const pendingTeams = requiredTeams.filter(t => !confirmedTeams.includes(t));
    pendingTeams.forEach(t => {
      if (feedbackByTeam[t]) {
        feedbackDisplay += `${displayNamesMapping[t] || t.toUpperCase()}: "${feedbackByTeam[t]}"\n`;
      }
    });
    const mainGroupChat = await client.getChatById(config.groupPruebaId);
    const partialMsg = `*ATENCIÓN TAREA ${updatedIncidence.id}*\n${updatedIncidence.descripcion}\nConfirmación recibida: ${confirmedDisplay}\nFeedback recibido:\n${feedbackDisplay || "Ninguno"}\nLa tarea permanece pendiente (${confirmedTeams.length} de ${requiredTeams.length} equipos).`;
    await mainGroupChat.sendMessage(partialMsg);
    return "Confirmación/Feedback parcial procesado.";
  } else {
    // Si todos los equipos han confirmado, marcar la incidencia como completada
    return new Promise((resolve, reject) => {
      incidenceDB.updateIncidenciaStatus(updatedIncidence.id, "completada", async (err) => {
        if (err) return reject(err);
        const mainGroupChat = await client.getChatById(config.groupPruebaId);
        const completeMsg = `RESPUESTA A RETROALIMENTACION PARA LA TAREA ${updatedIncidence.id}:\n${updatedIncidence.descripcion}\nTODOS LOS EQUIPOS HAN CONFIRMADO.`;
        await mainGroupChat.sendMessage(completeMsg);
        resolve("Confirmación completa procesada.");
      });
    });
  }
}

/**
 * getFeedbackConfirmationMessage - Consulta en la BD la incidencia correspondiente
 * al identificador y construye un mensaje de retroalimentación.
 */
async function getFeedbackConfirmationMessage(identifier) {
  let incidence;
  if (/^\d+$/.test(identifier)) {
    incidence = await new Promise((resolve, reject) => {
      incidenceDB.getIncidenciaById(identifier, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  } else {
    incidence = await incidenceDB.buscarIncidenciaPorOriginalMsgIdAsync(identifier);
  }
  if (!incidence) {
    console.log("No se encontró incidencia con el identificador: " + identifier);
    return null;
  }
  if (incidence.estado.toLowerCase() === "completada") {
    const creationTime = moment(incidence.fechaCreacion);
    const completionTime = moment();
    const duration = moment.duration(completionTime.diff(creationTime));
    const days = Math.floor(duration.asDays());
    const hours = duration.hours();
    const minutes = duration.minutes();
    return `ESTA TAREA HA SIDO COMPLETADA.\nFecha de creación: ${incidence.fechaCreacion}\nFecha de finalización: ${completionTime.format("YYYY-MM-DD HH:mm")}\nTiempo activo: ${days} día(s), ${hours} hora(s), ${minutes} minuto(s)`;
  } else {
    return `RETROALIMENTACION SOLICITADA PARA:\n${incidence.descripcion}\nID: ${incidence.id}\nCategoría: ${incidence.categoria}`;
  }
}

/**
 * detectRetroRequest - Detecta si un mensaje es una solicitud de retroalimentación
 * usando la nueva categoría "retro".
 */
async function detectRetroRequest(client, message) {
  const responseText = message.body.toLowerCase();
  const retroData = client.keywordsData.identificadores.retro;
  if (!retroData) {
    console.log("No existe la categoría 'retro' en las keywords.");
    return false;
  }
  const responseWords = new Set(responseText.split(/\s+/));
  const foundKeyword = retroData.palabras.some(word => responseWords.has(word.toLowerCase()));
  const foundPhrase = retroData.frases.some(phrase => responseText.includes(phrase.toLowerCase()));
  console.log(`Retro: foundKeyword=${foundKeyword}, foundPhrase=${foundPhrase}`);
  return foundKeyword || foundPhrase;
}

/**
 * processRetroRequest - Procesa la solicitud de retroalimentación para la nueva categoría "retro".
 * Verifica que el mensaje cite una incidencia (original o de /tareaDetalles) y envía
 * un mensaje a cada grupo destino correspondiente, en caso de que la incidencia tenga múltiples categorías.
 */
async function processRetroRequest(client, message) {
  const chat = await message.getChat();
  if (!message.hasQuotedMsg) {
    await chat.sendMessage("El mensaje de retroalimentación no hace énfasis en ninguna incidencia.");
    return;
  }
  const quotedMessage = await message.getQuotedMessage();
  const identifier = await extractFeedbackIdentifier(quotedMessage);
  if (!identifier) {
    await chat.sendMessage("No se pudo extraer el identificador de la incidencia citada.");
    return;
  }
  let incidence;
  if (/^\d+$/.test(identifier)) {
    incidence = await new Promise((resolve, reject) => {
      incidenceDB.getIncidenciaById(identifier, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  } else {
    incidence = await incidenceDB.buscarIncidenciaPorOriginalMsgIdAsync(identifier);
  }
  if (!incidence) {
    await chat.sendMessage("No se encontró la incidencia correspondiente.");
    return;
  }
  // Iterar sobre todas las categorías de la incidencia y enviar la solicitud a cada grupo destino
  let categories = incidence.categoria.split(',').map(c => c.trim().toLowerCase());
  let sentToAny = false;
  for (const category of categories) {
    const groupDest = config.destinoGrupos[category];
    if (!groupDest) {
      console.warn(`No se encontró grupo asignado para la categoría: ${category}`);
      continue;
    }
    const retroResponse = `*SOLICITUD DE RETROALIMENTACION PARA LA TAREA ${incidence.id}:*\n` +
                            `${incidence.descripcion}\n` +
                            `Por favor, proporcione sus comentarios`;
    const targetChat = await client.getChatById(groupDest);
    await targetChat.sendMessage(retroResponse);
    sentToAny = true;
  }
  if (sentToAny) {
    // Crear una lista de nombres de equipo para mostrar en el mensaje final
    const displayNamesMapping = { it: "IT", man: "MANTENIMIENTO", ama: "AMA" };
    const displayNamesArray = categories.map(cat => displayNamesMapping[cat] || cat.toUpperCase());
    const displayNamesString = displayNamesArray.join(", ");
    await chat.sendMessage(`Solicitud de retroalimentación para *${displayNamesString}* procesada correctamente. El equipo responderá en breve.`);
  } else {
    await chat.sendMessage("No se encontró grupo asignado para ninguna categoría de la incidencia.");
  }
}

module.exports = { 
  detectFeedbackRequest, 
  extractFeedbackIdentifier, 
  detectResponseType,
  processFeedbackResponse,
  processTeamFeedbackResponse,
  getFeedbackConfirmationMessage,
  detectRetroRequest,
  processRetroRequest
};
//tareas parciales
