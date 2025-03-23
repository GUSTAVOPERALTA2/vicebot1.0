const incidenceDB = require('./incidenceDB');

/**
 * detectFeedbackRequest - Detecta si un mensaje que cita una incidencia original
 * contiene palabras o frases indicativas de solicitar retroalimentación.
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
  // Verificar coincidencia con las frases definidas.
  for (let phrase of feedbackPhrases) {
    if (responseText.includes(phrase.toLowerCase())) {
      feedbackDetected = true;
      break;
    }
  }
  // Si no se detectó con frases, verificar palabra por palabra.
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
 * Se utiliza el id del mensaje citado (metadata) para buscar en la BD.
 *
 * @param {Object} quotedMessage - El mensaje citado.
 * @returns {Promise<string|null>} - El identificador extraído o null.
 */
async function extractFeedbackIdentifier(quotedMessage) {
  if (quotedMessage.id && quotedMessage.id._serialized) {
    console.log("Extrayendo originalMsgId del mensaje citado:", quotedMessage.id._serialized);
    return quotedMessage.id._serialized;
  }
  console.log("No se encontró el id del mensaje citado en la metadata.");
  return null;
}

/**
 * getFeedbackConfirmationMessage - Consulta en la BD la incidencia correspondiente al identificador
 * (usando el campo originalMsgId) y construye un mensaje de confirmación.
 *
 * @param {string} identifier - El identificador extraído (originalMsgId).
 * @returns {Promise<string|null>} - El mensaje de confirmación o null.
 */
async function getFeedbackConfirmationMessage(identifier) {
  const incidence = await incidenceDB.buscarIncidenciaPorOriginalMsgIdAsync(identifier);
  if (!incidence) {
    console.log("No se encontró incidencia con originalMsgId: " + identifier);
    return null;
  }
  const confirmationMessage = `RETROALIMENTACION SOLICITADA PARA:\n` +
    `${incidence.descripcion}\n` +
    `ID: ${incidence.id}\n` +
    `Categoría: ${incidence.categoria}`;
  return confirmationMessage;
}

module.exports = { detectFeedbackRequest, extractFeedbackIdentifier, getFeedbackConfirmationMessage };
