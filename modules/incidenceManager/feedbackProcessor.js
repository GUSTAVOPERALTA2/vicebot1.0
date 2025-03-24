const incidenceDB = require('./incidenceDB');
const moment = require('moment');
const config = require('../../config/config');

/**
 * detectFeedbackRequest - Detecta si un mensaje que cita una incidencia
 * contiene palabras o frases indicativas de solicitar retroalimentación.
 *
 * @param {Object} client - El cliente de WhatsApp (con client.keywordsData).
 * @param {Object} message - El mensaje de respuesta que cita otro mensaje.
 * @returns {Promise<boolean>} - True si se detecta retroalimentación; false en caso contrario.
 */
async function detectFeedbackRequest(client, message) {
  if (!message.hasQuotedMsg) {
    console.log("El mensaje no cita ningún mensaje.");
    return false;
  }
  
  const responseText = message.body.toLowerCase();
  const feedbackWords = client.keywordsData.retroalimentacion?.palabras || [];
  const feedbackPhrases = client.keywordsData.retroalimentacion?.frases || [];
  
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
 *
 * @param {Object} quotedMessage - El mensaje citado.
 * @returns {Promise<string|null>} - El identificador extraído o null.
 */
async function extractFeedbackIdentifier(quotedMessage) {
  const text = quotedMessage.body;
  console.log("Texto del mensaje citado:", text);
  
  // Si se detecta que es un mensaje de detalles generado por /tareaDetalles:
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
 * Se revisan tres casos:
 *  - "confirmacion": para respuestas que confirman (ej. "listo", "ok").
 *  - "feedbackrespuesta": para respuestas de retroalimentación de equipos (ej. "estamos en eso", "en proceso").
 *  - "feedback": para feedback general.
 *
 * @param {Object} client - El cliente de WhatsApp (con client.keywordsData).
 * @param {string} text - El texto de la respuesta.
 * @returns {string} - "confirmacion", "feedbackrespuesta", "feedback" o "none".
 */
function detectResponseType(client, text) {
  const normalizedText = text.trim().toLowerCase();
  const confPalabras = client.keywordsData.respuestas?.confirmacion?.palabras || [];
  const confFrases = client.keywordsData.respuestas?.confirmacion?.frases || [];
  const fbRespPalabras = client.keywordsData.respuestas?.retroalimentacionRespuesta?.palabras || [];
  const fbRespFrases = client.keywordsData.respuestas?.retroalimentacionRespuesta?.frases || [];
  const fbPalabras = client.keywordsData.respuestas?.feedback?.palabras || [];
  const fbFrases = client.keywordsData.respuestas?.feedback?.frases || [];
  
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
  for (let palabra of fbPalabras) {
    if (normalizedText.includes(palabra.toLowerCase())) return "feedback";
  }
  for (let frase of fbFrases) {
    if (normalizedText.includes(frase.toLowerCase())) return "feedback";
  }
  return "none";
}

/**
 * processFeedbackResponse - Procesa la respuesta de retroalimentación del solicitante.
 * Si la respuesta es de confirmación, se actualiza la incidencia a "completada" y se genera un mensaje final.
 * Si es feedback (general), se agrega el feedback al historial y se devuelve un mensaje de confirmación.
 *
 * @param {Object} client - El cliente de WhatsApp.
 * @param {Object} message - El mensaje de feedback recibido.
 * @param {Object} incidence - La incidencia correspondiente.
 * @returns {Promise<string>} - Mensaje resultante para enviar al usuario.
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
  } else if (responseType === "feedback") {
    // Feedback general enviado por el solicitante.
    const feedbackRecord = {
      usuario: message.author || message.from,
      comentario: responseText,
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
 * processTeamFeedbackResponse - Procesa la respuesta de retroalimentación enviada por un equipo.
 * Independientemente del contenido, el comentario se registra en el historial de la incidencia
 * y se reenvía al grupo principal.
 *
 * @param {Object} client - El cliente de WhatsApp.
 * @param {Object} message - El mensaje de feedback recibido en el grupo del equipo.
 * @returns {Promise<string>} - Mensaje de confirmación.
 */
async function processTeamFeedbackResponse(client, message) {
  // Obtener el chat y determinar a qué equipo pertenece el grupo
  const chat = await message.getChat();
  const chatId = chat.id._serialized;
  
  // Determinar el equipo según la configuración
  let team = null;
  for (const [key, groupId] of Object.entries(config.destinoGrupos)) {
    if (groupId === chatId) {
      team = key; // "it", "man", "ama"
      break;
    }
  }
  if (!team) {
    console.log("El mensaje no proviene de un grupo de feedback reconocido.");
    return "No se reconoce el grupo para feedback.";
  }
  
  // Verificar que el mensaje cita una solicitud de retroalimentación
  if (!message.hasQuotedMsg) {
    return "El mensaje no cita una solicitud de retroalimentación.";
  }
  const quotedMessage = await message.getQuotedMessage();
  const identifier = await extractFeedbackIdentifier(quotedMessage);
  if (!identifier) {
    return "No se pudo extraer el identificador de la incidencia.";
  }
  
  // Consultar la incidencia en la BD
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
    return "No se encontró la incidencia correspondiente.";
  }
  
  // Crear el registro de feedback del equipo
  const feedbackRecord = {
    usuario: message.author || message.from,
    comentario: message.body,
    fecha: new Date().toISOString(),
    equipo: team
  };
  
  // Actualizar el historial de feedback en la BD y notificar al grupo principal.
  return new Promise((resolve, reject) => {
    incidenceDB.updateFeedbackHistory(incidence.id, feedbackRecord, async (err) => {
      if (err) return reject(err);
      try {
        const mainChat = await client.getChatById(config.groupPruebaId);
        const feedbackMsg = `Feedback recibido para la incidencia ${incidence.id} del equipo ${team}:\n${message.body}`;
        await mainChat.sendMessage(feedbackMsg);
        resolve("Feedback registrado y notificado al grupo principal.");
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * getFeedbackConfirmationMessage - Consulta en la BD la incidencia correspondiente
 * al identificador (numérico o originalMsgId) y construye un mensaje de retroalimentación.
 *
 * Si la incidencia tiene estado "completada", se devuelve un mensaje final con fechas y tiempo activo;
 * de lo contrario, se devuelve la información básica de la incidencia.
 *
 * @param {string} identifier - El identificador extraído.
 * @returns {Promise<string|null>} - El mensaje de retroalimentación o null.
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
    const durationStr = `${days} día(s), ${hours} hora(s), ${minutes} minuto(s)`;
    return `ESTA TAREA HA SIDO COMPLETADA.\nFecha de creación: ${incidence.fechaCreacion}\nFecha de finalización: ${completionTime.format("YYYY-MM-DD HH:mm")}\nTiempo activo: ${durationStr}`;
  } else {
    return `RETROALIMENTACION SOLICITADA PARA:\n${incidence.descripcion}\nID: ${incidence.id}\nCategoría: ${incidence.categoria}`;
  }
}

module.exports = { 
  detectFeedbackRequest, 
  extractFeedbackIdentifier, 
  detectResponseType,
  processFeedbackResponse,
  processTeamFeedbackResponse,
  getFeedbackConfirmationMessage
};
