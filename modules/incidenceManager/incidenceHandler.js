// vicebot/modules/incidenceManager/incidenceHandler.js
const config = require('../../config/config');
const { processNewIncidence } = require('./newIncidence');
const { processConfirmation } = require('./confirmationProcessor');
const { processTeamFeedbackResponse } = require('./feedbackProcessor');

async function handleIncidence(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;

  if (chatId === config.groupPruebaId) {
    // Mensaje proveniente del grupo principal: se trata como una nueva incidencia.
    await processNewIncidence(client, message);
  } else if ([config.groupBotDestinoId, config.groupMantenimientoId, config.groupAmaId].includes(chatId)) {
    // Mensaje proveniente de grupos destino: diferenciamos entre confirmación y feedback.
    if (message.hasQuotedMsg) {
      const quotedMessage = await message.getQuotedMessage();
      const quotedBodyLower = quotedMessage.body.toLowerCase();
      // Se asume que el mensaje de solicitud de retroalimentación contiene la siguiente cadena:
      if (quotedBodyLower.includes("retroalimentacion solicitada para:")) {
        // Procesa el mensaje como respuesta de feedback del equipo.
        await processTeamFeedbackResponse(client, message);
        return;
      }
    }
    // Si no se detecta la cadena de feedback en el mensaje citado, se procesa como confirmación.
    await processConfirmation(client, message);
  } else {
    console.log("Mensaje de grupo no gestionado. Se omite.");
  }
}

module.exports = { handleIncidence };
//Nuevo