const config = require('../../config/config');
const incidenceDB = require('./incidenceDB');
const moment = require('moment-timezone');

/**
 * Procesa un mensaje de confirmación recibido en los grupos destino.
 * Realiza:
 *  - Validación del mensaje citado y extracción del ID de la incidencia.
 *    Se limpia el texto citado para quitar asteriscos y espacios iniciales, 
 *    y se acepta si comienza con alguno de estos patrones:
 *      "recordatorio: tarea incompleta*",
 *      "nueva tarea recibida",
 *      "recordatorio: incidencia",
 *      "solicitud de retroalimentacion para la tarea".
 *    Se intenta extraer el ID usando primero el patrón:
 *      /SOLICITUD DE RETROALIMENTACION PARA LA TAREA\s*(\d+):/i
 *    y, si no se encuentra, se usa el patrón tradicional:
 *      /\(ID:\s*(\d+)\)|ID:\s*(\d+)/.
 *  - Detección de palabras/frases de confirmación usando client.keywordsData.
 *  - Actualización del objeto incidencia en la BD, tanto de las confirmaciones como del historial de feedback.
 *  - Envío de un mensaje parcial o final al grupo principal.
 */
async function processConfirmation(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;
  console.log("Procesando mensaje de confirmación en grupo destino.");

  if (!message.hasQuotedMsg) {
    console.log("El mensaje no cita ningún mensaje. Se ignora.");
    return;
  }
  const quotedMessage = await message.getQuotedMessage();
  
  // Limpiar el texto citado para quitar asteriscos y espacios iniciales
  const cleanedQuotedText = quotedMessage.body.trim().replace(/^\*+/, "").toLowerCase();
  
  // Se aceptan mensajes que inicien con cualquiera de estos patrones:
  if (!(cleanedQuotedText.startsWith("recordatorio: tarea incompleta*") ||
        cleanedQuotedText.startsWith("nueva tarea recibida") ||
        cleanedQuotedText.startsWith("recordatorio: incidencia") ||
        cleanedQuotedText.startsWith("solicitud de retroalimentacion para la tarea"))) {
    console.log("El mensaje citado no corresponde a una tarea enviada, recordatorio o solicitud de retroalimentación. Se ignora.");
    return;
  }
  
  // Intentar extraer el ID usando el patrón de solicitud de retroalimentación
  let idMatch = quotedMessage.body.match(/SOLICITUD DE RETROALIMENTACION PARA LA TAREA\s*(\d+):/i);
  // Si no se encuentra, usar el patrón tradicional
  if (!idMatch) {
    idMatch = quotedMessage.body.match(/\(ID:\s*(\d+)\)|ID:\s*(\d+)/);
  }
  if (!idMatch) {
    console.log("No se encontró el ID en el mensaje citado. No se actualizará el estado.");
    return;
  }
  const incidenciaId = idMatch[1] || idMatch[2];

  const responseText = message.body.toLowerCase();
  const responseWords = new Set(responseText.split(/\s+/));
  const confirmPhraseFound = client.keywordsData.respuestas.confirmacion.frases.some(phrase =>
    responseText.includes(phrase.toLowerCase())
  );
  const confirmWordFound = client.keywordsData.respuestas.confirmacion.palabras.some(word =>
    responseWords.has(word.toLowerCase())
  );
  console.log(`Confirmación detectada: confirmPhraseFound=${confirmPhraseFound}, confirmWordFound=${confirmWordFound}`);
  if (!(confirmPhraseFound || confirmWordFound)) {
    console.log("No se detectó confirmación en el mensaje. Se ignora.");
    return;
  }
  
  incidenceDB.getIncidenciaById(incidenciaId, async (err, incidencia) => {
    if (err || !incidencia) {
      console.error("Error al obtener detalles de la incidencia para confirmación.");
      return;
    }
    
    // Determinar el equipo que responde según el id del chat
    let categoriaConfirmada = "";
    if (chatId === config.groupBotDestinoId) {
      categoriaConfirmada = "it";
    } else if (chatId === config.groupMantenimientoId) {
      categoriaConfirmada = "man";
    } else if (chatId === config.groupAmaId) {
      categoriaConfirmada = "ama";
    }
    
    // Actualizar confirmaciones
    if (incidencia.confirmaciones && typeof incidencia.confirmaciones === "object") {
      incidencia.confirmaciones[categoriaConfirmada] = new Date().toISOString();
    } else {
      incidencia.confirmaciones = { [categoriaConfirmada]: new Date().toISOString() };
    }
    
    // Registrar en feedbackHistory el comentario de confirmación
    let history = [];
    try {
      if (typeof incidencia.feedbackHistory === "string") {
        history = JSON.parse(incidencia.feedbackHistory);
      } else if (Array.isArray(incidencia.feedbackHistory)) {
        history = incidencia.feedbackHistory;
      }
    } catch (e) {
      history = [];
    }
    const feedbackRecord = {
      usuario: message.author || message.from,
      comentario: message.body,
      fecha: new Date().toISOString(),
      equipo: categoriaConfirmada,
      tipo: "confirmacion"
    };
    history.push(feedbackRecord);
    
    incidenceDB.updateFeedbackHistory(incidenciaId, history, (err) => {
      if (err) {
        console.error("Error al actualizar feedbackHistory:", err);
      }
    });
    
    incidenceDB.updateConfirmaciones(incidenciaId, JSON.stringify(incidencia.confirmaciones), (err) => {
      if (err) {
        console.error("Error al actualizar confirmaciones:", err);
      } else {
        console.log(`Confirmación para categoría ${categoriaConfirmada} actualizada para incidencia ${incidenciaId}.`);
        const teamNames = { it: "IT", man: "MANTENIMIENTO", ama: "AMA" };
        const requiredTeams = incidencia.categoria.split(',').map(c => c.trim().toLowerCase());
        const confirmedTeams = incidencia.confirmaciones
          ? Object.keys(incidencia.confirmaciones).filter(k => {
              const ts = incidencia.confirmaciones[k];
              return ts && !isNaN(Date.parse(ts));
            })
          : [];
        const totalTeams = requiredTeams.length;
        const missingTeams = requiredTeams
          .filter(team => !confirmedTeams.includes(team))
          .map(team => teamNames[team] || team.toUpperCase());
        
        const responseTime = moment().diff(moment(incidencia.fechaCreacion));
        const diffDuration = moment.duration(responseTime);
        const diffResponseStr = `${Math.floor(diffDuration.asDays())} día(s), ${diffDuration.hours()} hora(s), ${diffDuration.minutes()} minuto(s)`;
        
        // Generar la sección de comentarios consultando el historial de feedback
        const comentarios = generarComentarios(incidencia, requiredTeams, teamNames);
        
        if (confirmedTeams.length < totalTeams) {
          client.getChatById(config.groupPruebaId)
            .then(mainGroupChat => {
              const partialMessage = `*ATENCIÓN TAREA EN FASE ${confirmedTeams.length} de ${totalTeams}*\n` +
                `${incidencia.descripcion}\n\n` +
                `Tarea terminada por:\n${confirmedTeams.length > 0 ? confirmedTeams.map(t => teamNames[t] || t.toUpperCase()).join(", ") : "Ninguno"}\n\n` +
                `Equipo(s) que faltan:\n${missingTeams.length > 0 ? missingTeams.join(", ") : "Ninguno"}\n\n` +
                `Comentarios:\n${comentarios}\n` +
                `⏱️Tiempo de respuesta: ${diffResponseStr}`;
              mainGroupChat.sendMessage(partialMessage)
                .then(() => console.log("Mensaje de confirmación parcial enviado:", partialMessage))
                .catch(e => console.error("Error al enviar confirmación parcial al grupo principal:", e));
            })
            .catch(e => console.error("Error al obtener el chat principal:", e));
        } else {
          incidenceDB.updateIncidenciaStatus(incidenciaId, "completada", async (err) => {
            if (err) {
              console.error("Error al actualizar la incidencia:", err);
              return;
            }
            await quotedMessage.reply(`La incidencia (ID: ${incidenciaId}) ha sido marcada como COMPLETADA.`);
            console.log(`Incidencia ${incidenciaId} actualizada a COMPLETADA en grupo destino.`);
            enviarConfirmacionGlobal(client, incidencia, incidenciaId, categoriaConfirmada);
          });
        }
      }
    });
  });
}

