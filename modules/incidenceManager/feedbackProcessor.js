const incidenceDB = require('./incidenceDB');
const moment = require('moment');
const { sendFeedbackRequestToGroups } = require('./feedbackNotifier');

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
 * detectResponseType - Determina el tipo de respuesta (confirmación o feedback) 
 * a partir del texto recibido, comparándolo con las palabras y frases definidas en el JSON.
 *
 * @param {Object} client - El cliente de WhatsApp (con client.keywordsData).
 * @param {string} text - El texto de la respuesta.
 * @returns {string} - "confirmacion", "feedback" o "none".
 */
function detectResponseType(client, text) {
  const normalizedText = text.trim().toLowerCase();
  const confirmacionPalabras = client.keywordsData.respuestas?.confirmacion?.palabras || [];
  const confirmacionFrases = client.keywordsData.respuestas?.confirmacion?.frases || [];
  const feedbackPalabras = client.keywordsData.respuestas?.feedback?.palabras || [];
  const feedbackFrases = client.keywordsData.respuestas?.feedback?.frases || [];
  
  if (confirmacionPalabras.includes(normalizedText)) {
    return "confirmacion";
  }
  for (let frase of confirmacionFrases) {
    if (normalizedText.includes(frase.toLowerCase())) {
      return "confirmacion";
    }
  }
  for (let palabra of feedbackPalabras) {
    if (normalizedText.includes(palabra.toLowerCase())) {
      return "feedback";
    }
  }
  for (let frase of feedbackFrases) {
    if (normalizedText.includes(frase.toLowerCase())) {
      return "feedback";
    }
  }
  return "none";
}

/**
 * processFeedbackResponse - Procesa la respuesta de feedback.
 * Si la respuesta es de confirmación (por ejemplo, "listo" o "ok"), se actualiza la incidencia a "completada"
 * y se genera un mensaje final con fecha, hora y tiempo activo.
 * Si es feedback (por ejemplo, "avance" o "estado"), se agrega el feedback al historial
 * y se notifica a los grupos involucrados para que envíen su retroalimentación personal.
 *
 * @param {Object} client - El cliente de WhatsApp.
 * @param {Object} message - El mensaje de feedback recibido.
 * @param {Object} incidence - La incidencia correspondiente.
 * @returns {Promise<string>} - Un mensaje resultante a enviar al usuario.
 */
async function processFeedbackResponse(client, message, incidence) {
  const responseText = message.body;
  const responseType = detectResponseType(client, responseText);
  
  if (responseType === "confirmacion") {
    // Actualizar estado a "completada"
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
    // Registrar el feedback en el historial
    const feedbackRecord = {
      usuario: message.author || message.from,
      comentario: responseText,
      fecha: new Date().toISOString()
    };
    return new Promise((resolve, reject) => {
      incidenceDB.updateFeedbackHistory(incidence.id, feedbackRecord, async (err) => {
        if (err) return reject(err);
        // Notificar a los grupos involucrados para que envíen su feedback personal
        await sendFeedbackRequestToGroups(client, incidence);
        resolve("Su retroalimentación ha sido registrada y los equipos han sido notificados.");
      });
    });
  } else {
    return "No se reconoció un tipo de respuesta válido.";
  }
}

/**
 * getFeedbackConfirmationMessage - Consulta en la BD la incidencia correspondiente
 * al identificador (ya sea numérico o el originalMsgId) y construye un mensaje de confirmación.
 *
 * Si la incidencia tiene estado "completada", se devuelve un mensaje final con fechas y tiempo activo;
 * de lo contrario, se devuelve la información básica de la incidencia.
 *
 * @param {string} identifier - El identificador extraído.
 * @returns {Promise<string|null>} - El mensaje de confirmación o null.
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
  getFeedbackConfirmationMessage
};
