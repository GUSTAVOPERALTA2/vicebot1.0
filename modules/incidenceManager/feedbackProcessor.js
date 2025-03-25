const incidenceDB = require('./incidenceDB');
const moment = require('moment');
const config = require('../../config/config');

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
  
  // Si es un mensaje de detalles generado por /tareaDetalles, extraer el ID numérico.
  if (text.includes("Detalles de la incidencia")) {
    const regex = /Detalles de la incidencia\s*\(ID:\s*(\d+)\)/i;
    const match = text.match(regex);
    if (match) {
      console.log("Identificador numérico encontrado en mensaje de detalles:", match[1]);
      return match[1];
    }
  }
  
  // En otro caso, utilizar la metadata (originalMsgId) del mensaje citado.
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
 *  - "confirmacion": respuestas que indican confirmación final (ej. "listo", "ok")
 *  - "feedbackrespuesta": respuestas de retroalimentación del equipo (ej. "estamos trabajando en eso", "en proceso", "trabajando", "casi")
 *
 * @param {Object} client - El cliente de WhatsApp (con client.keywordsData).
 * @param {string} text - El texto de la respuesta.
 * @returns {string} - "confirmacion", "feedbackrespuesta" o "none".
 */
function detectResponseType(client, text) {
  const normalizedText = text.trim().toLowerCase();
  const confPalabras = client.keywordsData.respuestas?.confirmacion?.palabras || [];
  const confFrases = client.keywordsData.respuestas?.confirmacion?.frases || [];
  const fbRespPalabras = client.keywordsData.respuestas?.feedback?.palabras || [];
  const fbRespFrases = client.keywordsData.respuestas?.feedback?.frases || [];
  
  if (confPalabras.includes(normalizedText)) return "confirmacion";
  for (let frase of confFrases) {
    if (normalizedText.includes(frase.toLowerCase())) return "confirmacion";
  }
  for (let palabra of fbRespPalabras) {
    if (normalizedText.includes(palabra.toLowerCase())) return "feedbackrespuesta";
  }
  for (let frase of fbRespFrases) {
    if (normalizedText.includes(frase.toLowerCase())) return "feedbackrespuesta";
  }
  return "none";
}

/**
 * processTeamFeedbackResponse - Procesa la respuesta de retroalimentación enviada
 * en los grupos destino (por el equipo).
 *
 * Lógica:
 * 1. Verifica que el mensaje citado (de solicitud) contenga la frase "Se solicita retroalimentacion para la tarea:".
 * 2. Extrae el ID numérico de la incidencia del mensaje citado (usando el patrón "ID: {id}").
 * 3. Consulta la incidencia en la BD usando ese ID.
 * 4. Crea un registro de feedback que incluya usuario, comentario, fecha y el equipo (determinado a partir del grupo).
 * 5. Guarda el registro en el historial de feedback de la incidencia.
 * 6. Loggea que se ha guardado la respuesta.
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
  
  // Verificar que el mensaje citado contenga la frase indicativa.
  if (!quotedText.includes("Se solicita retroalimentacion para la tarea:")) {
    console.log("El mensaje citado no corresponde a una solicitud de retroalimentación.");
    return "El mensaje citado no es una solicitud válida de retroalimentación.";
  }
  
  // Extraer el ID numérico usando "ID: {id}".
  const regex = /ID:\s*(\d+)/i;
  const match = quotedText.match(regex);
  if (!match) {
    console.log("No se pudo extraer el ID de la incidencia del mensaje citado.");
    return "No se pudo extraer el ID de la incidencia del mensaje citado.";
  }
  const incidenceId = match[1];
  console.log("ID extraído del mensaje citado:", incidenceId);
  
  // Consultar la incidencia en la BD.
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
  
  // Determinar el equipo a partir del id del chat.
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
  
  // Crear el registro de feedback.
  const feedbackRecord = {
    usuario: message.author || message.from,
    comentario: message.body,
    fecha: new Date().toISOString(),
    equipo: team
  };
  
  // Guardar el registro en el historial de feedback en la BD.
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
}

/**
 * getFeedbackConfirmationMessage - Consulta en la BD la incidencia correspondiente
 * al identificador (numérico o originalMsgId) y construye un mensaje de retroalimentación.
 *
 * Si la incidencia tiene estado "completada", se devuelve un mensaje final con fechas y tiempo activo;
 * de lo contrario, se devuelve la información básica de la incidencia.
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
