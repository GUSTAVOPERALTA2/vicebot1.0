const incidenceDB = require('./incidenceDB');
const moment = require('moment');
const config = require('../../config/config');
// Importamos processConfirmation para delegar el procesamiento de confirmaciones
const { processConfirmation } = require('./confirmationProcessor');

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
  const feedbackWords = client.keywordsData.respuestas.feedback?.palabras || [];
  const feedbackPhrases = client.keywordsData.respuestas.feedback?.frases || [];
  
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
 */
function detectResponseType(client, text) {
  const normalizedText = text.trim().toLowerCase();
  const confPalabras = client.keywordsData.respuestas.confirmacion?.palabras || [];
  const confFrases = client.keywordsData.respuestas.confirmacion?.frases || [];
  const fbRespPalabras = client.keywordsData.respuestas.feedback?.palabras || [];
  const fbRespFrases = client.keywordsData.respuestas.feedback?.frases || [];
  
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
      comentario: message.body,
      fecha: new Date().toISOString(),
      equipo: team, 
      tipo: "feedbackrespuesta"
    };
    // Ahora llamamos a updateFeedbackHistory para agregar el registro
    incidenceDB.updateFeedbackHistory(incidence.id, feedbackRecord, (err) => {
      if (err) {
        console.error("Error al registrar el feedback:", err);
        // Puedes manejar el error o rechazar la promesa
        return;
      }
      console.log(`Feedback registrado para la incidencia ID ${incidence.id}:`, feedbackRecord);
      // Luego se envía el mensaje al grupo principal
      const responseMsg = `RESPUESTA DE RETROALIMENTACION\n` +
            `${incidence.descripcion}\n\n` +
            `ID: ${incidence.id}\n\n` +
            `${team.toUpperCase()} RESPONDE:\n${message.body}`;
      client.getChatById(config.groupPruebaId)
        .then(mainGroupChat => {
          mainGroupChat.sendMessage(responseMsg)
            .then(() => {
              console.log("Mensaje enviado al grupo principal:", responseMsg);
            })
            .catch(err => {
              console.error("Error al enviar mensaje al grupo principal:", err);
            });
          })
          .catch(err => {
            console.error("Error al obtener chat principal:", err);
          });
        });
      }
}


/**
 * determineTeamFromGroup - Determina el equipo (it, man, ama) a partir del chat del mensaje.
 */
async function determineTeamFromGroup(message) {
  try {
    const chat = await message.getChat();
    const chatId = chat.id._serialized;
    for (const [key, groupId] of Object.entries(config.destinoGrupos)) {
      if (groupId === chatId) {
        return key;
      }
    }
    return "desconocido";
  } catch (error) {
    console.error("Error al determinar el equipo desde el grupo:", error);
    return "desconocido";
  }
}

/**
 * generarComentarios - Genera una sección de comentarios a partir del historial de feedback.
 */
function generarComentarios(incidence, requiredTeams, teamNames) {
  let comentarios = "";
  let feedbackHistory = [];
  try {
    if (typeof incidence.feedbackHistory === "string") {
      feedbackHistory = JSON.parse(incidence.feedbackHistory);
    } else if (Array.isArray(incidence.feedbackHistory)) {
      feedbackHistory = incidence.feedbackHistory;
    }
  } catch (e) {
    feedbackHistory = [];
  }
  for (let team of requiredTeams) {
    const displayName = teamNames[team] || team.toUpperCase();
    const record = feedbackHistory.filter(r => r.equipo && r.equipo.toLowerCase() === team).pop();
    const comentario = record && record.comentario ? record.comentario : "Sin comentarios";
    comentarios += `${displayName}: ${comentario}\n`;
  }
  return comentarios;
}

/**
 * processTeamFeedbackResponse - Procesa la respuesta enviada en grupos destino y envía al grupo principal.
 * 
 * - Si se detecta confirmación (palabras de confirmación), se delega el proceso a processConfirmation.
 * - Si no, se asume feedback y se envía:
 * 
 *   RESPUESTA DE RETROALIMENTACION
 *   {incidence.descripcion}
 *   
 *   {EQUIPO} RESPONDE:
 *   {respuesta del equipo}
 */
