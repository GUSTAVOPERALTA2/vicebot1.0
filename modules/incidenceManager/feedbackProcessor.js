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
  
  // Si es un mensaje de detalles generado por /tareaDetalles:
  if (text.includes("Detalles de la incidencia")) {
    const regex = /Detalles de la incidencia\s*\(ID:\s*(\d+)\)/i;
    const match = text.match(regex);
    if (match) {
      console.log("Identificador numérico encontrado en mensaje de detalles:", match[1]);
      return match[1];
    }
  }
  
  // En otro caso, se utiliza la metadata (originalMsgId) del mensaje citado.
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
 * Si la respuesta es de confirmación, actualiza la incidencia a "completada".
 * Si es feedback, lo registra en el historial.
 */
async function processFeedbackResponse(client, message, incidence) {
  const responseText = message.body;
  const responseType = detectResponseType(client, responseText);
  
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
    const feedbackRecord = {
      usuario: message.author || message.from,
      comentario: message.body,
      fecha: new Date().toISOString(),
      equipo: "solicitante"
    };
    return new Promise((resolve, reject) => {
      incidenceDB.updateFeedbackHistory(incidence.id, feedbackRecord, (err) => {
        if (err) return reject(err);
        resolve("Su retroalimentación ha sido registrada.");
      });
    });
  } else {
    return "No se reconoció un tipo de respuesta válido.";
  }
}

/**
 * determineTeamFromGroup - Determina el equipo (it, man, ama) a partir del chat del mensaje.
 */
async function determineTeamFromGroup(message) {
  try {
    const chat = await message.getChat();
    const chatId = chat.id._serialized;
    for (const [key, groupId] of Object.entries(config.destinoGrupos)) {
      if (groupId === chatId) {
        return key;
      }
    }
    return "desconocido";
  } catch (error) {
    console.error("Error al determinar el equipo desde el grupo:", error);
    return "desconocido";
  }
}

/**
 * generarComentarios - Genera una sección de comentarios a partir del historial de feedback.
 */
function generarComentarios(incidence, requiredTeams, teamNames) {
  let comentarios = "";
  let feedbackHistory = [];
  try {
    if (typeof incidence.feedbackHistory === "string") {
      feedbackHistory = JSON.parse(incidence.feedbackHistory);
    } else if (Array.isArray(incidence.feedbackHistory)) {
      feedbackHistory = incidence.feedbackHistory;
    }
  } catch (e) {
    feedbackHistory = [];
  }
  for (let team of requiredTeams) {
    const displayName = teamNames[team] || team.toUpperCase();
    // Buscar el último feedback para el equipo
    const record = feedbackHistory.filter(r => r.equipo && r.equipo.toLowerCase() === team).pop();
    const comentario = record && record.comentario ? record.comentario : "Sin comentarios";
    comentarios += `${displayName}: ${comentario}\n`;
  }
  return comentarios;
}

/**
 * processTeamFeedbackResponse - Procesa la respuesta de retroalimentación enviada
 * en los grupos destino (por el equipo) y envía al grupo principal la respuesta.
 * 
 * Si la respuesta es de feedback (no de confirmación), se envía:
 *   RESPUESTA DE RETROALIMENTACION, EQUIPO {EQUIPO}
 *   {incidence.descripcion}
 *   
 *   EL EQUIPO RESPONDE:
 *   {respuesta del equipo}
 * 
 * Si la respuesta es de confirmación, se envía:
 *   ATENCIÓN TAREA EN FASE {fase} de {total equipos}
 *   {incidence.descripcion}
 *   
 *   Tarea terminada por:
 *   {equipo que terminó}
 *   
 *   Equipo(s) que faltan:
 *   {lista de equipos faltantes}
 *   
 *   Comentarios:
 *   {comentarios por equipo}
 *   
 *   ⏱️Tiempo de respuesta: {tiempo}
 */
