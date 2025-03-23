// vicebot/modules/messageManager/messageHandler.js
const { handleCommands } = require('./commandsHandler');
const { handleIncidence } = require('../../modules/incidenceManager/incidenceHandler');
const { 
  detectFeedbackRequest, 
  extractFeedbackIdentifier, 
  getFeedbackConfirmationMessage 
} = require('../../modules/incidenceManager/feedbackProcessor');
const { sendFeedbackRequestToGroups } = require('../../modules/incidenceManager/feedbackNotifier');

// Requerimos incidenceDB para obtener la incidencia (en caso de necesitarlo)
const incidenceDB = require('../../modules/incidenceManager/incidenceDB');

async function handleMessage(client, message) {
  try {
    const chat = await message.getChat();

    // Si el mensaje cita otro y se detecta una solicitud de retroalimentación...
    if (message.hasQuotedMsg) {
      const isFeedback = await detectFeedbackRequest(client, message);
      if (isFeedback) {
        const quotedMessage = await message.getQuotedMessage();
        const identifier = await extractFeedbackIdentifier(quotedMessage);
        if (identifier) {
          const feedbackMsg = await getFeedbackConfirmationMessage(identifier);
          if (feedbackMsg) {
            // Enviar retroalimentación al solicitante
            await chat.sendMessage(feedbackMsg);
            // Luego, notificar a los grupos correspondientes para que aporten su feedback
            let incidence;
            if (/^\d+$/.test(identifier)) {
              // Si el identificador es numérico, buscar por id.
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
            if (incidence) {
              await sendFeedbackRequestToGroups(client, incidence);
            }
          } else {
            await chat.sendMessage("No se encontró información de la incidencia para retroalimentación.");
          }
        } else {
          await chat.sendMessage("No se pudo extraer el identificador de la incidencia citada.");
        }
        return; // Se termina el procesamiento si se manejó la retroalimentación.
      }
    }

    // Procesar comando si el mensaje inicia con '/'
    if (message.body) {
      const trimmedBody = message.body.trim();
      if (trimmedBody.startsWith('/')) {
        console.log(`Comando detectado: ${trimmedBody}`);
        const handled = await handleCommands(client, message);
        if (handled) return;
      }
    }
    // Procesar mensaje como incidencia
    await handleIncidence(client, message);
  } catch (err) {
    console.error("Error en handleMessage:", err);
  }
}

module.exports = handleMessage;
