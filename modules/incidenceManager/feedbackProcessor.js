// vicebot/modules/incidenceManager/feedbackProcessor.js
const incidenceDB = require('./incidenceDB');
const moment = require('moment');
const config = require('../../config/config');

/**
 * Función para calcular la distancia de Levenshtein entre dos cadenas.
 */
function levenshteinDistance(a, b) {
  const matrix = [];
  let i, j;
  for (i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (i = 1; i <= b.length; i++) {
    for (j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // sustitución
          matrix[i][j - 1] + 1,     // inserción
          matrix[i - 1][j] + 1      // eliminación
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Función simple de fuzzy matching basada en la distancia de Levenshtein.
 * Retorna un valor entre 0 y 1, donde 1 indica una coincidencia exacta.
 */
function simpleFuzzyMatch(s1, s2) {
  const distance = levenshteinDistance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

/**
 * normalizeText - Convierte el texto a minúsculas, quita acentos y elimina signos de puntuación.
 *
 * @param {string} text - El texto a normalizar.
 * @returns {string} - El texto normalizado.
 */
function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()¿?¡"]/g, "")
    .trim();
}

/**
 * detectFeedbackRequest - Detecta si un mensaje que cita una incidencia
 * contiene palabras o frases indicativas de solicitar retroalimentación.
 *
 * @param {Object} client - El cliente de WhatsApp (con client.keywordsData).
 * @param {Object} message - El mensaje que cita otro mensaje.
 * @returns {Promise<boolean>} - True si se detecta retroalimentación; false en caso contrario.
 */
async function detectFeedbackRequest(client, message) {
  if (!message.hasQuotedMsg) {
    console.log("El mensaje no cita ningún mensaje.");
    return false;
  }
  
  const responseText = normalizeText(message.body);
  const feedbackWords = client.keywordsData.retroalimentacion?.palabras || [];
  const feedbackPhrases = client.keywordsData.retroalimentacion?.frases || [];
  
  let feedbackDetected = false;
  for (let phrase of feedbackPhrases) {
    if (responseText.includes(normalizeText(phrase))) {
      feedbackDetected = true;
      break;
    }
  }
  if (!feedbackDetected) {
    const responseWords = new Set(responseText.split(/\s+/));
    for (let word of feedbackWords) {
      if (responseWords.has(normalizeText(word))) {
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
 * detectResponseType - Para respuestas en grupos destino se evalúa únicamente
 * contra las palabras y frases definidas en la sección "respuestasFeedback" del JSON.
 *
 * @param {Object} client - El cliente de WhatsApp (con client.keywordsData).
 * @param {string} text - El texto de la respuesta.
 * @returns {string} - "feedbackrespuesta" o "ambiguous".
 */
function detectResponseType(client, text) {
  const normalizedText = normalizeText(text);
  const threshold = 0.7; // umbral para fuzzy matching
  
  const fbPalabras = client.keywordsData.respuestasFeedback?.palabras || [];
  const fbFrases = client.keywordsData.respuestasFeedback?.frases || [];
  
  let feedbackScore = 0;
  
  // Comparación exacta
  if (fbPalabras.includes(normalizedText)) feedbackScore += 1;
  fbFrases.forEach(phrase => {
    if (normalizedText.includes(normalizeText(phrase))) {
      feedbackScore += 1;
    }
  });
  
  // Fuzzy matching
  fbPalabras.forEach(word => {
    const sim = simpleFuzzyMatch(normalizedText, normalizeText(word));
    if (sim >= threshold) feedbackScore += 0.8;
  });
  fbFrases.forEach(phrase => {
    const sim = simpleFuzzyMatch(normalizedText, normalizeText(phrase));
    if (sim >= threshold) feedbackScore += 0.8;
  });
  
  console.log("feedbackScore:", feedbackScore);
  
  if (feedbackScore >= 1) {
    return "feedbackrespuesta";
  } else {
    return "ambiguous";
  }
}

/**
 * processFeedbackResponse - Procesa la respuesta de retroalimentación del solicitante.
 *
 * @param {Object} client - El cliente de WhatsApp.
 * @param {Object} message - El mensaje de feedback recibido.
 * @param {Object} incidence - La incidencia correspondiente.
 * @returns {Promise<string>} - Mensaje resultante.
 */
async function processFeedbackResponse(client, message, incidence) {
  const responseText = message.body;
  const responseType = detectResponseType(client, responseText);
  
  if (responseType === "feedbackrespuesta") {
    const feedbackRecord = {
      usuario: message.author || message.from,
      comentario: message.body,
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
    return "No se reconoció un tipo de respuesta válida.";
  }
}

/**
 * processTeamFeedbackResponse - Procesa la respuesta enviada en los grupos destino.
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
  
  if (!quotedText.includes("Se solicita retroalimentacion para la tarea:")) {
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
  
  const responseTypeDetected = detectResponseType(client, message.body);
  console.log("Tipo de respuesta detectado:", responseTypeDetected);
  
  if (responseTypeDetected === "ambiguous") {
    return "No se pudo determinar si tu respuesta es feedback. Por favor, responde indicando explícitamente tu comentario.";
  } else if (responseTypeDetected === "feedbackrespuesta") {
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
 * getFeedbackConfirmationMessage - Consulta en la BD la incidencia correspondiente
 * al identificador y construye un mensaje de retroalimentación.
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
    return `ESTA TAREA HA SIDO COMPLETADA.\nFecha de creación: ${incidence.fechaCreacion}\nFecha de finalización: ${completionTime.format("YYYY-MM-DD HH:mm")}\nTiempo activo: ${days} día(s), ${hours} hora(s), ${minutes} minuto(s)`;
  } else {
    return `RETROALIMENTACION SOLICITADA PARA:\n${incidence.descripcion}\nID: ${incidence.id}\nCategoría: ${incidence.categoria}`;
  }
}

/**
 * handleFeedbackRequestFromOrigin - Procesa la solicitud de retroalimentación en el grupo ORIGEN.
 * Se utiliza la nueva categoría "retro" para detectar los indicadores.
 *
 * @param {Object} client - El cliente de WhatsApp (con client.keywordsData).
 * @param {Object} message - El mensaje recibido en el grupo ORIGEN.
 */
async function handleFeedbackRequestFromOrigin(client, message) {
  if (!message.hasQuotedMsg) {
    console.log("El mensaje no cita ningún mensaje, no se procesa feedback.");
    return;
  }
  
  const responseText = normalizeText(message.body);
  const retroPhrases = client.keywordsData.retro?.frases || [];
  const retroWords = client.keywordsData.retro?.palabras || [];
  
  let foundIndicator = false;
  for (let phrase of retroPhrases) {
    if (responseText.includes(normalizeText(phrase))) {
      foundIndicator = true;
      break;
    }
  }
  if (!foundIndicator) {
    const responseWords = new Set(responseText.split(/\s+/));
    for (let word of retroWords) {
      if (responseWords.has(normalizeText(word))) {
        foundIndicator = true;
        break;
      }
    }
  }
  
  if (!foundIndicator) {
    console.log("El mensaje no contiene indicadores para solicitud de feedback.");
    return;
  }
  
  const quotedMessage = await message.getQuotedMessage();
  const regex = /ID:\s*(\d+)/i;
  const match = quotedMessage.body.match(regex);
  if (!match) {
    console.log("No se encontró el ID en el mensaje citado.");
    return;
  }
  
  const incidenceId = match[1];
  console.log("ID extraído del mensaje citado:", incidenceId);
  
  let incidence = await new Promise((resolve, reject) => {
    incidenceDB.getIncidenciaById(incidenceId, (err, row) => {
      if (err) {
        console.error("Error al obtener la incidencia:", err);
        return reject(err);
      }
      resolve(row);
    });
  });
  
  if (!incidence) {
    console.log("No se encontró la incidencia con ID:", incidenceId);
    return;
  }
  
  await require('./feedbackNotifier').sendFeedbackRequestToGroups(client, incidence);
  console.log("Solicitud de retroalimentación reenviada desde el grupo ORIGEN.");
}

module.exports = { 
  detectFeedbackRequest, 
  extractFeedbackIdentifier, 
  detectResponseType,
  processFeedbackResponse,
  processTeamFeedbackResponse,
  getFeedbackConfirmationMessage,
  handleFeedbackRequestFromOrigin,
  normalizeText
};
