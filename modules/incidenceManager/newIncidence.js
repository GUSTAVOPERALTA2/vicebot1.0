const config = require('../../config/config');
const incidenceDB = require('./incidenceDB');
const { MessageMedia } = require('whatsapp-web.js');
const moment = require('moment-timezone');
const { v4: uuidv4 } = require('uuid');
// Importamos las funciones para normalizar y comparar cadenas
const { normalizeText, similarity } = require('../../config/stringUtils');

async function processNewIncidence(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;
  console.log("Procesando mensaje de Grupo de Incidencias.");

  // Normaliza el cuerpo del mensaje eliminando diacríticos y convirtiendo a minúsculas
  const normalizedMessage = normalizeText(message.body);
  // Eliminar signos de puntuación para obtener un conjunto limpio de palabras
  const cleanedMessage = normalizedMessage.replace(/[.,!?()]/g, '');
  console.log(`Mensaje original: "${message.body}"`);
  console.log(`Mensaje normalizado y limpio: "${cleanedMessage}"`);

  if (!cleanedMessage.trim()) {
    console.log("El mensaje está vacío tras la limpieza. Se omite.");
    return;
  }
  // Convertir el mensaje en un conjunto de palabras
  const wordsSet = new Set(cleanedMessage.split(/\s+/));
  console.log("Conjunto de palabras del mensaje:", wordsSet);

  // Se evaluarán las categorías válidas para incidencias
  const categories = ['it', 'ama', 'man'];
  let foundCategories = [];
  const keywordsData = client.keywordsData;
  for (let category of categories) {
    const data = keywordsData.identificadores[category];
    if (!data) continue;
    
    // Comparación de palabras clave: se recorre cada palabra clave definida
    const foundKeyword = data.palabras.some(keyword => {
      const normalizedKeyword = normalizeText(keyword);
      let keywordFound = false;
      // Iteramos sobre cada palabra del mensaje y calculamos la similitud
      Array.from(wordsSet).forEach(word => {
        const sim = similarity(word, normalizedKeyword);
        console.log(`Comparando palabra del mensaje: "${word}" vs keyword: "${normalizedKeyword}" → Similitud: ${sim}`);
        if (sim >= 0.8) {
          keywordFound = true;
        }
      });
      if (keywordFound) {
        console.log(`Coincidencia detectada en categoría "${category}" para la palabra clave: "${keyword}"`);
      }
      return keywordFound;
    });

    // Comparación de frases: se normaliza la frase y se verifica si está contenida en el mensaje normalizado
    const foundPhrase = data.frases.some(phrase => {
      const normalizedPhrase = normalizeText(phrase);
      const included = normalizedMessage.includes(normalizedPhrase);
      console.log(`Verificando frase clave: "${phrase}" (normalizada: "${normalizedPhrase}") → Incluida en mensaje: ${included}`);
      return included;
    });
    
    console.log(`Evaluando categoría "${category}": foundKeyword=${foundKeyword}, foundPhrase=${foundPhrase}`);
    if (foundKeyword || foundPhrase) {
      foundCategories.push(category);
    }
  }
  console.log("Categorías detectadas:", foundCategories);

  if (!foundCategories.length) {
    console.log("No se encontró ninguna categoría en el mensaje.");
    return;
  }
  console.log(`Registrando incidencia para las categorías ${foundCategories.join(', ')}: "${message.body}"`);

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
  
  // Generamos un identificador único y obtenemos el id original del mensaje
  const uniqueMessageId = uuidv4();
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

      // Función para reenviar la incidencia a los grupos destino según la categoría
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
      // Se envía mensaje de confirmación al usuario con el ID de la incidencia
      await chat.sendMessage(`El mensaje se ha enviado al equipo de ${teamList}.\nID: ${lastID}`);
    }
  });
}

module.exports = { processNewIncidence };
