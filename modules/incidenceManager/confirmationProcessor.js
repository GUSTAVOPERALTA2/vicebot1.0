const config = require('../../config/config');
const incidenceDB = require('./incidenceDB');
const moment = require('moment-timezone');
// Importamos las funciones de stringUtils para normalizar y hacer fuzzy matching adaptativo
const { normalizeText, adaptiveSimilarityCheck } = require('../../config/stringUtils');

/**
 * processConfirmation - Procesa un mensaje de confirmación recibido en los grupos destino.
 * Se realiza:
 *  - Validación del mensaje citado y extracción del ID de la incidencia.
 *  - Detección de palabras y frases de confirmación utilizando comparación adaptativa.
 *  - Actualización del objeto incidencia en la BD (confirmaciones y feedbackHistory).
 *  - Envío de mensajes parciales o definitivos al grupo principal.
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

  // Limpiar el texto citado quitando asteriscos y espacios
  const cleanedQuotedText = quotedMessage.body.trim().replace(/^\*+/, "");
  console.log("Texto citado completo:", cleanedQuotedText);

  // Extraer la primera línea para obtener el encabezado
  const firstLine = cleanedQuotedText.split('\n')[0].trim();
  console.log("Primera línea del mensaje citado:", firstLine);

  // Definir expresiones regulares para los patrones permitidos de confirmación
  const allowedRegexes = [
    /^recordatorio:\s*tarea\s+incompleta/i,
    /^nueva\s+tarea\s+recibida/i,
    /^recordatorio:\s*incidencia/i,
    /^solicitud\s+de\s+retroalimentacion\s+para\s+la\s+tarea/i
  ];

  // Verificar que la primera línea cumpla al menos uno de los patrones
  const isValid = allowedRegexes.some(regex => regex.test(firstLine));
  if (!isValid) {
    console.log("El mensaje citado no corresponde a una solicitud válida de confirmación.");
    return;
  }
  
  // Extraer el ID de la incidencia utilizando un regex que cubra varios formatos
  let idMatch = quotedMessage.body.match(/(?:\(ID:\s*(\d+)\)|ID:\s*(\d+)|solicitud\s+de\s+retroalimentacion\s+para\s+la\s+tarea\s*(\d+):)/i);
  if (!idMatch) {
    console.log("No se pudo extraer el ID de la incidencia del mensaje citado.");
    return;
  }
  const incidenciaId = idMatch[1] || idMatch[2] || idMatch[3];
  console.log("ID extraído del mensaje citado:", incidenciaId);

  // Detección de confirmación
  // Se utiliza la normalización para eliminar diacríticos y pasar a minúsculas
  const normalizedResponseText = normalizeText(message.body);
  // Se tokeniza el mensaje
  const tokens = normalizedResponseText.split(/\s+/);
  
  // Verificación de frases: se comprueba si alguna de las frases de confirmación está incluida en el mensaje
  const confirmPhraseFound = client.keywordsData.respuestas.confirmacion.frases.some(phrase =>
    normalizedResponseText.includes(normalizeText(phrase))
  );
  
  // Verificación adaptativa de palabras: se comparan cada token con las palabras de confirmación definidas
  const confirmWordFound = client.keywordsData.respuestas.confirmacion.palabras.some(word => {
    const normalizedWord = normalizeText(word);
    return tokens.some(token => adaptiveSimilarityCheck(token, normalizedWord));
  });
  
  console.log(`Confirmación detectada: confirmPhraseFound=${confirmPhraseFound}, confirmWordFound=${confirmWordFound}`);
  if (!(confirmPhraseFound || confirmWordFound)) {
    console.log("No se detectó confirmación en el mensaje. Se ignora.");
    return;
  }
  
  // Procede a obtener la incidencia de la base de datos
  incidenceDB.getIncidenciaById(incidenciaId, async (err, incidencia) => {
    if (err || !incidencia) {
      console.error("Error al obtener detalles de la incidencia para confirmación.");
      return;
    }
    
    // Determinar el equipo que confirma según el ID del chat destino
    let categoriaConfirmada = "";
    if (chatId === config.groupBotDestinoId) {
      categoriaConfirmada = "it";
    } else if (chatId === config.groupMantenimientoId) {
      categoriaConfirmada = "man";
    } else if (chatId === config.groupAmaId) {
      categoriaConfirmada = "ama";
    }
    
    // Actualizar el objeto incidencia con la confirmación de este equipo
    if (incidencia.confirmaciones && typeof incidencia.confirmaciones === "object") {
      incidencia.confirmaciones[categoriaConfirmada] = new Date().toISOString();
    } else {
      incidencia.confirmaciones = { [categoriaConfirmada]: new Date().toISOString() };
    }
    
    // Actualizar el historial de feedback con esta confirmación
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
        console.log(`Confirmación para la categoría ${categoriaConfirmada} actualizada para la incidencia ${incidenciaId}.`);
        // Continuar con el proceso final, envío de mensajes, etc.
      }
    });
  });
}

module.exports = { processConfirmation };

