// vicebot/modules/incidenceManager/incidenceHandler.js
const config = require('../../config/config');
const { processNewIncidence } = require('./newIncidence');
const { handleFeedbackRequestFromOrigin, processTeamFeedbackResponse } = require('./feedbackProcessor');

async function handleIncidence(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;
  
  // Grupo principal de incidencias (por ejemplo, config.groupPruebaId)
  if (chatId === config.groupPruebaId) {
    // Si el mensaje cita otro, comprobamos si se usan indicadores de "retro"
    if (message.hasQuotedMsg) {
      // Importar la función normalizeText del feedbackProcessor
      const { normalizeText } = require('./feedbackProcessor');
      const normalizedText = normalizeText(message.body);
      const retroPhrases = client.keywordsData.retro?.frases || [];
      const retroWords = client.keywordsData.retro?.palabras || [];
      
      let foundIndicator = false;
      // Revisar frases definidas en "retro"
      for (let phrase of retroPhrases) {
        if (normalizedText.includes(normalizeText(phrase))) {
          foundIndicator = true;
          break;
        }
      }
      // Si no se encontró en las frases, revisar palabra por palabra
      if (!foundIndicator) {
        const responseWords = new Set(normalizedText.split(/\s+/));
        for (let word of retroWords) {
          if (responseWords.has(normalizeText(word))) {
            foundIndicator = true;
            break;
          }
        }
      }
      
      if (foundIndicator) {
        console.log("Indicadores retro detectados, procesando solicitud de feedback.");
        await handleFeedbackRequestFromOrigin(client, message);
        return;
      }else{
        // Si no hay indicadores "retro", se informa al usuario que la forma de contestación no es válida
        await chat.sendMessage("La forma de contestación no es válida para registrar una incidencia. Por favor, envía tu incidencia sin citar un mensaje.");
        return;
      }
    }
    // Si no se detectan indicadores retro, se procesa como nueva incidencia
    await processNewIncidence(client, message);
  
  // Mensajes provenientes de grupos destino
  } else if ([config.groupBotDestinoId, config.groupMantenimientoId, config.groupAmaId].includes(chatId)) {
    await processTeamFeedbackResponse(client, message);
  } else {
    console.log("Mensaje de grupo no gestionado. Se omite.");
  }
}

module.exports = { handleIncidence };
