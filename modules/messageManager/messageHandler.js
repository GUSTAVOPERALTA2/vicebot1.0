// vicebot/modules/messageManager/messageHandler.js
const { handleCommands } = require('./commandsHandler');
const { handleIncidence } = require('../../modules/incidenceManager/incidenceHandler');
const { detectFeedbackRequest, extractFeedbackIdentifier, getFeedbackConfirmationMessage } = require('../../modules/incidenceManager/feedbackProcessor');

async function handleMessage(client, message) {
  try {
    const chat = await message.getChat();

    // Primero, verificar si el mensaje cita otro mensaje y se solicita retroalimentación.
    if (message.hasQuotedMsg) {
      const isFeedback = await detectFeedbackRequest(client, message);
      if (isFeedback) {
        const quotedMessage = await message.getQuotedMessage();
        const uid = await extractFeedbackIdentifier(quotedMessage);
        if (uid) {
          const feedbackMsg = await getFeedbackConfirmationMessage(uid);
          if (feedbackMsg) {
            await chat.sendMessage(feedbackMsg);
          } else {
            await chat.sendMessage("No se encontró información de la incidencia para retroalimentación.");
          }
        } else {
          await chat.sendMessage("No se pudo extraer el UID de la incidencia citada.");
        }
        return; // Se detiene el procesamiento, ya que se manejó la retroalimentación.
      }
    }

    // Si el mensaje inicia con '/' se trata como comando.
    if (message.body) {
      const trimmedBody = message.body.trim();
      if (trimmedBody.startsWith('/')) {
        console.log(`Comando detectado: ${trimmedBody}`);
        const handled = await handleCommands(client, message);
        if (handled) return;
      }
    }
    // Si no es comando, se procesa como incidencia.
    await handleIncidence(client, message);
  } catch (err) {
    console.error("Error en handleMessage:", err);
  }
}

module.exports = handleMessage;
