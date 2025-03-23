const incidenceDB = require('./incidenceDB');

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
 * Primero intenta obtener el id del mensaje citado (originalMsgId) de la metadata.
 * Si no se encuentra, busca en el texto patrones típicos (por ejemplo, "Detalles de la incidencia (ID: 10)")
 * o simplemente "ID: 10".
 *
 * @param {Object} quotedMessage - El mensaje citado.
 * @returns {Promise<string|null>} - El identificador extraído o null.
 */
async function extractFeedbackIdentifier(quotedMessage) {
  // Intentar obtener de la metadata.
  if (quotedMessage.id && quotedMessage.id._serialized) {
    console.log("Extrayendo identificador del mensaje citado (metadata):", quotedMessage.id._serialized);
    return quotedMessage.id._serialized;
  }
  const text = quotedMessage.body;
  console.log("Texto del mensaje citado:", text);
  
  // Buscar patrón en mensajes de detalle: "Detalles de la incidencia (ID: <número>)"
  let regex = /Detalles de la incidencia\s*\(ID:\s*(\d+)\)/i;
  let match = text.match(regex);
  if (match) {
    console.log("Identificador numérico encontrado en mensaje de detalles:", match[1]);
    return match[1];
  }
  
  // Fallback: buscar patrón "ID: <número>"
  regex = /ID:\s*(\d+)/i;
  match = text.match(regex);
  if (match) {
    console.log("Identificador numérico encontrado en mensaje citado:", match[1]);
    return match[1];
  }
  
  console.log("No se encontró identificador en el mensaje citado.");
  return null;
}

/**
 * getFeedbackConfirmationMessage - Consulta en la BD la incidencia correspondiente al identificador
 * y construye un mensaje de confirmación con la información del incidente.
 * Si el identificador es numérico, se busca por id; de lo contrario, se busca por originalMsgId.
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
  const confirmationMessage = `RETROALIMENTACION SOLICITADA PARA:\n` +
    `${incidence.descripcion}\n` +
    `ID: ${incidence.id}\n` +
    `Categoría: ${incidence.categoria}`;
  return confirmationMessage;
}

module.exports = { detectFeedbackRequest, extractFeedbackIdentifier, getFeedbackConfirmationMessage };

