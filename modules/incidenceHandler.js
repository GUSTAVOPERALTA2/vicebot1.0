// modules/incidenceHandler.js
const config = require('./config');
const incidenciasDB = require('./incidenciasDB');
const { MessageMedia } = require('whatsapp-web.js');
const moment = require('moment-timezone');

async function handleIncidence(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;

  // --- Procesamiento de nuevas incidencias en el grupo principal ---
  if (chatId === config.groupPruebaId) {
    console.log("Procesando mensaje de Grupo de Incidencias.");
    const messageText = message.body.toLowerCase();
    const cleanedMessage = messageText.replace(/[.,!?()]/g, '');
    if (!cleanedMessage.trim()) {
      console.log("El mensaje está vacío tras la limpieza. Se omite.");
      return;
    }
    const wordsSet = new Set(cleanedMessage.split(/\s+/));
    console.log("Conjunto de palabras:", wordsSet);

    const categories = ['it', 'ama', 'man'];
    let foundCategories = [];
    const keywordsData = client.keywordsData;
    for (let category of categories) {
      const data = keywordsData.identificadores[category];
      const foundKeyword = data.palabras.some(word => wordsSet.has(word.toLowerCase()));
      const foundPhrase = data.frases.some(phrase => messageText.includes(phrase.toLowerCase()));
      console.log(`Evaluando categoría ${category}: foundKeyword=${foundKeyword}, foundPhrase=${foundPhrase}`);
      if (foundKeyword || foundPhrase) {
        foundCategories.push(category);
      }
    }
    console.log("Categorías detectadas:", foundCategories);
    if (!foundCategories.length) {
      console.log("No se encontró ninguna categoría en el mensaje.");
      return;
    }
    console.log(`Registrando incidencia para categorías ${foundCategories.join(', ')}: ${message.body}`);

    // Si hay más de una categoría, creamos el objeto "confirmaciones" con valores iniciales false.
    let confirmaciones = null;
    if (foundCategories.length > 1) {
      confirmaciones = {};
      foundCategories.forEach(cat => {
        confirmaciones[cat] = false;
      });
    }
    
    // Descargar media, si existe
    let mediaData = null;
    if (message.hasMedia) {
      try {
        const media = await message.downloadMedia();
        if (media && media.data && media.mimetype) {
          mediaData = { data: media.data, mimetype: media.mimetype };
          console.log("Media descargada correctamente:", mediaData.mimetype);
        } else {
          console.log("Media descargada, pero no se encontró data o mimetype.");
        }
      } catch (err) {
        console.error("Error al descargar la media:", err);
      }
    }
    
    // Construir objeto incidencia
    const nuevaIncidencia = {
      descripcion: message.body,
      reportadoPor: message.author ? message.author : message.from,
      fechaCreacion: new Date().toISOString(),
      estado: "pendiente",
      categoria: foundCategories.join(', '),
      confirmaciones: confirmaciones, // Solo se usa si hay más de una categoría
      grupoOrigen: chatId,
      media: mediaData ? mediaData.data : null
    };
    
    incidenciasDB.insertarIncidencia(nuevaIncidencia, async (err, lastID) => {
      if (err) {
        console.error("Error al insertar incidencia en SQLite:", err);
      } else {
        console.log("Incidencia registrada con ID:", lastID);
    
        // Función para reenviar la incidencia a cada grupo destino según la categoría
        async function forwardMessage(targetGroupId, categoryLabel) {
          try {
            const targetChat = await client.getChatById(targetGroupId);
            if (mediaData && mediaData.data && mediaData.mimetype) {
              console.log(`Enviando mensaje con media a ${categoryLabel}...`);
              const mediaMessage = new MessageMedia(mediaData.mimetype, mediaData.data);
              await targetChat.sendMessage(
                mediaMessage,
                { caption: `Nueva tarea recibida (ID: ${lastID}):\n\n*${message.body}*` }
              );
            } else {
              await targetChat.sendMessage(`Nueva tarea recibida (ID: ${lastID}):\n\n*${message.body}*`);
            }
            console.log(`Mensaje reenviado a ${categoryLabel}: ${message.body} (ID: ${lastID})`);
          } catch (error) {
            console.error(`Error al reenviar mensaje a ${categoryLabel}:`, error);
          }
        }
        if (foundCategories.includes('it')) {
          await forwardMessage(config.groupBotDestinoId, 'IT');
        }
        if (foundCategories.includes('man')) {
          await forwardMessage(config.groupMantenimientoId, 'Mantenimiento');
        }
        if (foundCategories.includes('ama')) {
          await forwardMessage(config.groupAmaId, 'Ama de Llaves');
        }
    
        const teamNames = { it: "IT", ama: "Ama de Llaves", man: "Mantenimiento" };
        const teams = foundCategories.map(cat => teamNames[cat]);
        let teamList;
        if (teams.length === 1) {
          teamList = teams[0];
        } else if (teams.length === 2) {
          teamList = teams.join(" y ");
        } else if (teams.length >= 3) {
          teamList = teams.slice(0, teams.length - 1).join(", ") + " y " + teams[teams.length - 1];
        }
        await chat.sendMessage(`El mensaje se ha enviado al equipo de ${teamList}.`);
      }
    });
    return;
  }
  
  // --- Procesamiento para confirmación de incidencias en grupos destino ---
  if ([config.groupBotDestinoId, config.groupMantenimientoId, config.groupAmaId].includes(chatId)) {
    console.log("Procesando mensaje de confirmación en grupo destino.");
    if (!message.hasQuotedMsg) {
      console.log("El mensaje no cita ningún mensaje. Se ignora.");
      return;
    }
    const quotedMessage = await message.getQuotedMessage();
    const quotedBodyLower = quotedMessage.body.toLowerCase();
    if (!(quotedBodyLower.startsWith("*recordatorio: tarea incompleta*") ||
          quotedBodyLower.startsWith("nueva tarea recibida") ||
          quotedBodyLower.startsWith("recordatorio: incidencia"))) {
      console.log("El mensaje citado no corresponde a una tarea enviada o recordatorio. Se ignora.");
      return;
    }
    const idMatch = quotedMessage.body.match(/\(ID:\s*(\d+)\)|ID:\s*(\d+)/);
    if (!idMatch) {
      console.log("No se encontró el ID en el mensaje citado. No se actualizará el estado.");
      return;
    }
    const incidenciaId = idMatch[1] || idMatch[2];
    const responseText = message.body.toLowerCase();
    const responseWords = new Set(responseText.split(/\s+/));
    const confirmPhraseFound = client.keywordsData.confirmacion.frases.some(phrase =>
      responseText.includes(phrase.toLowerCase())
    );
    const confirmWordFound = client.keywordsData.confirmacion.palabras.some(word =>
      responseWords.has(word.toLowerCase())
    );
    console.log(`Confirmación detectada: confirmPhraseFound=${confirmPhraseFound}, confirmWordFound=${confirmWordFound}`);
    if (!(confirmPhraseFound || confirmWordFound)) {
      console.log("No se detectó confirmación en el mensaje. Se ignora.");
      return;
    }
    
    incidenciasDB.getIncidenciaById(incidenciaId, async (err, incidencia) => {
      if (err || !incidencia) {
        console.error("Error al obtener detalles de la incidencia para confirmación.");
        return;
      }
      
      // Determinar desde qué grupo se confirma
      let categoriaConfirmada = "";
      if (chatId === config.groupBotDestinoId) {
        categoriaConfirmada = "it";
      } else if (chatId === config.groupMantenimientoId) {
        categoriaConfirmada = "man";
      } else if (chatId === config.groupAmaId) {
        categoriaConfirmada = "ama";
      }
      
      // Si la incidencia tiene confirmaciones (más de una categoría)
      if (incidencia.confirmaciones && typeof incidencia.confirmaciones === "object") {
        // En lugar de asignar "true", asignamos la marca de tiempo de la confirmación
        incidencia.confirmaciones[categoriaConfirmada] = new Date().toISOString();
        incidenciasDB.updateConfirmaciones(incidenciaId, JSON.stringify(incidencia.confirmaciones), (err) => {
          if (err) {
            console.error("Error al actualizar confirmaciones:", err);
          } else {
            console.log(`Confirmación para categoría ${categoriaConfirmada} actualizada para incidencia ${incidenciaId}.`);
            // Calculamos cuántos equipos han confirmado
            const confirmacionesValues = Object.values(incidencia.confirmaciones);
            const fase = confirmacionesValues.filter(val => val !== false).length;
            const totalTeams = Object.keys(incidencia.confirmaciones).length;
            if (fase < totalTeams) {
              // Enviar mensaje parcial al grupo principal
              // Listar equipos que ya confirmaron y los que faltan
              const teamNames = { it: "IT", man: "MANTENIMIENTO", ama: "AMA DE LLAVES" };
              const confirmedTeams = Object.entries(incidencia.confirmaciones)
                .filter(([cat, val]) => val !== false)
                .map(([cat]) => teamNames[cat] || cat.toUpperCase());
              const missingTeams = Object.entries(incidencia.confirmaciones)
                .filter(([cat, val]) => val === false)
                .map(([cat]) => teamNames[cat] || cat.toUpperCase());
              // Calcular el tiempo de respuesta global (diferencia desde la creación hasta ahora)
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
              incidenciasDB.updateIncidenciaStatus(incidenciaId, "completada", async (err) => {
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
        // Incidencia de una sola categoría: actualizar globalmente
        incidenciasDB.updateIncidenciaStatus(incidenciaId, "completada", async (err) => {
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
    return;
  }
}

/**
 * Envía el mensaje final de confirmación al grupo principal (config.groupPruebaId)
 * con el formato solicitado y emojis.
 * @param {Client} client - El cliente de WhatsApp.
 * @param {object} incidencia - Objeto incidencia obtenido de la BD.
 * @param {string|number} incidenciaId - ID de la incidencia.
 * @param {string} categoriaConfirmada - La categoría que se confirmó.
 */
async function enviarConfirmacionGlobal(client, incidencia, incidenciaId, categoriaConfirmada) {
  // En este mensaje final se muestran todos los equipos involucrados.
  let teamNames = {};
  if (incidencia.categoria) {
    // Suponemos que incidencia.categoria es una cadena separada por comas.
    incidencia.categoria.split(',').forEach(cat => {
      const t = cat.trim().toLowerCase();
      if (t === "it") teamNames[t] = "IT";
      else if (t === "man") teamNames[t] = "MANTENIMIENTO";
      else if (t === "ama") teamNames[t] = "AMA DE LLAVES";
    });
  }
  const equiposInvolucrados = Object.values(teamNames).join(", ");
  
  // Si la incidencia tiene confirmaciones, también calculamos el cronómetro para cada equipo.
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

module.exports = { handleIncidence };

//Funcional 1
