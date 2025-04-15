const config = require('../../config/config');
const { processNewIncidence } = require('./newIncidence');
const { handleFeedbackRequestFromOrigin, processTeamFeedbackResponse } = require('./feedbackProcessor');
const { processConfirmation } = require('./confirmationProcessor');
// Importamos las funciones necesarias desde stringUtils
const { normalizeText, similarity, adaptiveSimilarityCheck } = require('../../config/stringUtils');

async function handleIncidence(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;

  // Para el grupo principal de incidencias
  if (chatId === config.groupPruebaId) {
    if (message.hasQuotedMsg) {
      const quotedMessage = await message.getQuotedMessage();
      const normalizedQuoted = normalizeText(quotedMessage.body.replace(/\*/g, ''));
      
      // Si el mensaje citado indica confirmación, se procesa de inmediato
      if (normalizedQuoted.startsWith("recordatorio: tarea incompleta") || 
          normalizedQuoted.startsWith("nueva tarea recibida")) {
         console.log("Coincidencia de confirmación detectada.");
         await processConfirmation(client, message);
         return;
      }

      // Procesar solicitudes de retroalimentación
      const normalizedText = normalizeText(message.body);
      let foundIndicator = false;
      const retroPhrases = client.keywordsData.retro?.frases || [];
      const retroWords = client.keywordsData.retro?.palabras || [];
      
      // Compara frases completas primero
      for (let phrase of retroPhrases) {
         const normalizedPhrase = normalizeText(phrase);
         if (normalizedText.includes(normalizedPhrase)) {
            console.log(`Coincidencia en frase: "${phrase}" -> 100%`);
            foundIndicator = true;
            break;
         }
      }
      
      // Si no hubo coincidencia en frases, se evalúan las palabras
      if (!foundIndicator) {
         const responseWords = normalizedText.split(/\s+/);
         for (let keyword of retroWords) {
            const normalizedKeyword = normalizeText(keyword);
            for (let word of responseWords) {
               const sim = similarity(word, normalizedKeyword);
               if (adaptiveSimilarityCheck(word, normalizedKeyword)) {
                  console.log(`Coincidencia: "${word}" vs "${normalizedKeyword}" -> ${(sim * 100).toFixed(2)}%`);
                  foundIndicator = true;
                  break;
               }
            }
            if (foundIndicator) break;
         }
      }
      
      if (foundIndicator) {
         await handleFeedbackRequestFromOrigin(client, message);
         return;
      } else {
         await chat.sendMessage("La forma de contestación no es válida para registrar una incidencia. Por favor, envía tu incidencia sin citar un mensaje.");
         return;
      }
    }
    // Si el mensaje no cita otro, se procesa como nueva incidencia.
    await processNewIncidence(client, message);
    
  } else if ([config.groupBotDestinoId, config.groupMantenimientoId, config.groupAmaId].includes(chatId)) {
    await processTeamFeedbackResponse(client, message);
  } else {
    console.log("Mensaje de grupo no gestionado.");
  }
}

module.exports = { handleIncidence };

//sin tanto log