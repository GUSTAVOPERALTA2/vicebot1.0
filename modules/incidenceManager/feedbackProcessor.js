const incidenceDB = require('./incidenceDB');
const moment = require('moment');
const config = require('../../config/config');
const { processConfirmation } = require('./confirmationProcessor'); // Se delega confirmación parcial

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
 * En mensajes de retroalimentación se espera el formato:
 * "SOLICITUD DE RETROALIMENTACION PARA LA TAREA {número}:"
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
  
  // Intentar extraer el ID usando el patrón de retroalimentación
  let cleanedText = text.trim().replace(/^\*/, "").toLowerCase();
  if (cleanedText.startsWith("solicitud de retroalimentacion para la tarea")) {
    const regex = /solicitud de retroalimentacion para la tarea\s*(\d+):/i;
    const match = cleanedText.match(regex);
    if (match) {
      console.log("Identificador extraído del mensaje de retroalimentación:", match[1]);
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
 * Devuelve "confirmacion", "feedback" o "none".
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
    if (normalizedText.includes(palabra.toLowerCase())) return "feedback";
  }
  for (let frase of fbRespFrases) {
    if (normalizedText.includes(frase.toLowerCase())) return "feedback";
  }
  return "none";
}

/**
 * processFeedbackResponse - Procesa la respuesta de retroalimentación del solicitante.
 * Registra en el historial y, si es confirmación, marca la incidencia como completada.
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
  } else if (responseType === "feedback") {
    return "Su retroalimentación ha sido registrada.";
  } else {
    return "No se reconoció un tipo de respuesta válido.";
  }
}

/**
 * determineTeamFromGroup - Determina el equipo a partir del grupo de donde se envía el mensaje,
 * utilizando los identificadores definidos en la configuración.
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
 * processTeamFeedbackResponse - Procesa la respuesta enviada en los grupos destino (por el equipo).
 * Si se detecta confirmación, delega en processConfirmation.
 * En caso de feedback, registra la respuesta y envía el siguiente mensaje al grupo principal:
 *
 * RESPUESTA DE RETROALIMENTACION, EQUIPO {EQUIPO}
 * {incidencia.descripcion}
 *
 * EL EQUIPO RESPONDE:
 * {mensaje de respuesta}
 */
async function processTeamFeedbackResponse(client, message) {
  // Detectar el tipo de respuesta
  const responseType = detectResponseType(client, message.body);
  if (responseType === "confirmacion") {
    console.log("Respuesta es confirmación, delegando a processConfirmation.");
    return processConfirmation(client, message);
  }
  
  if (!message.hasQuotedMsg) {
    console.log("El mensaje del equipo no cita ningún mensaje de solicitud.");
    return "El mensaje no cita la solicitud de retroalimentación.";
  }
  const quotedMessage = await message.getQuotedMessage();
  
  // Limpiar el texto citado (quitar asteriscos y espacios iniciales)
  let cleanedQuotedText = quotedMessage.body.trim().replace(/^\*/, "").toLowerCase();
  if (!cleanedQuotedText.startsWith("solicitud de retroalimentacion para la tarea")) {
    console.log("El mensaje citado no corresponde a una solicitud de retroalimentación.");
    return "El mensaje citado no es una solicitud válida de retroalimentación.";
  }
  
  // Extraer el ID usando el patrón de retroalimentación
  const regex = /solicitud de retroalimentacion para la tarea\s*(\d+):/i;
  const match = cleanedQuotedText.match(regex);
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
  
  const team = await determineTeamFromGroup(message);
  
  // Registrar la respuesta en el historial
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
  
  // Enviar mensaje de feedback al grupo principal con el formato requerido
  const mainGroupChat = await client.getChatById(config.groupPruebaId);
  const feedbackMsg = `RESPUESTA DE RETROALIMENTACION, EQUIPO ${team.toUpperCase()}\n` +
                      `${incidence.descripcion}\n\n` +
                      `EL EQUIPO RESPONDE:\n${message.body}`;
  await mainGroupChat.sendMessage(feedbackMsg);
  console.log("Mensaje de feedback enviado:", feedbackMsg);
  return "Feedback del equipo registrado y notificado correctamente.";
}

/**
 * getFeedbackConfirmationMessage - Consulta en la BD la incidencia y construye un mensaje de retroalimentación.
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
 * detectRetroRequest - Detecta si un mensaje es una solicitud de retroalimentación usando la categoría "retro".
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
 * processRetroRequest - Procesa la solicitud de retroalimentación para la categoría "retro".
 * Envía la solicitud a cada grupo destino correspondiente según las categorías de la incidencia.
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
  // Enviar solicitud a cada grupo según las categorías de la incidencia
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

//nuevo feedback