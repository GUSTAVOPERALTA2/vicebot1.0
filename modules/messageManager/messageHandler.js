const { handleCommands } = require('./commandsHandler');
const { handleIncidence } = require('../../modules/incidenceManager/incidenceHandler');
const { 
  isRetroRequest, 
  processTeamRetroFeedbackResponse 
} = require('../../modules/incidenceManager/feedbackProcessor');

async function handleMessage(client, message) {
  try {
    const chat = await message.getChat();

    // Si el mensaje cita a otro, verificamos si coincide con la categoría "retro"
    if (message.hasQuotedMsg) {
      const retro = await isRetroRequest(client, message);
      if (retro) {
        const result = await processTeamRetroFeedbackResponse(client, message);
        console.log(result);
        return; // Se detiene el procesamiento si se ha identificado como retro.
      } else {
        console.log("El mensaje citado no coincide con la categoría retro.");
      }
    }

    // Procesar comandos si el mensaje inicia con '/'
    if (message.body && message.body.trim().startsWith('/')) {
      console.log(`Comando detectado: ${message.body.trim()}`);
      const handled = await handleCommands(client, message);
      if (handled) return;
    }

    // Si no es comando, se procesa como incidencia.
    await handleIncidence(client, message);
  } catch (err) {
    console.error("Error en handleMessage:", err);
  }
}

module.exports = handleMessage;
