const { handleCommands } = require('./commandsHandler');
const { handleIncidence } = require('../../modules/incidenceManager/incidenceHandler');
const { 
  detectRetroRequest,
  processRetroRequest,
  processTeamFeedbackResponse
} = require('../../modules/incidenceManager/feedbackProcessor');
const { processCancelation } = require('../../modules/incidenceManager/cancelationProcessor');

async function handleMessage(client, message) {
  try {
    // Primero, intentamos procesar una solicitud de cancelación
    const cancelHandled = await processCancelation(client, message);
    if (cancelHandled) return; // Si se gestionó la cancelación, se detiene el flujo

    const chat = await message.getChat();
    
    if (message.hasQuotedMsg) {
      const quotedMessage = await message.getQuotedMessage();
      const quotedText = quotedMessage.body.toLowerCase();
      
      // Si se está respondiendo a una solicitud de retroalimentación, procesar como respuesta del equipo
      if (quotedText.startsWith("*solicitud de retroalimentacion para la tarea")) {
        await processTeamFeedbackResponse(client, message);
        return;
      }
      
      // Si el mensaje contiene palabras clave de retro, procesar la solicitud de retroalimentación
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