async function processTeamFeedbackResponse(client, message) {
  if (!message.hasQuotedMsg) {
    console.log("El mensaje del equipo no cita ningún mensaje de solicitud.");
    return "El mensaje no cita la solicitud de retroalimentación.";
  }
  
  const quotedMessage = await message.getQuotedMessage();
  // Normalizamos el texto citado: eliminamos asteriscos, espacios extra y convertimos a minúsculas.
  const normalizedQuotedText = quotedMessage.body.replace(/\*/g, '').trim().toLowerCase();
  
  // Determinar el tipo de mensaje citado según su inicio
  let messageType = null;
  if (normalizedQuotedText.startsWith("recordatorio: tarea incompleta")) {
    messageType = "recordatorio";
  } else if (normalizedQuotedText.startsWith("solicitud de retroalimentacion para la tarea")) {
    messageType = "retroalimentacion";
  } else if (normalizedQuotedText.startsWith("nueva tarea recibida")) {
    messageType = "nueva";
  } else {
    console.log("El mensaje citado no corresponde a una solicitud válida de retroalimentación.");
    return "El mensaje citado no es una solicitud válida de retroalimentación.";
  }
  
  // Extraer el ID de la incidencia según el tipo de mensaje citado
  let incidenceId;
  if (messageType === "retroalimentacion") {
    // Ejemplo esperado: "solicitud de retroalimentacion para la tarea 9:"
    const regex = /solicitud de retroalimentacion para la tarea\s*(\d+):/i;
    const match = normalizedQuotedText.match(regex);
    if (match) {
      incidenceId = match[1];
    }
  } else if (messageType === "recordatorio" || messageType === "nueva") {
    // Ejemplo esperado: "recordatorio: tarea incompleta ... ID: 2" o "nueva tarea recibida (ID: 9):"
    const regex = /id:\s*(\d+)/i;
    const match = normalizedQuotedText.match(regex);
    if (match) {
      incidenceId = match[1];
    }
  }
  
  if (!incidenceId) {
    console.log("No se pudo extraer el ID de la incidencia del mensaje citado.");
    return "No se pudo extraer el ID de la incidencia del mensaje citado.";
  }
  
  console.log("ID extraído del mensaje citado:", incidenceId);
  
  // Obtener la incidencia de la base de datos
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
  
  // Determinar el equipo a partir del grupo destino
  const team = await determineTeamFromGroup(message);
  
  // Detectar el tipo de respuesta en el mensaje del equipo (por ejemplo, "listo" para confirmación)
  const responseType = detectResponseType(client, message.body);
  
  // Flujo según el tipo de mensaje citado:
  // Para "recordatorio" y "nueva", se procesa siempre como confirmación.
  if (messageType === "recordatorio" || messageType === "nueva") {
    console.log(`Procesando ${messageType} como confirmación.`);
    return processConfirmation(client, message);
  } 
  // Para "retroalimentacion", se decide según el contenido de la respuesta
  else if (messageType === "retroalimentacion") {
    if (responseType === "confirmacion") {
      console.log("Respuesta de confirmación detectada en solicitud de retroalimentación.");
      return processConfirmation(client, message);
    } else {
      console.log("Procesando respuesta de retroalimentación (feedback).");
      // Construir el objeto de feedback
      const feedbackRecord = {
        usuario: message.author || message.from,
        comentario: message.body,
        fecha: new Date().toISOString(),
        equipo: team,
        tipo: "feedbackrespuesta"
      };
      
      return new Promise((resolve, reject) => {
        incidenceDB.updateFeedbackHistory(incidence.id, feedbackRecord, (err) => {
          if (err) {
            console.error("Error al registrar el feedback:", err);
            return reject("Error al registrar el feedback.");
          }
          console.log(`Feedback registrado para la incidencia ID ${incidence.id}:`, feedbackRecord);
          
          const responseMsg = `RESPUESTA DE RETROALIMENTACION\n` +
                              `${incidence.descripcion}\n\n` +
                              `${team.toUpperCase()} RESPONDE:\n${message.body}`;
          
          client.getChatById(config.groupPruebaId)
            .then(mainGroupChat => {
              mainGroupChat.sendMessage(responseMsg)
                .then(() => {
                  console.log("Mensaje enviado al grupo principal:", responseMsg);
                  resolve("Feedback del equipo registrado correctamente y mensaje enviado al grupo principal.");
                })
                .catch(err => {
                  console.error("Error al enviar mensaje al grupo principal:", err);
                  resolve("Feedback del equipo registrado correctamente, pero error al enviar mensaje al grupo principal.");
                });
            })
            .catch(err => {
              console.error("Error al obtener chat principal:", err);
              resolve("Feedback del equipo registrado correctamente, pero error al obtener chat principal.");
            });
        });
      });
    }
  }
}


