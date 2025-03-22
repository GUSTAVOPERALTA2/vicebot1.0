const config = require('../../config/config');
const incidenciasDB = require('./incidenceDB');
const { MessageMedia } = require('whatsapp-web.js');
const moment = require('moment-timezone');
const { v4: uuidv4 } = require('uuid');

/**
 * processNewIncidence - Procesa un mensaje de incidencia proveniente del grupo principal.
 * Realiza la detección de categorías, descarga media (si existe), genera un UID único,
 * construye el objeto incidencia y lo inserta en la BD. Además, reenvía el mensaje a los grupos destino
 * incluyendo el UID en el mensaje reenviado.
 */
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

  // Inicializar objeto de confirmaciones si hay más de una categoría.
  let confirmaciones = null;
  if (foundCategories.length > 1) {
    confirmaciones = {};
    foundCategories.forEach(cat => {
      confirmaciones[cat] = false;
    });
  }
  
  // Descarga de media (si existe)
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
  
  // Generar un identificador único para esta incidencia.
  const uniqueMessageId = uuidv4();

  // Construir el objeto incidencia.
  const nuevaIncidencia = {
    uniqueMessageId,
    descripcion: message.body,
    reportadoPor: message.author ? message.author : message.from,
    fechaCreacion: new Date().toISOString(),
    estado: "pendiente",
    categoria: foundCategories.join(', '),
    confirmaciones: confirmaciones,
    grupoOrigen: chatId,
    media: mediaData ? mediaData.data : null
  };
  
  // Insertar la incidencia en la base de datos.
  incidenciasDB.insertarIncidencia(nuevaIncidencia, async (err, lastID) => {
    if (err) {
      console.error("Error al insertar incidencia en SQLite:", err);
    } else {
      console.log("Incidencia registrada con ID:", lastID);

      // Función para reenviar la incidencia a los grupos destino.
      async function forwardMessage(targetGroupId, categoryLabel) {
        try {
          const targetChat = await client.getChatById(targetGroupId);
          // Se agrega el UID al mensaje reenviado.
          const mensajeConUID = `Nueva tarea recibida (UID: ${uniqueMessageId}):\n\n*${message.body}*`;
          if (mediaData && mediaData.data && mediaData.mimetype) {
            console.log(`Enviando mensaje con media a ${categoryLabel}...`);
            const mediaMessage = new MessageMedia(mediaData.mimetype, mediaData.data);
            await targetChat.sendMessage(mediaMessage, { caption: mensajeConUID });
          } else {
            await targetChat.sendMessage(mensajeConUID);
          }
          console.log(`Mensaje reenviado a ${categoryLabel}: ${mensajeConUID}`);
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
}

module.exports = { processNewIncidence };

//nueva incidencia