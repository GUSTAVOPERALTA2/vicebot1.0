// modules/messageManager/messageHandler.js
const { handleCommands } = require('./commandsHandler');
const { handleIncidence } = require('../../modules/incidenceManager/incidenceHandler');
const {
  detectFeedbackRequest,
  extractFeedbackIdentifier,
  getFeedbackConfirmationMessage,
  processFeedbackResponse,
  processTeamFeedbackResponse
} = require('../../modules/incidenceManager/feedbackProcessor');
const { sendFeedbackRequestToGroups } = require('../../modules/incidenceManager/feedbackNotifier');
const incidenceDB = require('../../modules/incidenceManager/incidenceDB');

async function handleMessage(client, message) {
  try {
    const chat = await message.getChat();

    // --- Feedback por mensaje citado ---
    if (message.hasQuotedMsg) {
      const isFeedbackRequest = await detectFeedbackRequest(client, message);
      if (isFeedbackRequest) {
        const quotedMessage = await message.getQuotedMessage();
        const identifier = await extractFeedbackIdentifier(quotedMessage);

        if (!identifier) {
          await chat.sendMessage("No se pudo extraer el identificador de la incidencia citada.");
          return;
        }

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

        return;
      }

      // --- Feedback del equipo (respuesta en grupo destino) ---
      const quotedMessage = await message.getQuotedMessage();
      const quotedText = quotedMessage.body;
      if (quotedText.includes("Se solicita retroalimentacion para la tarea:")) {
        const teamFeedbackResponse = await processTeamFeedbackResponse(client, message);
        if (teamFeedbackResponse) {
          await chat.sendMessage(teamFeedbackResponse);
          return;
        }
      }
    }

    // --- Comandos ---
    if (message.body && message.body.trim().startsWith('/')) {
      console.log(`Comando detectado: ${message.body.trim()}`);
      const handled = await handleCommands(client, message);
      if (handled) return;
    }

    // --- Incidencia nueva o confirmación ---
    await handleIncidence(client, message);
  } catch (err) {
    console.error("Error en handleMessage:", err);
  }
}

module.exports = handleMessage;


//nuevo modulo