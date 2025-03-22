// modules/messageHandler.js
const { handleCommands } = require('./commandsHandler');
const { handleIncidence } = require('./incidenceHandler');

async function handleMessage(client, message) {
  try {
    if (message.body) {
      const trimmedBody = message.body.trim();
      // Detectamos si el mensaje es un comando
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


//Comando detectado
