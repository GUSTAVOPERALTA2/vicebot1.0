// vicebot/modules/incidenceManager/incidenceHandler.js
const config = require('../../config/config');
const { processNewIncidence } = require('./newIncidence');
const { handleFeedbackRequestFromOrigin, processTeamFeedbackResponse } = require('./feedbackProcessor');
const { processConfirmation } = require('./confirmationProcessor');

/**
 * Función auxiliar para normalizar texto: lo recorta y lo pasa a minúsculas.
 */
function normalizeText(text) {
  return text.trim().toLowerCase();
}

async function handleIncidence(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;

  // Grupo principal de incidencias
  if (chatId === config.groupPruebaId) {
    if (message.hasQuotedMsg) {
      const quotedMessage = await message.getQuotedMessage();
      const normalizedQuoted = quotedMessage.body.replace(/\*/g, '').trim().toLowerCase(); // ✅ CORREGIDO

      // Si el mensaje citado es un recordatorio, se procesa como confirmación
      if (normalizedQuoted.startsWith("recordatorio: tarea incompleta")) {
        console.log("Recordatorio detectado en grupo principal, redirigiendo a processConfirmation.");
        await processConfirmation(client, message);
        return;
      }

      // Si el mensaje citado es una nueva tarea, también se permite confirmar
      if (normalizedQuoted.startsWith("nueva tarea recibida")) {
        console.log("Nueva tarea detectada en grupo principal, redirigiendo a processConfirmation.");
        await processConfirmation(client, message);
        return;
      }

      // Si es una solicitud de retroalimentación
      const normalizedText = normalizeText(message.body);
      const retroPhrases = client.keywordsData.retro?.frases || [];
      const retroWords = client.keywordsData.retro?.palabras || [];

      let foundIndicator = false;
      for (let phrase of retroPhrases) {
        if (normalizedText.includes(normalizeText(phrase))) {
          foundIndicator = true;
          break;
        }
      }
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
      } else {
        await chat.sendMessage("La forma de contestación no es válida para registrar una incidencia. Por favor, envía tu incidencia sin citar un mensaje.");
        return;
      }
    }

    // Si no hay mensaje citado, procesar como nueva incidencia
    await processNewIncidence(client, message);

  // Mensajes provenientes de grupos destino
  } else if ([config.groupBotDestinoId, config.groupMantenimientoId, config.groupAmaId].includes(chatId)) {
    await processTeamFeedbackResponse(client, message);
  } else {
    console.log("Mensaje de grupo no gestionado. Se omite.");
  }
}

module.exports = { handleIncidence };
