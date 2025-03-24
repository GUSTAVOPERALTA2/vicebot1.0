// vicebot/modules/messageManager/messageHandler.js
const { handleCommands } = require('./commandsHandler');
const { handleIncidence } = require('../../modules/incidenceManager/incidenceHandler');
const { 
  detectFeedbackRequest, 
  extractFeedbackIdentifier, 
  getFeedbackConfirmationMessage,
  processFeedbackResponse 
} = require('../../modules/incidenceManager/feedbackProcessor');
const { sendFeedbackRequestToGroups } = require('../../modules/incidenceManager/feedbackNotifier');
const incidenceDB = require('../../modules/incidenceManager/incidenceDB');

async function handleMessage(client, message) {
  try {
    const chat = await message.getChat();

    // Si el mensaje cita otro, verificamos si se solicita retroalimentación
    if (message.hasQuotedMsg) {
      const isFeedback = await detectFeedbackRequest(client, message);
      if (isFeedback) {
        const quotedMessage = await message.getQuotedMessage();
        const identifier = await extractFeedbackIdentifier(quotedMessage);
        if (identifier) {
          let incidence;
          if (/^\d+$/.test(identifier)) {
            // Si el identificador es numérico, buscamos por id
            incidence = await new Promise((resolve, reject) => {
              incidenceDB.getIncidenciaById(identifier, (err, row) => {
                if (err) return reject(err);
                resolve(row);
              });
            });
          } else {
            // De lo contrario, buscamos por originalMsgId
            incidence = await incidenceDB.buscarIncidenciaPorOriginalMsgIdAsync(identifier);
          }
          if (incidence) {
            // En este punto, reenviamos la solicitud de retroalimentación a los grupos involucrados
            await sendFeedbackRequestToGroups(client, incidence);
            // Además, se puede optar por responder al solicitante con la información básica de la incidencia
            const feedbackMsg = await getFeedbackConfirmationMessage(identifier);
            await chat.sendMessage("Se ha reenviado su solicitud de retroalimentación a los equipos correspondientes.\n" + (feedbackMsg || ""));
          } else {
            await chat.sendMessage("No se encontró información de la incidencia para retroalimentación.");
          }
        } else {
          await chat.sendMessage("No se pudo extraer el identificador de la incidencia citada.");
        }
        return; // Detenemos el procesamiento si se ha manejado la retroalimentación
      }
    }

    // Si el mensaje inicia con '/' se procesa como comando
    if (message.body && message.body.trim().startsWith('/')) {
      console.log(`Comando detectado: ${message.body.trim()}`);
      const handled = await handleCommands(client, message);
      if (handled) return;
    }

    // Si no es comando, se procesa como incidencia
    await handleIncidence(client, message);
  } catch (err) {
    console.error("Error en handleMessage:", err);
  }
}

module.exports = handleMessage;