/**
 * getFeedbackConfirmationMessage - Consulta en la BD la incidencia y construye un mensaje de retroalimentación.
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
    const duration = moment.duration(completionTime.diff(incidence.fechaCreacion));
    const days = Math.floor(duration.asDays());
    const hours = duration.hours();
    const minutes = duration.minutes();
    return `ESTA TAREA HA SIDO COMPLETADA.\nFecha de creación: ${incidence.fechaCreacion}\nFecha de finalización: ${completionTime.format("YYYY-MM-DD HH:mm")}\nTiempo activo: ${days} día(s), ${hours} hora(s), ${minutes} minuto(s)`;
  } else {
    return `RETROALIMENTACION SOLICITADA PARA:\n${incidence.descripcion}\nID: ${incidence.id}\nCategoría: ${incidence.categoria}`;
  }
}

/**
 * detectRetroRequest - Detecta si un mensaje es una solicitud de retroalimentación
 * usando la categoría "retro".
 */
async function detectRetroRequest(client, message) {
  const responseText = message.body.toLowerCase();
  const retroData = client.keywordsData.identificadores.retro;
  if (!retroData) {
    console.log("No existe la categoría 'retro' en las keywords.");
    return false;
  }
  const responseWords = new Set(responseText.split(/\s+/));
  const foundKeyword = retroData.palabras.some(word => responseWords.has(word.toLowerCase()));
  const foundPhrase = retroData.frases.some(phrase => responseText.includes(phrase.toLowerCase()));
  console.log(`Retro: foundKeyword=${foundKeyword}, foundPhrase=${foundPhrase}`);
  return foundKeyword || foundPhrase;
}

/**
 * processRetroRequest - Procesa la solicitud de retroalimentación para la categoría "retro".
 */
async function processRetroRequest(client, message) {
  const chat = await message.getChat();
  if (!message.hasQuotedMsg) {
    await chat.sendMessage("El mensaje de retroalimentación no hace énfasis en ninguna incidencia.");
    return;
  }
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
  if (!incidence) {
    await chat.sendMessage("No se encontró la incidencia correspondiente.");
    return;
  }

  // Nueva validación: Si la incidencia ya está cancelada, se impide la solicitud de retroalimentación.
  if (incidence.estado.toLowerCase() === "cancelada") {
    await chat.sendMessage("La incidencia está cancelada y no se puede solicitar retroalimentación.");
    return;
  }
  const categories = incidence.categoria.split(',').map(c => c.trim().toLowerCase());
  const teamNames = { it: "IT", man: "MANTENIMIENTO", ama: "AMA" };
  let gruposEnviados = [];
  for (const cat of categories) {
    if (incidence.confirmaciones && incidence.confirmaciones[cat]) {
      console.log(`La categoría ${cat} ya ha confirmado, no se envía retroalimentación.`);
      continue;
    }
    const groupDest = config.destinoGrupos[cat];
    if (!groupDest) {
      console.log(`No se encontró grupo asignado para la categoría: ${cat}`);
      continue;
    }
    const retroResponse = `*SOLICITUD DE RETROALIMENTACION PARA LA TAREA ${incidence.id}:*\n` +
                            `${incidence.descripcion}\n` +
                            `Por favor, proporcione sus comentarios`;
    try {
      const targetChat = await client.getChatById(groupDest);
      await targetChat.sendMessage(retroResponse);
      console.log(`Solicitud de retroalimentación enviada al grupo de ${teamNames[cat] || cat.toUpperCase()}.`);
      gruposEnviados.push(teamNames[cat] || cat.toUpperCase());
    } catch (error) {
      console.error(`Error al enviar retroalimentación al grupo de ${teamNames[cat] || cat.toUpperCase()}:`, error);
    }
  }
  if (gruposEnviados.length > 0) {
    await chat.sendMessage(`Solicitud de retroalimentación procesada correctamente para: *${gruposEnviados.join(", ")}*`);
  } else {
    await chat.sendMessage("No se envió solicitud de retroalimentación, ya que todas las categorías han confirmado.");
  }
}

module.exports = { 
  detectFeedbackRequest, 
  extractFeedbackIdentifier, 
  detectResponseType,
  processFeedbackResponse,
  processTeamFeedbackResponse,
  getFeedbackConfirmationMessage,
  detectRetroRequest,
  processRetroRequest
};


//nuevo feedback 2
