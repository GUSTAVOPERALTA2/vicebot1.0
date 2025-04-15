const config = require('../../config/config');
const { processNewIncidence } = require('./newIncidence');
const { handleFeedbackRequestFromOrigin, processTeamFeedbackResponse } = require('./feedbackProcessor');
const { processConfirmation } = require('./confirmationProcessor');
// Importamos funciones de stringUtils
const { normalizeText, similarity, SIMILARITY_THRESHOLD } = require('../../config/stringUtils');

async function handleIncidence(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;

  // Grupo principal de incidencias
  if (chatId === config.groupPruebaId) {
    if (message.hasQuotedMsg) {
      const quotedMessage = await message.getQuotedMessage();
      const normalizedQuoted = normalizeText(quotedMessage.body.replace(/\*/g, ''));
      console.log(`Mensaje citado normalizado: "${normalizedQuoted}"`);

      if (normalizedQuoted.startsWith("recordatorio: tarea incompleta")) {
        console.log("Recordatorio detectado en grupo principal, redirigiendo a processConfirmation.");
        await processConfirmation(client, message);
        return;
      }
      if (normalizedQuoted.startsWith("nueva tarea recibida")) {
        console.log("Nueva tarea detectada en grupo principal, redirigiendo a processConfirmation.");
        await processConfirmation(client, message);
        return;
      }

      const normalizedText = normalizeText(message.body);
      console.log(`Mensaje principal normalizado para revisión de retro: "${normalizedText}"`);
      const retroPhrases = client.keywordsData.retro?.frases || [];
      const retroWords = client.keywordsData.retro?.palabras || [];
      let foundIndicator = false;

      // Comprobación de frases
      for (let phrase of retroPhrases) {
        const normalizedPhrase = normalizeText(phrase);
        const includesPhrase = normalizedText.includes(normalizedPhrase);
        console.log(`Verificando frase retro: "${phrase}" (normalizada: "${normalizedPhrase}") → incluida: ${includesPhrase}`);
        if (includesPhrase) {
          foundIndicator = true;
          console.log(`Coincidencia detectada con la frase retro: "${phrase}"`);
          break;
        }
      }

      // Si no se encontró con frases, se evalúan las palabras
      if (!foundIndicator) {
        const responseWords = normalizedText.split(/\s+/);
        for (let keyword of retroWords) {
          const normalizedKeyword = normalizeText(keyword);
          for (let word of responseWords) {
            const sim = similarity(word, normalizedKeyword);
            console.log(`Comparando retro palabra: "${word}" vs "${normalizedKeyword}" → Similitud: ${sim}`);
            if (sim >= SIMILARITY_THRESHOLD) {
              foundIndicator = true;
              console.log(`Retro palabra detectada: "${word}" coincide con "${normalizedKeyword}" con similitud ${sim}`);
              break;
            }
          }
          if (foundIndicator) break;
        }
      }

      if (foundIndicator) {
        console.log("Indicadores de retroalimentación detectados, procesando solicitud de feedback.");
        await handleFeedbackRequestFromOrigin(client, message);
        return;
      } else {
        await chat.sendMessage("La forma de contestación no es válida para registrar una incidencia. Por favor, envía tu incidencia sin citar un mensaje.");
        return;
      }
    }
    await processNewIncidence(client, message);
  } else if ([config.groupBotDestinoId, config.groupMantenimientoId, config.groupAmaId].includes(chatId)) {
    await processTeamFeedbackResponse(client, message);
  } else {
    console.log("Mensaje de grupo no gestionado. Se omite.");
  }
}

module.exports = { handleIncidence };
