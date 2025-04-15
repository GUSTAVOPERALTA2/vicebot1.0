const config = require('../../config/config');
const { processNewIncidence } = require('./newIncidence');
const { handleFeedbackRequestFromOrigin, processTeamFeedbackResponse } = require('./feedbackProcessor');
const { processConfirmation } = require('./confirmationProcessor');
// Importamos las funciones de stringUtils para normalizar y comparar
const { normalizeText, similarity } = require('../../config/stringUtils');

async function handleIncidence(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;

  // Grupo principal de incidencias
  if (chatId === config.groupPruebaId) {
    if (message.hasQuotedMsg) {
      const quotedMessage = await message.getQuotedMessage();
      // Se eliminan los asteriscos y se normaliza el texto para quitar acentos, espacios extras y pasar a minúsculas
      const normalizedQuoted = normalizeText(quotedMessage.body.replace(/\*/g, ''));
      console.log(`Mensaje citado normalizado: "${normalizedQuoted}"`);

      // Si el mensaje citado es un recordatorio, se procesa como confirmación.
      if (normalizedQuoted.startsWith("recordatorio: tarea incompleta")) {
        console.log("Recordatorio detectado en grupo principal, redirigiendo a processConfirmation.");
        await processConfirmation(client, message);
        return;
      }

      // Si el mensaje citado es una nueva tarea, también se procesa como confirmación.
      if (normalizedQuoted.startsWith("nueva tarea recibida")) {
        console.log("Nueva tarea detectada en grupo principal, redirigiendo a processConfirmation.");
        await processConfirmation(client, message);
        return;
      }

      // Si es una solicitud de retroalimentación, se procede a revisar
      const normalizedText = normalizeText(message.body);
      console.log(`Mensaje principal normalizado para revisión de retro: "${normalizedText}"`);
      
      const retroPhrases = client.keywordsData.retro?.frases || [];
      const retroWords = client.keywordsData.retro?.palabras || [];
      let foundIndicator = false;

      // Verificar coincidencia con frases clave de retro
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

      // Si no se encontró con frases, evaluamos palabra por palabra usando similitud
      if (!foundIndicator) {
        const responseWords = normalizedText.split(/\s+/);
        for (let keyword of retroWords) {
          const normalizedKeyword = normalizeText(keyword);
          for (let msgWord of responseWords) {
            const sim = similarity(msgWord, normalizedKeyword);
            console.log(`Comparando palabra: "${msgWord}" vs "${normalizedKeyword}" → Similitud: ${sim}`);
            if (sim >= 0.8) {
              foundIndicator = true;
              console.log(`Coincidencia detectada: La palabra "${msgWord}" se parece a "${normalizedKeyword}" (similitud: ${sim})`);
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

    // Si no hay mensaje citado, se procesa como nueva incidencia.
    await processNewIncidence(client, message);

  // Mensajes provenientes de grupos destino (IT, Mantenimiento, Ama de Llaves)
  } else if ([config.groupBotDestinoId, config.groupMantenimientoId, config.groupAmaId].includes(chatId)) {
    await processTeamFeedbackResponse(client, message);
  } else {
    console.log("Mensaje de grupo no gestionado. Se omite.");
  }
}

module.exports = { handleIncidence };

//logs
