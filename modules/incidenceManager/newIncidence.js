// vicebot/modules/incidenceManager/newIncidence.js
const config = require('../../config/config');
const incidenceDB = require('./incidenceDB');
const { MessageMedia } = require('whatsapp-web.js');
const moment = require('moment-timezone');
const { v4: uuidv4 } = require('uuid');

async function processNewIncidence(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;
  console.log("Procesando mensaje de Grupo de Incidencias.");

  const messageText = message.body.toLowerCase();
  const cleanedMessage = messageText.replace(/[.,!?()]/g, '');
  if (!cleanedMessage.trim()) {
    console.log("El mensaje está vacío tras la limpieza. Se omite.");
    return;
  }
  const wordsSet = new Set(cleanedMessage.split(/\s+/));
  console.log("Conjunto de palabras:", wordsSet);

  // Se evalúan solo las categorías válidas para incidencias nuevas
  const categories = ['it', 'ama', 'man'];
  let foundCategories = [];
  const keywordsData = client.keywordsData;
  for (let category of categories) {
    const data = keywordsData.identificadores[category];
    if (!data) continue;
    const foundKeyword = data.palabras.some(word => wordsSet.has(word.toLowerCase()));
    const foundPhrase = data.frases.some(phrase => messageText.includes(phrase.toLowerCase()));
    console.log(`Evaluando categoría ${category}: foundKeyword=${foundKeyword}, foundPhrase=${foundPhrase}`);
    if (foundKeyword || foundPhrase) {
      foundCategories.push(category);
    }
  }
  console.log("Categorías detectadas:", foundCategories);

  // Si no se encontró ninguna categoría válida, se omite el mensaje
  if (!foundCategories.length) {
    console.log("No se encontró ninguna categoría en el mensaje.");
    return;
  }
  console.log(`Registrando incidencia para categorías ${foundCategories.join(', ')}: ${message.body}`);

  let confirmaciones = null;
  if (foundCategories.length > 1) {
    confirmaciones = {};
    foundCategories.forEach(cat => {
      confirmaciones[cat] = false;
    });
  }
  
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
  
  // Generar un identificador único
  const uniqueMessageId = uuidv4();
  // Obtener el id original del mensaje (metadata)
  const originalMsgId = message.id._serialized;

  const nuevaIncidencia = {
    uniqueMessageId,
    originalMsgId,
    descripcion: message.body,
    reportadoPor: message.author ? message.author : message.from,
    fechaCreacion: new Date().toISOString(),
    estado: "pendiente",
    categoria: foundCategories.join(', '),
    confirmaciones: confirmaciones,
    grupoOrigen: chatId,
    media: mediaData ? mediaData.data : null
  };
  
  incidenceDB.insertarIncidencia(nuevaIncidencia, async (err, lastID) => {
    if (err) {
      console.error("Error al insertar incidencia en SQLite:", err);
    } else {
      console.log("Incidencia registrada con ID:", lastID);

      // Función para reenviar la incidencia a los grupos destino.
      async function forwardMessage(targetGroupId, categoryLabel) {
        try {
          const targetChat = await client.getChatById(targetGroupId);
          const mensajeConID = `Nueva tarea recibida (ID: ${lastID}):\n\n*${message.body}*`;
          if (mediaData && mediaData.data && mediaData.mimetype) {
            console.log(`Enviando mensaje con media a ${categoryLabel}...`);
            const mediaMessage = new MessageMedia(mediaData.mimetype, mediaData.data);
            await targetChat.sendMessage(mediaMessage, { caption: mensajeConID });
          } else {
            await targetChat.sendMessage(mensajeConID);
          }
          console.log(`Mensaje reenviado a ${categoryLabel}: ${mensajeConID}`);
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
      // Se envía el mensaje al usuario incluyendo el ID de la incidencia.
      await chat.sendMessage(`El mensaje se ha enviado al equipo de ${teamList}.\nID: ${lastID}`);
    }
  });
}

module.exports = { processNewIncidence };
