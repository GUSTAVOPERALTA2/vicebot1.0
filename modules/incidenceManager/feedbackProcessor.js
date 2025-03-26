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
  
  // Si es un mensaje de detalles generado por /tareaDetalles:
  if (text.includes("Detalles de la incidencia")) {
    const regex = /Detalles de la incidencia\s*\(ID:\s*(\d+)\)/i;
    const match = text.match(regex);
    if (match) {
      console.log("Identificador numérico encontrado en mensaje de detalles:", match[1]);
      return match[1];
    }
  }
  
  // Caso contrario, se utiliza la metadata del mensaje citado.
  if (quotedMessage.id && quotedMessage.id._serialized) {
    console.log("Extrayendo identificador del mensaje citado (metadata):", quotedMessage.id._serialized);
    return quotedMessage.id._serialized;
  }
  
  console.log("No se encontró identificador en el mensaje citado.");
  return null;
}

/**
 * detectResponseType - Determina el tipo de respuesta a partir del texto.
 * Se combinan fuzzy matching, análisis de longitud y se retorna "ambiguous"
 * si la respuesta es poco clara.
 *
 * @param {Object} client - El cliente de WhatsApp (con client.keywordsData).
 * @param {string} text - El texto de la respuesta.
 * @returns {string} - "confirmacion", "feedbackrespuesta" o "ambiguous".
 */
function detectResponseType(client, text) {
  const normalizedText = text.trim().toLowerCase();
  const wordCount = normalizedText.split(/\s+/).length;
  const threshold = 0.7; // umbral para fuzzy matching
  
  const confPalabras = client.keywordsData.respuestas?.confirmacion?.palabras || [];
  const confFrases = client.keywordsData.respuestas?.confirmacion?.frases || [];
  const fbPalabras = client.keywordsData.respuestas?.feedback?.palabras || [];
  const fbFrases = client.keywordsData.respuestas?.feedback?.frases || [];
  
  let confirmationScore = 0;
  let feedbackScore = 0;
  
  // Bonus para mensajes cortos (más propensos a ser confirmación)
  if (wordCount <= 3) {
    confirmationScore += 0.2;
  }
  
  // Comparación exacta
  if (confPalabras.includes(normalizedText)) confirmationScore += 1;
  confFrases.forEach(phrase => {
    if (normalizedText.includes(phrase.toLowerCase())) {
      confirmationScore += 1;
    }
  });
  if (fbPalabras.includes(normalizedText)) feedbackScore += 1;
  fbFrases.forEach(phrase => {
    if (normalizedText.includes(phrase.toLowerCase())) {
      feedbackScore += 1;
    }
  });
  
  // Fuzzy matching
  confPalabras.forEach(word => {
    const sim = simpleFuzzyMatch(normalizedText, word.toLowerCase());
    if (sim >= threshold) confirmationScore += 0.8;
  });
  confFrases.forEach(phrase => {
    const sim = simpleFuzzyMatch(normalizedText, phrase.toLowerCase());
    if (sim >= threshold) confirmationScore += 0.8;
  });
  fbPalabras.forEach(word => {
    const sim = simpleFuzzyMatch(normalizedText, word.toLowerCase());
    if (sim >= threshold) feedbackScore += 0.8;
  });
  fbFrases.forEach(phrase => {
    const sim = simpleFuzzyMatch(normalizedText, phrase.toLowerCase());
    if (sim >= threshold) feedbackScore += 0.8;
  });
  
  console.log("confirmationScore:", confirmationScore, "feedbackScore:", feedbackScore);
  
  // Si la diferencia es pequeña, se considera ambigua
  if (Math.abs(confirmationScore - feedbackScore) < 0.5) {
    return "ambiguous";
  }
  return confirmationScore > feedbackScore ? "confirmacion" : "feedbackrespuesta";
}

/**
 * processFeedbackResponse - Procesa la respuesta de retroalimentación del solicitante.
 * (Para respuestas directas del solicitante, no del grupo destino).
 *
 * @param {Object} client - El cliente de WhatsApp.
 * @param {Object} message - El mensaje de feedback recibido.
 * @param {Object} incidence - La incidencia correspondiente.
 * @returns {Promise<string>} - Mensaje resultante.
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
  } else if (responseType === "feedbackrespuesta") {
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
 * processTeamFeedbackResponse - Procesa la respuesta enviada en los grupos destino.
 * Diferencia entre confirmación y feedback utilizando la nueva estrategia.
 * En caso de ambigüedad, solicita aclaración al usuario.
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
  
  // Verificar que el mensaje citado sea una solicitud de retroalimentación
  if (!quotedText.includes("Se solicita retroalimentacion para la tarea:")) {
    console.log("El mensaje citado no corresponde a una solicitud de retroalimentación.");
    return "El mensaje citado no es una solicitud válida de retroalimentación.";
  }
  
  // Extraer el ID numérico de la incidencia
  const regex = /ID:\s*(\d+)/i;
  const match = quotedText.match(regex);
  if (!match) {
    console.log("No se pudo extraer el ID de la incidencia del mensaje citado.");
    return "No se pudo extraer el ID de la incidencia del mensaje citado.";
  }
  const incidenceId = match[1];
  console.log("ID extraído del mensaje citado:", incidenceId);
  
  // Consultar la incidencia en la BD
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
  
  // Determinar el equipo a partir del ID del chat destino
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
  
  // Determinar el tipo de respuesta usando la nueva estrategia
  const responseType = detectResponseType(client, message.body);
  console.log("Tipo de respuesta detectado:", responseType);
  
  if (responseType === "ambiguous") {
    return "No se pudo determinar si tu respuesta es confirmación o feedback. Por favor, responde indicando explícitamente 'confirmacion' o 'feedback'.";
  }
  
  if (responseType === "confirmacion") {
    return new Promise((resolve, reject) => {
      incidenceDB.updateIncidenciaStatus(incidence.id, "completada", async (err) => {
        if (err) {
          console.error("Error al actualizar la incidencia:", err);
          return reject("Error al actualizar la incidencia.");
        }
        await quotedMessage.reply(`La incidencia (ID: ${incidence.id}) ha sido marcada como COMPLETADA.`);
        resolve(`Incidencia ${incidence.id} marcada como COMPLETADA.`);
      });
    });
  } else if (responseType === "feedbackrespuesta") {
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
    return `ESTA TAREA HA SIDO COMPLETADA.\nFecha de creación: ${incidence.fechaCreacion}\nFecha de finalización: ${completionTime.format("YYYY-MM-DD HH:mm")}\nTiempo activo: ${days} día(s), ${hours} hora(s), ${minutes} minuto(s)`;
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

//nuevo processor