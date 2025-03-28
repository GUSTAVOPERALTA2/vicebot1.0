const incidenceDB = require('./incidenceDB');
const moment = require('moment');
const config = require('../../config/config');

/**
 * detectFeedbackRequest - Detecta si un mensaje que cita una incidencia
 * contiene palabras o frases indicativas de solicitar retroalimentación.
 */
async function detectFeedbackRequest(client, message) {
  if (!message.hasQuotedMsg) {
    console.log("El mensaje no cita ningún mensaje.");
    return false;
  }
  
  const responseText = message.body.toLowerCase();
  // Se usan las keywords de retroalimentación definidas en la categoría "retro"
  const feedbackWords = client.keywordsData.retro?.palabras || [];
  const feedbackPhrases = client.keywordsData.retro?.frases || [];
  
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
 * se intenta extraer el id numérico mediante regex; si no se logra, se utiliza el campo originalMsgId (metadata).
 */
async function extractFeedbackIdentifier(quotedMessage) {
  const text = quotedMessage.body;
  console.log("Texto del mensaje citado:", text);
  
  if (text.includes("Detalles de la incidencia")) {
    const regex = /Detalles de la incidencia\s*\(ID:\s*(\d+)\)/i;
    const match = text.match(regex);
    if (match && match[1]) {
      console.log("Identificador numérico encontrado en mensaje de detalles:", match[1]);
      return match[1];
    }
  }
  
  if (quotedMessage.id && quotedMessage.id._serialized) {
    console.log("No se pudo extraer el ID del texto. Usando el campo originalMsgId:", quotedMessage.id._serialized);
    return quotedMessage.id._serialized;
  }
  
  console.log("No se encontró identificador en el mensaje citado.");
  return null;
}

/**
 * detectResponseType - Determina el tipo de respuesta a partir del texto.
 * Retorna "confirmacion" si se detectan palabras/frases de confirmación,
 * "feedbackrespuesta" si se detectan frases de retroalimentación del equipo o "none".
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
 * processFeedbackResponse - Procesa la respuesta de retroalimentación del solicitante.
 * (Se usa cuando el solicitante responde directamente, no en el grupo destino).
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
 * processTeamFeedbackResponse - Procesa la respuesta de retroalimentación enviada
 * en los grupos destino (por el equipo). [Versión anterior; se mantiene para otros usos]
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
          return key;
        }
      }
    }
    return "desconocido";
  }
  const team = determineTeamFromGroup(message);
  
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
}

/**
 * processTeamRetroFeedbackResponse - Procesa la respuesta del equipo en el grupo destino
 * cuando se responde a una solicitud de retroalimentación.
 *
 * Si se detectan palabras de confirmación (mediante detectResponseType), se actualiza el estado a "completada"
 * y se ejecuta el proceso final de conclusión de tarea.
 *
 * Si no se detectan palabras de confirmación, se guarda el comentario en el historial y se reenvía al grupo principal con el formato:
 *
 * RETROALIMENTACION A LA TAREA {ID}:
 * {tarea original}
 *
 * RESPUESTA:
 * {respuesta del equipo}
 */
async function processTeamRetroFeedbackResponse(client, message) {
  if (!message.hasQuotedMsg) {
    console.log("El mensaje del equipo no cita ningún mensaje de solicitud de retroalimentación.");
    return "El mensaje no cita la solicitud de retroalimentación.";
  }
  
  const quotedMessage = await message.getQuotedMessage();
  const quotedText = quotedMessage.body;
  
  if (!quotedText.includes("SOLICITUD DE RETROALIMENTACION PARA LA TAREA")) {
    console.log("El mensaje citado no corresponde a una solicitud de retroalimentación.");
    return "El mensaje citado no es una solicitud válida de retroalimentación.";
  }
  
  const regex = /\*SOLICITUD DE RETROALIMENTACION PARA LA TAREA (\d+):\*/i;
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
  let team = determineTeamFromGroup(message);
  const categories = incidence.categoria.split(',').map(c => c.trim().toLowerCase());
  const primaryCategory = categories[0];
  if (team === "desconocido") {
    team = primaryCategory;
  }
  
  const responseText = message.body.toLowerCase();
  const responseType = detectResponseType(client, responseText);
  
  if (responseType === "confirmacion") {
    return new Promise((resolve, reject) => {
      incidenceDB.updateIncidenciaStatus(incidence.id, "completada", async (err) => {
        if (err) return reject("Error al actualizar la incidencia.");
        await quotedMessage.reply(`La incidencia (ID: ${incidence.id}) ha sido marcada como COMPLETADA.`);
        const { enviarConfirmacionGlobal } = require('./confirmationProcessor');
        await enviarConfirmacionGlobal(client, incidence, incidence.id, team);
        resolve(`La incidencia ${incidence.id} se ha marcado como COMPLETADA.`);
      });
    });
  } else {
    const feedbackRecord = {
      usuario: message.author || message.from,
      comentario: message.body,
      fecha: new Date().toISOString(),
      equipo: team
    };
    return new Promise((resolve, reject) => {
      incidenceDB.updateFeedbackHistory(incidence.id, feedbackRecord, async (err) => {
        if (err) return reject("Error al registrar el feedback.");
        const retroMessage = `RETROALIMENTACION A LA TAREA ${incidence.id}:\n` +
                               `${incidence.descripcion}\n\n` +
                               `RESPUESTA:\n${message.body}`;
        const mainChat = await client.getChatById(config.groupPruebaId);
        await mainChat.sendMessage(retroMessage);
        resolve("Feedback registrado y enviado al grupo principal.");
      });
    });
  }
}

/**
 * isRetroRequest - Verifica si el mensaje actual es una solicitud de retroalimentación.
 * Requisitos:
 *  1. El mensaje debe citar otro mensaje.
 *  2. El mensaje citado debe permitir obtener un identificador de incidencia.
 *  3. El mensaje actual debe contener al menos una palabra o frase de la categoría "retro".
 *
 * @param {Object} client - El cliente de WhatsApp con las keywords cargadas.
 * @param {Object} message - El mensaje recibido.
 * @returns {Promise<boolean>} - true si se cumplen todas las condiciones, false en caso contrario.
 */
async function isRetroRequest(client, message) {
  console.log("Keywords cargadas en isRetroRequest:", client.keywordsData);
  
  if (!message.hasQuotedMsg) {
    console.log("Mensaje no cita ningún mensaje.");
    return false;
  }
  
  const quotedMessage = await message.getQuotedMessage();
  const identifier = await extractFeedbackIdentifier(quotedMessage);
  if (!identifier) {
    console.log("No se pudo extraer el identificador de la incidencia del mensaje citado.");
    return false;
  }
  
  const messageText = message.body.toLowerCase();
  // Se usa retroData; si no existe, se asigna un objeto vacío para evitar errores.
  const retroData = client.keywordsData.retro || { palabras: [], frases: [] };
  
  if (!retroData.palabras.length && !retroData.frases.length) {
    console.log("No se encontró configuración para la categoría retro.");
    return false;
  }
  
  const containsKeyword = retroData.palabras.some(word => messageText.includes(word.toLowerCase()));
  const containsPhrase = retroData.frases.some(phrase => messageText.includes(phrase.toLowerCase()));
  
  console.log("isRetroRequest: containsKeyword:", containsKeyword, "containsPhrase:", containsPhrase);
  
  return containsKeyword || containsPhrase;
}
module.exports = { 
  detectFeedbackRequest, 
  extractFeedbackIdentifier, 
  detectResponseType,
  processFeedbackResponse,
  processTeamFeedbackResponse,
  processTeamRetroFeedbackResponse,
  isRetroRequest
};

//nuevo fellback