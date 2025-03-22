/**
 * detectFeedbackRequest - Detecta si un mensaje que cita un mensaje original de incidencia
 * contiene palabras o frases indicativas de retroalimentación.
 *
 * @param {Object} client - El cliente de WhatsApp (debe incluir client.keywordsData).
 * @param {Object} message - El mensaje de respuesta que cita el mensaje original.
 * @returns {Promise<boolean>} - Retorna true si se detecta retroalimentación, false en caso contrario.
 */
async function detectFeedbackRequest(client, message) {
    // Verificar que el mensaje cita otro mensaje.
    if (!message.hasQuotedMsg) {
      console.log("El mensaje no cita ningún mensaje.");
      return false;
    }
    
    // Obtener el mensaje citado (original de incidencia).
    const quotedMessage = await message.getQuotedMessage();
    // (Opcional) Aquí podrías agregar una validación extra para confirmar que
    // el mensaje citado es efectivamente un mensaje de incidencia original.
  
    // Convertir el contenido del mensaje de respuesta a minúsculas.
    const responseText = message.body.toLowerCase();
  
    // Obtener palabras y frases definidas para retroalimentación desde las keywords.
    const feedbackWords = client.keywordsData.retroalimentacion?.palabras || [];
    const feedbackPhrases = client.keywordsData.retroalimentacion?.frases || [];
  
    // Verificar si alguna de las frases aparece en el texto.
    let feedbackDetected = false;
    for (let phrase of feedbackPhrases) {
      if (responseText.includes(phrase.toLowerCase())) {
        feedbackDetected = true;
        break;
      }
    }
  
    // Si no se detectó mediante frases, verificar palabra por palabra.
    if (!feedbackDetected) {
      const responseWords = new Set(responseText.split(/\s+/));
      for (let word of feedbackWords) {
        if (responseWords.has(word.toLowerCase())) {
          feedbackDetected = true;
          break;
        }
      }
    }
  
    if (feedbackDetected) {
      console.log("Retroalimentación detectada en el mensaje de respuesta.");
    } else {
      console.log("No se detectó retroalimentación en el mensaje de respuesta.");
    }
  
    return feedbackDetected;
  }
  
  module.exports = { detectFeedbackRequest };
  