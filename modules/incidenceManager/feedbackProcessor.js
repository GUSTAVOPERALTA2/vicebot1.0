// vicebot/modules/incidenceManager/feedbackProcessor.js
const incidenciasDB = require('./incidenceDB');

/**
 * detectFeedbackRequest - Detecta si un mensaje que cita una incidencia original
 * contiene palabras o frases indicativas de solicitar retroalimentación.
 *
 * @param {Object} client - El cliente de WhatsApp (debe tener client.keywordsData).
 * @param {Object} message - El mensaje de respuesta que cita el mensaje original.
 * @returns {Promise<boolean>} - Retorna true si se detecta retroalimentación, false en caso contrario.
 */
async function detectFeedbackRequest(client, message) {
  if (!message.hasQuotedMsg) {
    console.log("El mensaje no cita ningún mensaje.");
    return false;
  }
  
  const quotedMessage = await message.getQuotedMessage();
  const responseText = message.body.toLowerCase();
  const feedbackWords = client.keywordsData.retroalimentacion?.palabras || [];
  const feedbackPhrases = client.keywordsData.retroalimentacion?.frases || [];

  let feedbackDetected = false;
  // Buscar coincidencias en frases.
  for (let phrase of feedbackPhrases) {
    if (responseText.includes(phrase.toLowerCase())) {
      feedbackDetected = true;
      break;
    }
  }
  // Si no se detectó mediante frases, buscar coincidencias en palabras.
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
 * extractFeedbackIdentifier - Intenta extraer el UID del mensaje citado.
 * Busca el patrón "(UID: <valor>)". Si no se encuentra, retorna null.
 *
 * @param {Object} quotedMessage - El mensaje citado.
 * @returns {Promise<string|null>} - El UID extraído o null.
 */
async function extractFeedbackIdentifier(quotedMessage) {
  const text = quotedMessage.body;
  // Buscar el patrón "(UID: <valor>)" (por ejemplo, "(UID: abc123-xyz)")
  const regex = /\(UID:\s*([a-z0-9\-]+)\)/i;
  const match = text.match(regex);
  if (match) {
    return match[1];
  }
  console.log("No se encontró UID en el mensaje citado.");
  return null;
}

/**
 * getFeedbackConfirmationMessage - Consulta en la BD la incidencia correspondiente al UID
 * y construye un mensaje de confirmación que incluya la descripción original, el ID y la categoría.
 *
 * @param {string} uniqueId - El UID extraído del mensaje citado.
 * @returns {Promise<string|null>} - El mensaje de confirmación o null si no se encuentra la incidencia.
 */
async function getFeedbackConfirmationMessage(uniqueId) {
  try {
    const incidence = await incidenciasDB.buscarIncidenciaPorUniqueIdAsync(uniqueId);
    if (!incidence) {
      console.log("No se encontró incidencia con UID: " + uniqueId);
      return null;
    }
    const confirmationMessage = `RETROALIMENTACION SOLICITADA PARA:\n` +
      `${incidence.descripcion}\n` +
      `ID: ${incidence.id}\n` +
      `Categoría: ${incidence.categoria}`;
    return confirmationMessage;
  } catch (error) {
    console.error("Error al obtener la incidencia por UID:", error);
    return null;
  }
}

module.exports = { detectFeedbackRequest, extractFeedbackIdentifier, getFeedbackConfirmationMessage };
