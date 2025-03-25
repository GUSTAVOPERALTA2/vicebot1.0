// vicebot/modules/incidenceManager/feedbackProcessor.js
const incidenceDB = require('./incidenceDB');
const moment = require('moment');
const config = require('../../config/config');
// Se importa la función que envía el mensaje final de confirmación.
const { enviarConfirmacionGlobal } = require('./confirmationProcessor');

/**
 * detectFeedbackRequest - Detecta si un mensaje que cita una incidencia
 * contiene palabras o frases indicativas de solicitar retroalimentación.
 *
 * @param {Object} client - El cliente de WhatsApp (con client.keywordsData).
 * @param {Object} message - El mensaje de respuesta que cita otro mensaje.
 * @returns {Promise<boolean>} - True si se detecta retroalimentación; false en caso contrario.
 */
async function detectFeedbackRequest(client, message) {
  if (!message.hasQuotedMsg) {
    console.log("El mensaje no cita ningún mensaje.");
    return false;
  }
  
  const responseText = message.body.toLowerCase();
  const feedbackWords = client.keywordsData.retroalimentacion?.palabras || [];
  const feedbackPhrases = client.keywordsData.retroalimentacion?.frases || [];
  
  let feedbackDetected = false;
  for (let phrase of feedbackPhrases) {
    if (responseText.includes(phrase.toLowerCase())) {
      feedbackDetected = true;
      break;
    }
  }
  if (!feedbackDetected) {
    const responseWords = new Set(responseText.split(/\s+/));
    for (let word of feedbackWords) {
      if (responseWords.has(word.toLowerCase())) {
        feedbackDetected = true;
        break;
      }
    }
  }
  console.log(feedbackDetected 
    ? "Retroalimentación detectada en el mensaje de respuesta." 
    : "No se detectó retroalimentación en el mensaje de respuesta.");
  return feedbackDetected;
}

/**
 * extractFeedbackIdentifier - Extrae el identificador a partir del mensaje citado.
 * Si el mensaje citado proviene del comando /tareaDetalles (contiene "Detalles de la incidencia"),
 * se extrae el id numérico del texto; de lo contrario, se utiliza la metadata (originalMsgId).
 *
 * @param {Object} quotedMessage - El mensaje citado.
 * @returns {Promise<string|null>} - El identificador extraído o null.
 */
async function extractFeedbackIdentifier(quotedMessage) {
  const text = quotedMessage.body;
  console.log("Texto del mensaje citado:", text);
  
  if (text.includes("Detalles de la incidencia")) {
    const regex = /Detalles de la incidencia\s*\(ID:\s*(\d+)\)/i;
    const match = text.match(regex);
    if (match) {
      console.log("Identificador numérico encontrado en mensaje de detalles:", match[1]);
      return match[1];
    }
  }
  
  if (quotedMessage.id && quotedMessage.id._serialized) {
    console.log("Extrayendo identificador del mensaje citado (metadata):", quotedMessage.id._serialized);
    return quotedMessage.id._serialized;
  }
  
  console.log("No se encontró identificador en el mensaje citado.");
  return null;
}

/**
 * detectResponseType - Determina el tipo de respuesta a partir del texto.
 * Se revisan:
 *  - "confirmacion": respuestas que indican confirmación final (ej. "ok", "listo")
 *  - "retroFeedback": respuestas específicas a la solicitud de retroalimentación (ej. "respuesta retro", "retroalimentacion recibida")
 *  - "feedbackrespuesta": respuestas de feedback genérico (ej. "avance", "estado", "progreso")
 * 
 * Además, si no se detectan palabras explícitas, se utiliza una heurística basada en la cantidad de palabras:
 *   - Si el mensaje tiene 3 palabras o menos, se asume confirmación.
 *   - De lo contrario, se asume feedback.
 *
 * @param {Object} client - El cliente de WhatsApp (con client.keywordsData).
 * @param {string} text - El texto de la respuesta.
 * @returns {string} - "confirmacion", "retroFeedback", "feedbackrespuesta" o "none".
 */
