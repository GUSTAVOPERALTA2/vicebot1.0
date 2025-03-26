// modules/incidenceManager/feedbackProcessor.js
const incidenceDB = require('./incidenceDB');
const moment = require('moment');
const config = require('../../config/config');

function containsAny(text, list) {
  return list.some(item => text.includes(item.toLowerCase()));
}

function detectResponseType(client, text) {
  const normalizedText = text.trim().toLowerCase();

  const confirmPalabras = client.keywordsData.confirmacion?.palabras || [];
  const confirmFrases = client.keywordsData.confirmacion?.frases || [];
  const fbPalabras = client.keywordsData.respuestasFeedback?.palabras || [];
  const fbFrases = client.keywordsData.respuestasFeedback?.frases || [];

  if (containsAny(normalizedText, confirmFrases) || confirmPalabras.includes(normalizedText)) {
    return "confirmacion";
  }

  if (containsAny(normalizedText, fbFrases)) {
    return "feedback";
  }

  const responseWords = new Set(normalizedText.split(/\s+/));
  for (let palabra of fbPalabras) {
    if (responseWords.has(palabra.toLowerCase())) return "feedback";
  }

  return "none";
}

async function detectFeedbackRequest(client, message) {
  if (!message.hasQuotedMsg) return false;

  const responseText = message.body.toLowerCase();
  const feedbackWords = client.keywordsData.retro?.palabras || [];
  const feedbackPhrases = client.keywordsData.retro?.frases || [];

  for (let phrase of feedbackPhrases) {
    if (responseText.includes(phrase.toLowerCase())) return true;
  }

  const responseWords = new Set(responseText.split(/\s+/));
  for (let word of feedbackWords) {
    if (responseWords.has(word.toLowerCase())) return true;
  }

  return false;
}

async function extractFeedbackIdentifier(quotedMessage) {
  const text = quotedMessage.body;
  const regex = /Detalles de la incidencia\s*\(ID:\s*(\d+)\)/i;
  const match = text.match(regex);

  if (match) {
    return match[1];
  }

  if (quotedMessage.id && quotedMessage.id._serialized) {
    return quotedMessage.id._serialized;
  }

  return null;
}

async function processFeedbackResponse(client, message, incidence) {
  const responseText = message.body;
  const responseType = detectResponseType(client, responseText);

  if (responseType === "confirmacion") {
    await new Promise((resolve, reject) => {
      incidenceDB.updateIncidenciaStatus(incidence.id, "completada", (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    const creationTime = moment(incidence.fechaCreacion);
    const completionTime = moment();
    const duration = moment.duration(completionTime.diff(creationTime));
    const days = Math.floor(duration.asDays());
    const hours = duration.hours();
    const minutes = duration.minutes();

    return `ESTA TAREA HA SIDO COMPLETADA.\nFecha de creación: ${incidence.fechaCreacion}\nFecha de finalización: ${completionTime.format("YYYY-MM-DD HH:mm")}\nTiempo activo: ${days} día(s), ${hours} hora(s), ${minutes} minuto(s)`;
  } else if (responseType === "feedback") {
    const feedbackRecord = {
      usuario: message.author || message.from,
      comentario: responseText,
      fecha: new Date().toISOString(),
      equipo: "solicitante"
    };

    await new Promise((resolve, reject) => {
      incidenceDB.updateFeedbackHistory(incidence.id, feedbackRecord, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    return "Su retroalimentación ha sido registrada.";
  } else {
    return "No se reconoció un tipo de respuesta válido.";
  }
}

async function processTeamFeedbackResponse(client, message) {
  if (!message.hasQuotedMsg) return "El mensaje no cita la solicitud de retroalimentación.";

  const quotedMessage = await message.getQuotedMessage();
  const quotedText = quotedMessage.body;

  if (!quotedText.includes("Se solicita retroalimentacion para la tarea:")) {
    return "El mensaje citado no es una solicitud válida de retroalimentación.";
  }

  const regex = /ID:\s*(\d+)/i;
  const match = quotedText.match(regex);
  if (!match) return "No se pudo extraer el ID de la incidencia del mensaje citado.";

  const incidenceId = match[1];
  const incidence = await new Promise((resolve, reject) => {
    incidenceDB.getIncidenciaById(incidenceId, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
  if (!incidence) return "No se encontró la incidencia correspondiente.";

  const team = Object.entries(config.destinoGrupos).find(([key, id]) => id === message._data?.chatId)?.[0] || "desconocido";

  const feedbackRecord = {
    usuario: message.author || message.from,
    comentario: message.body,
    fecha: new Date().toISOString(),
    equipo: team
  };

  await new Promise((resolve, reject) => {
    incidenceDB.updateFeedbackHistory(incidence.id, feedbackRecord, (err) => {
      if (err) return reject("Error al registrar el feedback.");
      resolve();
    });
  });

  return "Feedback del equipo registrado correctamente.";
}

async function getFeedbackConfirmationMessage(identifier) {
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

  if (!incidence) return null;

  if (incidence.estado.toLowerCase() === "completada") {
    const creationTime = moment(incidence.fechaCreacion);
    const completionTime = moment();
    const duration = moment.duration(completionTime.diff(creationTime));
    const durationStr = `${Math.floor(duration.asDays())} día(s), ${duration.hours()} hora(s), ${duration.minutes()} minuto(s)`;
    return `ESTA TAREA HA SIDO COMPLETADA.\nFecha de creación: ${incidence.fechaCreacion}\nFecha de finalización: ${completionTime.format("YYYY-MM-DD HH:mm")}\nTiempo activo: ${durationStr}`;
  } else {
    return `RETROALIMENTACION SOLICITADA PARA:\n${incidence.descripcion}\nID: ${incidence.id}\nCategoría: ${incidence.categoria}`;
  }
}

module.exports = {
  detectFeedbackRequest,
  extractFeedbackIdentifier,
  detectResponseType,
  processFeedbackResponse,
  processTeamFeedbackResponse,
  getFeedbackConfirmationMessage
};