/**
 * generarComentarios - Recorre el historial de feedback y extrae el campo "comentario"
 * para cada equipo requerido. Si no existe registro para un equipo, muestra "Sin comentarios".
 */
function generarComentarios(incidencia, requiredTeams, teamNames) {
  let comentarios = "";
  let feedbackHistory = [];
  try {
    if (typeof incidencia.feedbackHistory === "string") {
      feedbackHistory = JSON.parse(incidencia.feedbackHistory);
    } else if (Array.isArray(incidencia.feedbackHistory)) {
      feedbackHistory = incidencia.feedbackHistory;
    }
  } catch (e) {
    feedbackHistory = [];
  }
  for (let team of requiredTeams) {
    const displayName = teamNames[team] || team.toUpperCase();
    // Se filtra por feedback que contenga el campo "equipo"
    const record = feedbackHistory.filter(r => r.equipo && r.equipo.toLowerCase() === team).pop();
    const comentario = record && record.comentario ? record.comentario : "Sin comentarios";
    comentarios += `${displayName}: ${comentario}\n`;
  }
  return comentarios;
}

/**
 * enviarConfirmacionGlobal - Envía el mensaje final de confirmación al grupo principal.
 */
async function enviarConfirmacionGlobal(client, incidencia, incidenciaId, categoriaConfirmada) {
  let teamNames = {};
  if (incidencia.categoria) {
    incidencia.categoria.split(',').forEach(cat => {
      const t = cat.trim().toLowerCase();
      if (t === "it") teamNames[t] = "IT";
      else if (t === "man") teamNames[t] = "MANTENIMIENTO";
      else if (t === "ama") teamNames[t] = "AMA";
    });
  }
  const equiposInvolucrados = Object.values(teamNames).join(", ");
  
  let cronometros = "";
  if (incidencia.confirmaciones && typeof incidencia.confirmaciones === "object") {
    for (const [cat, confirmTime] of Object.entries(incidencia.confirmaciones)) {
      if (confirmTime !== false) {
        const team = teamNames[cat] || cat.toUpperCase();
        const diffDuration = moment.duration(moment(confirmTime).diff(moment(incidencia.fechaCreacion)));
        const diffStr = `${Math.floor(diffDuration.asDays())} día(s), ${diffDuration.hours()} hora(s), ${diffDuration.minutes()} minuto(s)`;
        cronometros += `Cronómetro ${team}: ${diffStr}\n`;
      }
    }
  }
  
  const creationTime = moment(incidencia.fechaCreacion);
  const formattedCreation = creationTime.format("DD/MM/YYYY hh:mm a");
  const confirmationTime = moment();
  const formattedConfirmation = confirmationTime.format("DD/MM/YYYY hh:mm a");
  const diffDurationGlobal = moment.duration(confirmationTime.diff(creationTime));
  const diffStrGlobal = `${Math.floor(diffDurationGlobal.asDays())} día(s), ${diffDurationGlobal.hours()} hora(s), ${diffDurationGlobal.minutes()} minuto(s)`;
  
  const confirmationMessage = `*ATENCIÓN*\n` +
    `Tarea de *${equiposInvolucrados}*:\n\n` +
    `${incidencia.descripcion}\n\n` +
    `ha sido *COMPLETADA*\n\n` +
    `*📅Creación:* ${incidencia.fechaCreacion}\n` +
    `*📅Conclusión:* ${formattedConfirmation}\n\n` +
    `*⏱️Se concluyó en:* ${diffStrGlobal}\n` +
    `${cronometros}` +
    `*ID:* ${incidenciaId}\n\n` +
    `*MUCHAS GRACIAS POR SU PACIENCIA* 😊`;
  
  try {
    const mainGroupChat = await client.getChatById(config.groupPruebaId);
    await mainGroupChat.sendMessage(confirmationMessage);
    console.log(`Confirmación final enviada al grupo principal: ${confirmationMessage}`);
  } catch (error) {
    console.error("Error al enviar confirmación al grupo principal:", error);
  }
}

module.exports = { processConfirmation };

//nuevo modulo