function detectResponseType(client, text) {
  const normalizedText = text.trim().toLowerCase();
  const words = normalizedText.split(/\s+/);
  const wordCount = words.length;

  // Verificar confirmación explícita
  const confPalabras = client.keywordsData.respuestas?.confirmacion?.palabras || [];
  const confFrases = client.keywordsData.respuestas?.confirmacion?.frases || [];
  for (let palabra of confPalabras) {
    if (normalizedText.includes(palabra.toLowerCase())) return "confirmacion";
  }
  for (let frase of confFrases) {
    if (normalizedText.includes(frase.toLowerCase())) return "confirmacion";
  }

  // Verificar respuesta específica a la solicitud de feedback (retroFeedback)
  const retroFBPalabras = client.keywordsData.respuestas?.retroFeedback?.palabras || [];
  const retroFBFrases = client.keywordsData.respuestas?.retroFeedback?.frases || [];
  for (let palabra of retroFBPalabras) {
    if (normalizedText.includes(palabra.toLowerCase())) return "retroFeedback";
  }
  for (let frase of retroFBFrases) {
    if (normalizedText.includes(frase.toLowerCase())) return "retroFeedback";
  }

  // Verificar feedback genérico
  const fbRespPalabras = client.keywordsData.respuestas?.feedback?.palabras || [];
  const fbRespFrases = client.keywordsData.respuestas?.feedback?.frases || [];
  for (let palabra of fbRespPalabras) {
    if (normalizedText.includes(palabra.toLowerCase())) return "feedbackrespuesta";
  }
  for (let frase of fbRespFrases) {
    if (normalizedText.includes(frase.toLowerCase())) return "feedbackrespuesta";
  }
  
  // Heurística: si no se detectan palabras explícitas
  if (wordCount <= 3) {
    return "confirmacion";
  } else {
    return "feedbackrespuesta";
  }
}

/**
 * processFeedbackResponse - Procesa la respuesta de retroalimentación del solicitante.
 * (Para respuestas directas, no en grupos destino)
 *
 * @param {Object} client - El cliente de WhatsApp.
 * @param {Object} message - El mensaje de feedback recibido.
 * @param {Object} incidence - La incidencia correspondiente.
 * @returns {Promise<string>} - Mensaje resultante para enviar al solicitante.
 */
async function processFeedbackResponse(client, message, incidence) {
  const responseText = message.body;
  const responseType = detectResponseType(client, responseText);
  
  if (responseType === "confirmacion") {
    return new Promise((resolve, reject) => {
      incidenceDB.updateIncidenciaStatus(incidence.id, "completada", async (err) => {
        if (err) return reject(err);
        const creationTime = moment(incidence.fechaCreacion);
        const completionTime = moment();
        const duration = moment.duration(completionTime.diff(creationTime));
        const days = Math.floor(duration.asDays());
        const hours = duration.hours();
        const minutes = duration.minutes();
        const finalMsg = `ESTA TAREA HA SIDO COMPLETADA.\nFecha de creación: ${incidence.fechaCreacion}\nFecha de finalización: ${completionTime.format("YYYY-MM-DD HH:mm")}\nTiempo activo: ${days} día(s), ${hours} hora(s), ${minutes} minuto(s)`;
        resolve(finalMsg);
      });
    });
  } else if (responseType === "feedbackrespuesta" || responseType === "retroFeedback") {
    const feedbackRecord = {
      usuario: message.author || message.from,
      comentario: responseText,
      fecha: new Date().toISOString(),
      equipo: "solicitante"
    };
    return new Promise((resolve, reject) => {
      incidenceDB.updateFeedbackHistory(incidence.id, feedbackRecord, (err) => {
        if (err) return reject(err);
        resolve("Su retroalimentación ha sido registrada.");
      });
    });
  } else {
    return "No se reconoció un tipo de respuesta válido.";
  }
}

