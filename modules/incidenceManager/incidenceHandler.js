const config = require('../../config/config');
const { processNewIncidence } = require('./newIncidence');
const { handleFeedbackRequestFromOrigin, processTeamFeedbackResponse } = require('./feedbackProcessor');
const { processConfirmation } = require('./confirmationProcessor');
// Importamos la función normalizeText desde el nuevo módulo stringUtils
const { normalizeText } = require('../../config/stringUtils');

async function handleIncidence(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;

  // Grupo principal de incidencias
  if (chatId === config.groupPruebaId) {
    if (message.hasQuotedMsg) {
      const quotedMessage = await message.getQuotedMessage();
      // Se eliminan los asteriscos y se normaliza el texto (eliminando acentos, espacios extras y pasándolo a minúsculas)
      const normalizedQuoted = normalizeText(quotedMessage.body.replace(/\*/g, ''));
      
      // Si el mensaje citado es un recordatorio, se procesa como confirmación.
      if (normalizedQuoted.startsWith("recordatorio: tarea incompleta")) {
        console.log("Recordatorio detectado en grupo principal, redirigiendo a processConfirmation.");
        await processConfirmation(client, message);
        return;
      }

      // Si el mensaje citado es una nueva tarea, se procesa como confirmación.
      if (normalizedQuoted.startsWith("nueva tarea recibida")) {
        console.log("Nueva tarea detectada en grupo principal, redirigiendo a processConfirmation.");
        await processConfirmation(client, message);
        return;
      }

      // Si es una solicitud de retroalimentación, se normaliza el cuerpo del mensaje.
      const normalizedText = normalizeText(message.body);
      const retroPhrases = client.keywordsData.retro?.frases || [];
      const retroWords = client.keywordsData.retro?.palabras || [];

      let foundIndicator = false;
      // Se verifica si alguna de las frases está contenida en el mensaje (usando normalización)
      for (let phrase of retroPhrases) {
        if (normalizedText.includes(normalizeText(phrase))) {
          foundIndicator = true;
          break;
        }
      }
      // En caso de no encontrar coincidencia en frases, se evalúa palabra por palabra
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

    // Si no hay mensaje citado, se procesa como una nueva incidencia.
    await processNewIncidence(client, message);

  // Mensajes provenientes de grupos destino (IT, Mantenimiento, Ama de Llaves)
  } else if ([config.groupBotDestinoId, config.groupMantenimientoId, config.groupAmaId].includes(chatId)) {
    await processTeamFeedbackResponse(client, message);
  } else {
    console.log("Mensaje de grupo no gestionado. Se omite.");
  }
}

module.exports = { handleIncidence };

//nuevo