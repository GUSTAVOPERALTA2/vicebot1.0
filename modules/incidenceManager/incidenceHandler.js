// vicebot/modules/incidenceManager/incidenceHandler.js
const config = require('../../config/config');
const { processNewIncidencia } = require('./newIncidencia');
const { processTeamFeedbackResponse } = require('./feedbackProcessor');
const { processConfirmation } = require('./confirmationProcessor');

/**
 * Función auxiliar para normalizar texto: lo recorta y lo pasa a minúsculas.
 */
function normalizeText(text) {
  return text.trim().toLowerCase();
}

async function handleIncidencia(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;
  
  // Grupo principal de incidencias (por ejemplo, config.groupPruebaId)
  if (chatId === config.groupPruebaId) {
    // Si el mensaje proviene del grupo principal y es una respuesta (tiene cita)
    if (message.hasQuotedMsg) {
      const normalizedText = normalizeText(message.body);
      // Se asume que los indicadores "retro" están definidos en client.keywordsData.identificadores.retro
      const retroPhrases = client.keywordsData.identificadores.retro?.frases || [];
      const retroWords = client.keywordsData.identificadores.retro?.palabras || [];
      
      let foundIndicator = false;
      // Revisar las frases definidas en "retro"
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
        // Aquí podrías delegar a otro método, por ejemplo:
        // await processRetroRequest(client, message);
        // O a un método específico para feedback desde el origen.
        // Para este ejemplo, delegamos a processTeamFeedbackResponse.
        await processTeamFeedbackResponse(client, message);
        return;
      } else {
        // Si no hay indicadores "retro", se informa al usuario.
        await chat.sendMessage("La forma de contestación no es válida para registrar una incidencia. Por favor, envía tu incidencia sin citar un mensaje.");
        return;
      }
    }
    // Si el mensaje no es una respuesta (sin cita), se procesa como nueva incidencia.
    await processNewIncidencia(client, message);
  
  // Mensajes provenientes de grupos destino se procesan como feedback/confirmación
  } else if ([config.groupBotDestinoId, config.groupMantenimientoId, config.groupAmaId].includes(chatId)) {
    await processConfirmation(client, message);
  } else {
    console.log("Mensaje de grupo no gestionado. Se omite.");
  }
}

module.exports = { handleIncidencia };

//nueva prueba
