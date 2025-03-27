const { handleCommands } = require('./commandsHandler');
const { handleIncidence } = require('../../modules/incidenceManager/incidenceHandler');
const { 
  detectRetroRequest,
  processRetroRequest
} = require('../../modules/incidenceManager/feedbackProcessor');
const incidenceDB = require('../../modules/incidenceManager/incidenceDB');

async function handleMessage(client, message) {
  try {
    const chat = await message.getChat();

    // Si el mensaje cita otro, verificamos si es una solicitud de retroalimentación (categoría "retro")
    if (message.hasQuotedMsg) {
      const isRetro = await detectRetroRequest(client, message);
      if (isRetro) {
        await processRetroRequest(client, message);
        return; // Se detiene el procesamiento si se ha manejado la solicitud retro.
      }
    }

    // Si el mensaje inicia con '/' se procesa como comando.
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


