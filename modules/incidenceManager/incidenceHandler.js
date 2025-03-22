// vicebot/modules/incidenceManager/incidenceHandler.js
const config = require('../../config/config');
const { processNewIncidence } = require('./newIncidence');
const { processConfirmation } = require('./confirmationProcessor');

/**
 * Función principal para manejar incidencias.
 * Según el grupo de origen del mensaje, delega en el procesador de nuevas incidencias
 * o en el de confirmaciones.
 */
async function handleIncidence(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;

  if (chatId === config.groupPruebaId) {
    // Mensaje proveniente del grupo principal: se trata como una nueva incidencia.
    await processNewIncidence(client, message);
  } else if ([config.groupBotDestinoId, config.groupMantenimientoId, config.groupAmaId].includes(chatId)) {
    // Mensaje proveniente de grupos destino: se procesa como confirmación.
    await processConfirmation(client, message);
  } else {
    console.log("Mensaje de grupo no gestionado. Se omite.");
  }
}

module.exports = { handleIncidence };
