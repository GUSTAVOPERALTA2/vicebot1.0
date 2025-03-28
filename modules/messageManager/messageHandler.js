const { handleCommands } = require('./commandsHandler');
const { handleIncidence } = require('../../modules/incidenceManager/incidenceHandler');
const { 
  detectRetroRequest,
  processRetroRequest,
  processTeamFeedbackResponse
} = require('../../modules/incidenceManager/feedbackProcessor');
const incidenceDB = require('../../modules/incidenceManager/incidenceDB');

async function handleMessage(client, message) {
  try {
    const chat = await message.getChat();
    
    if (message.hasQuotedMsg) {
      const quotedMessage = await message.getQuotedMessage();
      const quotedText = quotedMessage.body.toLowerCase();
      
      // Si se está respondiendo a una solicitud de retroalimentación, procesar como respuesta del equipo
      if (quotedText.startsWith("*solicitud de retroalimentacion para la tarea")) {
          await processTeamFeedbackResponse(client, message);
          return;
      }
      
      // Si no es respuesta a solicitud de retro, pero el mensaje contiene palabras clave de retro, se procesa la solicitud de retroalimentación
      const isRetro = await detectRetroRequest(client, message);
      if (isRetro) {
          await processRetroRequest(client, message);
          return;
      }
    }
    
    if (message.body && message.body.trim().startsWith('/')) {
      console.log(`Comando detectado: ${message.body.trim()}`);
      const handled = await handleCommands(client, message);
      if (handled) return;
    }
    
    await handleIncidence(client, message);
  } catch (err) {
    console.error("Error en handleMessage:", err);
  }
}

module.exports = handleMessage;

//hola