async function processTeamFeedbackResponse(client, message) {
  if (!message.hasQuotedMsg) {
    console.log("El mensaje del equipo no cita ningún mensaje de solicitud.");
    return "El mensaje no cita la solicitud de retroalimentación.";
  }
  
  const quotedMessage = await message.getQuotedMessage();
  const quotedText = quotedMessage.body;
  
  // Se normaliza el texto a minúsculas y se verifica que contenga el patrón esperado
  const normalizedQuotedText = quotedText.toLowerCase();
  if (!normalizedQuotedText.includes("solicitud de retroalimentacion para la tarea")) {
    console.log("El mensaje citado no corresponde a una solicitud de retroalimentación.");
    return "El mensaje citado no es una solicitud válida de retroalimentación.";
  }
  
  // Regex para extraer el id justo después de "solicitud de retroalimentacion para la tarea"
  const regex = /solicitud de retroalimentacion para la tarea\s*(\d+):/i;
  const match = normalizedQuotedText.match(regex);
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
  
  // Obtenemos el equipo a partir del grupo destino de donde se responde
  const team = await determineTeamFromGroup(message);
  
  const feedbackRecord = {
    usuario: message.author || message.from,
    comentario: message.body,
    fecha: new Date().toISOString(),
    equipo: team
  };
  
  return new Promise((resolve, reject) => {
    incidenceDB.updateFeedbackHistory(incidence.id, feedbackRecord, (err) => {
      if (err) {
        console.error("Error al registrar el feedback:", err);
        return reject("Error al registrar el feedback.");
      }
      console.log(`Feedback registrado para la incidencia ID ${incidence.id}:`, feedbackRecord);
      
      const responseType = detectResponseType(client, message.body);
      let responseMsg = "";
      
      if (responseType === "feedbackrespuesta") {
        // Si es feedback, enviamos el mensaje en formato de retroalimentación
        responseMsg = `RESPUESTA DE RETROALIMENTACION, EQUIPO ${team.toUpperCase()}\n` +
                      `${incidence.descripcion}\n\n` +
                      `EL EQUIPO RESPONDE:\n${message.body}`;
      } else if (responseType === "confirmacion") {
        // Si es confirmación, actualizamos la confirmación para este equipo
        incidence.confirmaciones = incidence.confirmaciones || {};
        incidence.confirmaciones[team] = new Date().toISOString();
        
        const requiredTeams = incidence.categoria.split(',').map(c => c.trim().toLowerCase());
        const teamNames = { it: "IT", man: "MANTENIMIENTO", ama: "AMA" };
        const confirmedTeams = Object.keys(incidence.confirmaciones);
        const totalTeams = requiredTeams.length;
        const missingTeams = requiredTeams.filter(t => !confirmedTeams.includes(t)).map(t => teamNames[t] || t.toUpperCase());
        
        const responseTime = moment().diff(moment(incidence.fechaCreacion));
        const diffDuration = moment.duration(responseTime);
        const diffResponseStr = `${Math.floor(diffDuration.asDays())} día(s), ${diffDuration.hours()} hora(s), ${diffDuration.minutes()} minuto(s)`;
        
        responseMsg = `ATENCIÓN TAREA EN FASE ${confirmedTeams.length} de ${totalTeams}\n` +
                      `${incidence.descripcion}\n\n` +
                      `Tarea terminada por:\n${teamNames[team] || team.toUpperCase()}\n\n` +
                      `Equipo(s) que faltan:\n${missingTeams.length > 0 ? missingTeams.join(", ") : "Ninguno"}\n\n` +
                      `Comentarios:\n${generarComentarios(incidence, requiredTeams, teamNames)}` +
                      `⏱️Tiempo de respuesta: ${diffResponseStr}`;
      }
      
      // Enviar el mensaje al grupo principal
      client.getChatById(config.groupPruebaId)
        .then(mainGroupChat => {
          mainGroupChat.sendMessage(responseMsg)
            .then(() => {
              console.log("Mensaje enviado al grupo principal:", responseMsg);
              resolve("Feedback del equipo registrado correctamente y mensaje enviado al grupo principal.");
            })
            .catch(err => {
              console.error("Error al enviar mensaje al grupo principal:", err);
              resolve("Feedback del equipo registrado correctamente, pero error al enviar mensaje al grupo principal.");
            });
        })
        .catch(err => {
          console.error("Error al obtener chat principal:", err);
          resolve("Feedback del equipo registrado correctamente, pero error al obtener chat principal.");
        });
    });
  });
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
 * Verifica que el mensaje cite una incidencia y envía la solicitud de retroalimentación
 * únicamente a aquellas categorías (equipos) que aún no han marcado la tarea como completada.
 * Envía un mensaje de confirmación al chat de origen listando a qué equipos se envió.
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
  // Se asume que la incidencia tiene una o más categorías separadas por comas.
  const categories = incidence.categoria.split(',').map(c => c.trim().toLowerCase());
  const teamNames = { it: "IT", man: "MANTENIMIENTO", ama: "AMA" };
  let gruposEnviados = [];
  // Enviar la solicitud únicamente a aquellas categorías que aún no han confirmado.
  for (const cat of categories) {
    if (incidence.confirmaciones && incidence.confirmaciones[cat]) {
      console.log(`La categoría ${cat} ya ha confirmado, no se envía retroalimentación.`);
      continue;
    }
    const groupDest = config.destinoGrupos[cat];
    if (!groupDest) {
      console.log(`No se encontró grupo asignado para la categoría: ${cat}`);
      continue;
    }
    const retroResponse = `*SOLICITUD DE RETROALIMENTACION PARA LA TAREA ${incidence.id}:*\n` +
                            `${incidence.descripcion}\n` +
                            `Por favor, proporcione sus comentarios`;
    try {
      const targetChat = await client.getChatById(groupDest);
      await targetChat.sendMessage(retroResponse);
      console.log(`Solicitud de retroalimentación enviada al grupo de ${teamNames[cat] || cat.toUpperCase()}.`);
      gruposEnviados.push(teamNames[cat] || cat.toUpperCase());
    } catch (error) {
      console.error(`Error al enviar retroalimentación al grupo de ${teamNames[cat] || cat.toUpperCase()}:`, error);
    }
  }
  if (gruposEnviados.length > 0) {
    await chat.sendMessage(`Solicitud de retroalimentación procesada correctamente para: *${gruposEnviados.join(", ")}*`);
  } else {
    await chat.sendMessage("No se envió solicitud de retroalimentación, ya que todas las categorías han confirmado.");
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

//processor