// vicebot/modules/messageManager/messageHandler.js
const { handleCommands } = require('./commandsHandler');
const { handleIncidence } = require('../../modules/incidenceManager/incidenceHandler');
const { detectFeedbackRequest } = require('../../modules/incidenceManager/feedbackProcessor');

async function handleMessage(client, message) {
  try {
    const chat = await message.getChat();

    // Primero, verificar si el mensaje cita otro mensaje y se solicita retroalimentación.
    if (message.hasQuotedMsg) {
      const isFeedback = await detectFeedbackRequest(client, message);
      if (isFeedback) {
        // Aquí puedes implementar la lógica para obtener y enviar retroalimentación.
        // Por ejemplo, podrías recuperar información de la incidencia y responder con un mensaje.
        await chat.sendMessage("Retroalimentación solicitada: [Aquí se mostrarán los avances o el estado de la tarea].");
        return; // Se retorna para no procesar el mensaje como incidencia o comando.
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
