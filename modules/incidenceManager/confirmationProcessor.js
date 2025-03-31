const config = require('../../config/config');
const incidenceDB = require('./incidenceDB');
const moment = require('moment-timezone');

async function processConfirmation(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;
  console.log("Procesando mensaje de confirmación en grupo destino.");

  if (!message.hasQuotedMsg) {
    console.log("El mensaje no cita ningún mensaje. Se ignora.");
    return;
  }
  const quotedMessage = await message.getQuotedMessage();

  // Limpieza del texto citado: se eliminan asteriscos de inicio y fin, y se pasa a minúsculas
  let cleanedQuotedText = quotedMessage.body.trim().replace(/^\*+|\*+$/g, "").toLowerCase();
  console.log("Texto citado limpio:", cleanedQuotedText);

  // Se definen los patrones válidos para considerar el mensaje citado como una solicitud de retroalimentación
  const validPatterns = [
    /^solicitud de retroalimentacion para la tarea\s*\d+:/,  // Ej: "solicitud de retroalimentacion para la tarea 2:"
    /^recordatorio: tarea incompleta/,
    /^nueva tarea recibida/,
    /^recordatorio: incidencia/
  ];

  const isValid = validPatterns.some(pattern => pattern.test(cleanedQuotedText));
  if (!isValid) {
    console.log("El mensaje citado no corresponde a una tarea enviada, recordatorio o solicitud de retroalimentación. Se ignora.");
    return;
  }

  // Intentar extraer el ID usando el patrón de solicitud de retroalimentación
  let idMatch = cleanedQuotedText.match(/solicitud de retroalimentacion para la tarea\s*(\d+):/i);
  // Si no se encuentra, se usa el patrón tradicional que busca "(ID: X)" o "ID: X"
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
    
    // Actualizar la confirmación en la incidencia
    if (incidencia.confirmaciones && typeof incidencia.confirmaciones === "object") {
      incidencia.confirmaciones[categoriaConfirmada] = new Date().toISOString();
      incidenceDB.updateConfirmaciones(incidenciaId, JSON.stringify(incidencia.confirmaciones), (err) => {
        if (err) {
          console.error("Error al actualizar confirmaciones:", err);
        } else {
          console.log(`Confirmación para categoría ${categoriaConfirmada} actualizada para incidencia ${incidenciaId}.`);
          const confirmacionesValues = Object.values(incidencia.confirmaciones);
          const fase = confirmacionesValues.filter(val => val !== false).length;
          const totalTeams = Object.keys(incidencia.confirmaciones).length;
          if (fase < totalTeams) {
            const teamNames = { it: "IT", man: "MANTENIMIENTO", ama: "AMA DE LLAVES" };
            const missingTeams = Object.entries(incidencia.confirmaciones)
              .filter(([cat, val]) => val === false)
              .map(([cat]) => teamNames[cat] || cat.toUpperCase());
            const responseTime = moment().diff(moment(incidencia.fechaCreacion));
            const diffDuration = moment.duration(responseTime);
            const diffResponseStr = `${Math.floor(diffDuration.asDays())} día(s), ${diffDuration.hours()} hora(s), ${diffDuration.minutes()} minuto(s)`;
            
            const partialMessage = `*ATENCIÓN TAREA ESTA FASE ${fase}*\n` +
              `${incidencia.descripcion}\n\n` +
              `Tarea terminada por:\n${teamNames[categoriaConfirmada]}\n\n` +
              `Equipo(s) que faltan:\n${missingTeams.join(", ")}\n\n` +
              `⏱️Tiempo de respuesta: ${diffResponseStr}`;
            
            client.getChatById(config.groupPruebaId)
              .then(chat => {
                chat.sendMessage(partialMessage);
                console.log("Mensaje de confirmación parcial enviado al grupo principal:", partialMessage);
              })
              .catch(e => console.error("Error al enviar confirmación parcial al grupo principal:", e));
            return;
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
  });
}

/**
 * Función auxiliar para enviar el mensaje final de confirmación al grupo principal.
 */
async function enviarConfirmacionGlobal(client, incidencia, incidenciaId, categoriaConfirmada) {
  let teamNames = {};
  if (incidencia.categoria) {
    incidencia.categoria.split(',').forEach(cat => {
      const t = cat.trim().toLowerCase();
      if (t === "it") teamNames[t] = "IT";
      else if (t === "man") teamNames[t] = "MANTENIMIENTO";
      else if (t === "ama") teamNames[t] = "AMA DE LLAVES";
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
    `*📅Creación:* ${formattedCreation}\n` +
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
