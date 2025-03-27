const { handleCommands } = require('./commandsHandler');
const { handleIncidence } = require('../../modules/incidenceManager/incidenceHandler');
const { 
  detectFeedbackRequest, 
  extractFeedbackIdentifier, 
  getFeedbackConfirmationMessage,
  processFeedbackResponse,
  processTeamFeedbackResponse,
  processTeamRetroFeedbackResponse,
  isRetroRequest
} = require('../../modules/incidenceManager/feedbackProcessor');
const { sendFeedbackRequestToGroups } = require('../../modules/incidenceManager/feedbackNotifier');
const incidenceDB = require('../../modules/incidenceManager/incidenceDB');
const config = require('../../config/config');

/**
 * logIfQuoted - Registra en consola si el mensaje recibido cita a otro y muestra el contenido del mensaje citado.
 * @param {Object} message - El mensaje recibido.
 */
async function logIfQuoted(message) {
  console.log("Mensaje recibido:", message.body);
  if (message.hasQuotedMsg) {
    console.log("Este mensaje ES una respuesta (cita).");
    try {
      const quotedMessage = await message.getQuotedMessage();
      console.log("Mensaje citado:", quotedMessage.body);
    } catch (error) {
      console.error("Error al obtener el mensaje citado:", error);
    }
  } else {
    console.log("Este mensaje NO es una respuesta (no tiene cita).");
  }
}

async function handleMessage(client, message) {
  try {
    // Log para saber si se detecta una cita.
    await logIfQuoted(message);
    const chat = await message.getChat();

    // Si el mensaje cita otro...
    if (message.hasQuotedMsg) {
      // Verificar si es una solicitud de retroalimentación mediante las keywords de la categoría "retro"
      if (await isRetroRequest(client, message)) {
         const result = await processTeamRetroFeedbackResponse(client, message);
         console.log(result);
         return;
      }
      
      // Si el mensaje citado ya tiene el formato de "SOLICITUD DE RETROALIMENTACION PARA LA TAREA", se procesa
      const quotedMessage = await message.getQuotedMessage();
      const quotedText = quotedMessage.body;
      if (quotedText.includes("SOLICITUD DE RETROALIMENTACION PARA LA TAREA")) {
         const result = await processTeamRetroFeedbackResponse(client, message);
         console.log(result);
         return;
      }
      
      // Caso en que el solicitante envía retroalimentación (sin que sea respuesta en grupo destino)
      const isFeedback = await detectFeedbackRequest(client, message);
      if (isFeedback) {
         const identifier = await extractFeedbackIdentifier(quotedMessage);
         if (identifier) {
            let incidence;
            if (/^\d+$/.test(identifier)) {
              incidence = await new Promise((resolve, reject) => {
                incidenceDB.getIncidenciaById(identifier, (err, row) => {
                  if (err) return reject(err);
                  resolve(row);
                });
              });
            } else {
              incidence = await incidenceDB.buscarIncidenciaPorOriginalMsgIdAsync(identifier);
            }
            if (incidence) {
              await sendFeedbackRequestToGroups(client, incidence);
              const feedbackMsg = await getFeedbackConfirmationMessage(identifier);
              await chat.sendMessage("Se ha reenviado su solicitud de retroalimentación a los equipos correspondientes.\n" + (feedbackMsg || ""));
            } else {
              await chat.sendMessage("No se encontró información de la incidencia para retroalimentación.");
            }
         } else {
           await chat.sendMessage("No se pudo extraer el identificador de la incidencia citada.");
         }
         return;
      }
    }

    // Si el mensaje inicia con '/' se procesa como comando.
    if (message.body && message.body.trim().startsWith('/')) {
      console.log(`Comando detectado: ${message.body.trim()}`);
      const handled = await handleCommands(client, message);
      if (handled) return;
    }

    // Si no es comando, se procesa como incidencia.
    await handleIncidence(client, message);
  } catch (err) {
    console.error("Error en handleMessage:", err);
  }
}

module.exports = handleMessage;
