const { handleCommands } = require('./commandsHandler');
const { handleIncidence } = require('../../modules/incidenceManager/incidenceHandler');
const { 
  detectFeedbackRequest, 
  extractFeedbackIdentifier, 
  getFeedbackConfirmationMessage,
  processFeedbackResponse,
  processTeamFeedbackResponse,
  processTeamRetroFeedbackResponse
} = require('../../modules/incidenceManager/feedbackProcessor');
const { sendFeedbackRequestToGroups } = require('../../modules/incidenceManager/feedbackNotifier');
const incidenceDB = require('../../modules/incidenceManager/incidenceDB');
const config = require('../../config/config');

async function handleMessage(client, message) {
  try {
    const chat = await message.getChat();

    // Si el mensaje cita otro, se revisa si se trata de una solicitud de retroalimentación
    if (message.hasQuotedMsg) {
      const quotedMessage = await message.getQuotedMessage();
      const quotedText = quotedMessage.body;
      // Si el mensaje citado corresponde a una solicitud de retroalimentación (enviada al grupo destino)
      if (quotedText.includes("SOLICITUD DE RETROALIMENTACION PARA LA TAREA")) {
        // Procesar la respuesta del equipo a la solicitud de retroalimentación
        const result = await processTeamRetroFeedbackResponse(client, message);
        console.log(result);
        return; // Se detiene el procesamiento si se ha manejado la respuesta retro
      }
      
      // Caso contrario: si se trata de una solicitud de retroalimentación (por el solicitante)
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
        return; // Se detiene el procesamiento si se ha manejado la retroalimentación solicitada.
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
