const incidenceDB = require('./incidenceDB');
const moment = require('moment');

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
  
  // Si el mensaje contiene "Detalles de la incidencia", se asume que es el generado por /tareaDetalles.
  if (text.includes("Detalles de la incidencia")) {
    const regex = /Detalles de la incidencia\s*\(ID:\s*(\d+)\)/i;
    const match = text.match(regex);
    if (match) {
      console.log("Identificador numérico encontrado en mensaje de detalles:", match[1]);
      return match[1];
    }
  }
  
  // En otro caso, se usa la metadata (originalMsgId) del mensaje citado.
  if (quotedMessage.id && quotedMessage.id._serialized) {
    console.log("Extrayendo identificador del mensaje citado (metadata):", quotedMessage.id._serialized);
    return quotedMessage.id._serialized;
  }
  
  console.log("No se encontró identificador en el mensaje citado.");
  return null;
}

/**
 * getFeedbackConfirmationMessage - Consulta en la BD la incidencia correspondiente
 * al identificador (ya sea numérico o el originalMsgId) y construye un mensaje de confirmación.
 * 
 * Si la incidencia tiene un objeto de confirmaciones (para múltiples categorías):
 *  - Si aún quedan categorías pendientes, devuelve un mensaje de retroalimentación parcial,
 *    indicando qué categorías han confirmado y cuáles están pendientes, junto con el tiempo transcurrido.
 *  - Si todas las confirmaciones se han recibido, devuelve un mensaje final indicando que la tarea ha sido completada,
 *    mostrando la fecha de creación, la fecha de finalización (hora actual) y el tiempo activo.
 *
 * Si no hay confirmaciones múltiples, devuelve la retroalimentación básica.
 *
 * @param {string} identifier - El identificador extraído.
 * @returns {Promise<string|null>} - El mensaje de confirmación o null si no se encuentra la incidencia.
 */
async function getFeedbackConfirmationMessage(identifier) {
  let incidence;
  if (/^\d+$/.test(identifier)) {
    // Es numérico: buscar por id.
    incidence = await new Promise((resolve, reject) => {
      incidenceDB.getIncidenciaById(identifier, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  } else {
    // Buscar por originalMsgId.
    incidence = await incidenceDB.buscarIncidenciaPorOriginalMsgIdAsync(identifier);
  }
  if (!incidence) {
    console.log("No se encontró incidencia con el identificador: " + identifier);
    return null;
  }
  
  // Si la incidencia tiene confirmaciones múltiples (un objeto con más de una clave)
  if (incidence.confirmaciones && typeof incidence.confirmaciones === "object") {
    const keys = Object.keys(incidence.confirmaciones);
    const confirmed = keys.filter(key => incidence.confirmaciones[key] !== false);
    const pending = keys.filter(key => incidence.confirmaciones[key] === false);
    
    if (pending.length > 0) {
      const creationTime = moment(incidence.fechaCreacion);
      const now = moment();
      const duration = moment.duration(now.diff(creationTime));
      const days = Math.floor(duration.asDays());
      const hours = duration.hours();
      const minutes = duration.minutes();
      const durationStr = `${days} día(s), ${hours} hora(s), ${minutes} minuto(s)`;
      const partialMessage = `RETROALIMENTACION PARCIAL:\n` +
        `Incidencia: ${incidence.descripcion}\n` +
        `ID: ${incidence.id}\n` +
        `Categorías confirmadas: ${confirmed.join(", ") || "ninguna"}\n` +
        `Categorías pendientes: ${pending.join(", ") || "ninguna"}\n` +
        `Tiempo transcurrido: ${durationStr}`;
      return partialMessage;
    } else {
      const creationTime = moment(incidence.fechaCreacion);
      const completionTime = moment();
      const duration = moment.duration(completionTime.diff(creationTime));
      const days = Math.floor(duration.asDays());
      const hours = duration.hours();
      const minutes = duration.minutes();
      const durationStr = `${days} día(s), ${hours} hora(s), ${minutes} minuto(s)`;
      const finalMessage = `ESTA TAREA HA SIDO COMPLETADA.\n` +
        `Fecha de creación: ${incidence.fechaCreacion}\n` +
        `Fecha de finalización: ${completionTime.format("YYYY-MM-DD HH:mm")}\n` +
        `Tiempo activo: ${durationStr}`;
      return finalMessage;
    }
  }
  
  // Si no hay confirmaciones múltiples, enviar retroalimentación básica.
  const basicMessage = `RETROALIMENTACION SOLICITADA PARA:\n` +
    `${incidence.descripcion}\n` +
    `ID: ${incidence.id}\n` +
    `Categoría: ${incidence.categoria}`;
  return basicMessage;
}

module.exports = { detectFeedbackRequest, extractFeedbackIdentifier, getFeedbackConfirmationMessage };
