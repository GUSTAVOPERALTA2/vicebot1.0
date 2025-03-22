const { handleCommands } = require('./commandsHandler');
const { handleIncidence } = require('../../modules/incidenceManager/incidenceHandler');

async function handleMessage(client, message) {
  try {
    if (message.body) {
      const trimmedBody = message.body.trim();
      // Si el mensaje comienza con '/', es un comando
      if (trimmedBody.startsWith('/')) {
        console.log(`Comando detectado: ${trimmedBody}`);
        const handled = await handleCommands(client, message);
        if (handled) return;
      }
    }
    // Si no es comando, se procesa como incidencia
    await handleIncidence(client, message);
  } catch (err) {
    console.error("Error en handleMessage:", err);
  }
}

module.exports = handleMessage;

//NUEVO