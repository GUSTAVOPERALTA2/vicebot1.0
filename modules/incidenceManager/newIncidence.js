const config = require('../../config/config');
const incidenceDB = require('./incidenceDB');
const { MessageMedia } = require('whatsapp-web.js');
const moment = require('moment-timezone');
const { v4: uuidv4 } = require('uuid');
// Importamos funciones de stringUtils (incluyendo la adaptativa)
const { normalizeText, similarity, adaptiveSimilarityCheck } = require('../../config/stringUtils');

async function processNewIncidence(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;
  console.log("Procesando mensaje de Grupo de Incidencias.");

  // Normalizamos y limpiamos el mensaje
  const normalizedMessage = normalizeText(message.body);
  const cleanedMessage = normalizedMessage.replace(/[.,!?()]/g, '');
  console.log(`Mensaje: "${message.body}"`);
  console.log(`Normalizado y limpio: "${cleanedMessage}"`);

  if (!cleanedMessage.trim()) {
    console.log("El mensaje está vacío tras la limpieza.");
    return;
  }
  
  const wordsSet = new Set(cleanedMessage.split(/\s+/));
  console.log("Conjunto de palabras:", wordsSet);

  const categories = ['it', 'ama', 'man'];
  let foundCategories = [];
  const keywordsData = client.keywordsData;
  
  for (let category of categories) {
    const data = keywordsData.identificadores[category];
    if (!data) continue;
    
    // Comparación de palabras clave con adaptive similarity
    const foundKeyword = data.palabras.some(keyword => {
      const normalizedKeyword = normalizeText(keyword);
      let keywordFound = false;
      Array.from(wordsSet).forEach(word => {
        const sim = similarity(word, normalizedKeyword);
        if (adaptiveSimilarityCheck(word, normalizedKeyword)) {
          console.log(`Coincidencia: "${word}" vs "${normalizedKeyword}" -> ${(sim * 100).toFixed(2)}%`);
          keywordFound = true;
        }
      });
      return keywordFound;
    });

    // Comparación de frases clave
    const foundPhrase = data.frases.some(phrase => {
      const normalizedPhrase = normalizeText(phrase);
      return normalizedMessage.includes(normalizedPhrase);
    });
    
    if (foundKeyword || foundPhrase) {
      foundCategories.push(category);
    }
  }
  console.log("Categorías detectadas:", foundCategories);

  if (!foundCategories.length) {
    console.log("No se encontró ninguna categoría en el mensaje.");
    return;
  }
  console.log(`Registrando incidencia para: "${message.body}"`);

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
        console.log("Media descargada:", mediaData.mimetype);
      }
    } catch (err) {
      console.error("Error al descargar media:", err);
    }
  }
  
  const uniqueMessageId = uuidv4();
  const originalMsgId = message.id._serialized;

  const nuevaIncidencia = {
    uniqueMessageId,
    originalMsgId,
    descripcion: message.body,
    reportadoPor: message.author || message.from,
    fechaCreacion: new Date().toISOString(),
    estado: "pendiente",
    categoria: foundCategories.join(', '),
    confirmaciones,
    grupoOrigen: chatId,
    media: mediaData ? mediaData.data : null
  };
  
  incidenceDB.insertarIncidencia(nuevaIncidencia, async (err, lastID) => {
    if (err) {
      console.error("Error al insertar incidencia:", err);
    } else {
      console.log("Incidencia registrada con ID:", lastID);

      async function forwardMessage(targetGroupId, categoryLabel) {
        try {
          const targetChat = await client.getChatById(targetGroupId);
          const mensajeConID = `Nueva tarea recibida (ID: ${lastID}):\n\n*${message.body}*`;
          if (mediaData && mediaData.data && mediaData.mimetype) {
            const mediaMessage = new MessageMedia(mediaData.mimetype, mediaData.data);
            await targetChat.sendMessage(mediaMessage, { caption: mensajeConID });
          } else {
            await targetChat.sendMessage(mensajeConID);
          }
          console.log(`Enviado a ${categoryLabel}: ${mensajeConID}`);
        } catch (error) {
          console.error(`Error enviando a ${categoryLabel}:`, error);
        }
      }
      if (foundCategories.includes('it')) await forwardMessage(config.groupBotDestinoId, 'IT');
      if (foundCategories.includes('man')) await forwardMessage(config.groupMantenimientoId, 'Mantenimiento');
      if (foundCategories.includes('ama')) await forwardMessage(config.groupAmaId, 'Ama de Llaves');

      const teamNames = { it: "IT", ama: "Ama de Llaves", man: "Mantenimiento" };
      const teams = foundCategories.map(cat => teamNames[cat]);
      let teamList = teams.length === 1 ? teams[0] : teams.join(" y ");
      await chat.sendMessage(`Mensaje enviado al equipo de ${teamList}.\nID: ${lastID}`);
    }
  });
}

module.exports = { processNewIncidence };

//sin logs