/**
 * processTeamFeedbackResponse - Procesa la respuesta de retroalimentación enviada
 * en los grupos destino (por el equipo).
 *
 * Lógica:
 * 1. Verifica que el mensaje citado corresponda a una solicitud de retroalimentación.
 * 2. Extrae el ID de la incidencia del mensaje citado.
 * 3. Recupera la incidencia de la BD.
 * 4. Usa detectResponseType (con heurística) para determinar el tipo de respuesta:
 *    - Si es "confirmacion", actualiza el estado a "completada" y envía el mensaje final.
 *    - Si es "feedbackrespuesta" o "retroFeedback", guarda el mensaje en el historial.
 *
 * @param {Object} client - El cliente de WhatsApp.
 * @param {Object} message - El mensaje de feedback enviado en el grupo destino.
 * @returns {Promise<string>} - Mensaje indicando el resultado.
 */
async function processTeamFeedbackResponse(client, message) {
  if (!message.hasQuotedMsg) {
    console.log("El mensaje del equipo no cita ningún mensaje de solicitud.");
    return "El mensaje no cita la solicitud de retroalimentación.";
  }
  
  const quotedMessage = await message.getQuotedMessage();
  const quotedText = quotedMessage.body;
  
  if (!quotedText.toLowerCase().includes("retroalimentacion solicitada para:")) {
    console.log("El mensaje citado no corresponde a una solicitud de retroalimentación.");
    return "El mensaje citado no es una solicitud válida de retroalimentación.";
  }
  
  const regex = /ID:\s*(\d+)/i;
  const match = quotedText.match(regex);
  if (!match) {
    console.log("No se pudo extraer el ID de la incidencia del mensaje citado.");
    return "No se pudo extraer el ID de la incidencia del mensaje citado.";
  }
  const incidenceId = match[1];
  console.log("ID extraído del mensaje citado:", incidenceId);
  
  let incidence = await new Promise((resolve, reject) => {
    incidenceDB.getIncidenciaById(incidenceId, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
  if (!incidence) {
    console.log("No se encontró la incidencia con el ID:", incidenceId);
    return "No se encontró la incidencia correspondiente.";
  }
  
  function determineTeamFromGroup(message) {
    if (message && message._data && message._data.chatId) {
      const chatId = message._data.chatId;
      for (const [key, groupId] of Object.entries(config.destinoGrupos)) {
        if (groupId === chatId) {
          return key; // "it", "man", "ama"
        }
      }
    }
    return "desconocido";
  }
  const team = determineTeamFromGroup(message);

  const responseType = detectResponseType(client, message.body);
  console.log("Tipo de respuesta detectada:", responseType);

  if (responseType === "confirmacion") {
    await new Promise((resolve, reject) => {
      incidenceDB.updateIncidenciaStatus(incidence.id, "completada", async (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    await enviarConfirmacionGlobal(client, incidence, incidence.id, team);
    return "Incidencia completada.";
  } else if (responseType === "feedbackrespuesta" || responseType === "retroFeedback") {
    const feedbackRecord = {
      usuario: message.author || message.from,
      comentario: message.body,
      fecha: new Date().toISOString(),
      equipo: team
    };
    return new Promise((resolve, reject) => {
      incidenceDB.updateFeedbackHistory(incidence.id, feedbackRecord, (err) => {
        if (err) {
          console.error("Error al registrar el feedback:", err);
          return reject("Error al registrar el feedback.");
        }
        console.log(`Feedback registrado para la incidencia ID ${incidence.id}:`, feedbackRecord);
        resolve("Feedback del equipo registrado correctamente.");
      });
    });
  } else {
    return "No se reconoció un tipo de respuesta válido.";
  }
}

/**
 * getFeedbackConfirmationMessage - Construye un mensaje de retroalimentación basado en la incidencia.
 *
 * @param {string} identifier - El identificador extraído.
 * @returns {Promise<string|null>} - El mensaje de retroalimentación o null.
 */
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
  if (!incidence) {
    console.log("No se encontró incidencia con el identificador: " + identifier);
    return null;
  }
  
  if (incidence.estado.toLowerCase() === "completada") {
    const creationTime = moment(incidence.fechaCreacion);
    const completionTime = moment();
    const duration = moment.duration(completionTime.diff(creationTime));
    const days = Math.floor(duration.asDays());
    const hours = duration.hours();
    const minutes = duration.minutes();
    const durationStr = `${days} día(s), ${hours} hora(s), ${minutes} minuto(s)`;
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

//heuristica