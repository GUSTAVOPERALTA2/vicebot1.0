const { handleCommands } = require('./commandsHandler');
const { handleIncidence } = require('../../modules/incidenceManager/incidenceHandler');
const { 
  detectFeedbackRequest, 
  extractFeedbackIdentifier, 
  getFeedbackConfirmationMessage,
  processFeedbackResponse
} = require('../../modules/incidenceManager/feedbackProcessor');

const incidenceDB = require('../../modules/incidenceManager/incidenceDB');

async function handleMessage(client, message) {
  try {
    const chat = await message.getChat();

    // Verificar si se cita un mensaje y se detecta solicitud de retroalimentación
    if (message.hasQuotedMsg) {
      const isFeedback = await detectFeedbackRequest(client, message);
      if (isFeedback) {
        const quotedMessage = await message.getQuotedMessage();
        const identifier = await extractFeedbackIdentifier(quotedMessage);
        if (identifier) {
          // Primero, obtener la incidencia según el identificador
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
          if (incidence) {
            // Procesar la respuesta (confirmación o feedback)
            const feedbackResponse = await processFeedbackResponse(client, message, incidence);
            await chat.sendMessage(feedbackResponse);
          } else {
            await chat.sendMessage("No se encontró información de la incidencia para retroalimentación.");
          }
        } else {
          await chat.sendMessage("No se pudo extraer el identificador de la incidencia citada.");
        }
        return; // Detener procesamiento si se manejó la retroalimentación
      }
    }

    // Si el mensaje inicia con '/' se procesa como comando.
    if (message.body) {
      const trimmedBody = message.body.trim();
      if (trimmedBody.startsWith('/')) {
        console.log(`Comando detectado: ${trimmedBody}`);
        const handled = await handleCommands(client, message);
        if (handled) return;
      }
    }
    // Procesar mensaje como incidencia.
    await handleIncidence(client, message);
  } catch (err) {
    console.error("Error en handleMessage:", err);
  }
}

module.exports = handleMessage;
