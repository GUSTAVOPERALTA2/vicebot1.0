const config = require('../../config/config');
const incidenceDB = require('./incidenceDB');
const moment = require('moment-timezone');
const { normalizeText, adaptiveSimilarityCheck } = require('../../config/stringUtils');
// Importamos el módulo de feedback para manejar el caso en que no se detecte confirmación
const feedbackProcessor = require('./feedbackProcessor');

async function processConfirmation(client, message) {
  const chat = await message.getChat();
  const chatId = chat.id._serialized;
  console.log("Procesando mensaje de confirmación en grupo destino.");

  if (!message.hasQuotedMsg) {
    console.log("El mensaje no cita ningún mensaje. Se ignora.");
    return;
  }

  const quotedMessage = await message.getQuotedMessage();
  const cleanedQuotedText = quotedMessage.body.trim().replace(/^\*+/, "");
  console.log("Texto citado completo:", cleanedQuotedText);
  
  const firstLine = cleanedQuotedText.split('\n')[0].trim();
  console.log("Primera línea del mensaje citado:", firstLine);
  
  const allowedRegexes = [
    /^recordatorio:\s*tarea\s+incompleta/i,
    /^nueva\s+tarea\s+recibida/i,
    /^recordatorio:\s*incidencia/i,
    /^solicitud\s+de\s+retroalimentacion\s+para\s+la\s+tarea/i
  ];
  
  const isValid = allowedRegexes.some(regex => regex.test(firstLine));
  if (!isValid) {
    console.log("El mensaje citado no corresponde a una solicitud válida de confirmación.");
    return;
  }
  
  let idMatch = quotedMessage.body.match(/(?:\(ID:\s*(\d+)\)|ID:\s*(\d+)|solicitud\s+de\s+retroalimentacion\s+para\s+la\s+tarea\s*(\d+):)/i);
  if (!idMatch) {
    console.log("No se pudo extraer el ID de la incidencia del mensaje citado.");
    return;
  }
  const incidenciaId = idMatch[1] || idMatch[2] || idMatch[3];
  console.log("ID extraído del mensaje citado:", incidenciaId);
  
  // Normalizamos el texto de respuesta y lo tokenizamos para comparación fuzzy
  const normalizedResponseText = normalizeText(message.body);
  const tokens = normalizedResponseText.split(/\s+/);
  
  // Verificamos las frases de confirmación (comparación exacta sobre el texto normalizado)
  const confirmPhraseFound = client.keywordsData.respuestas.confirmacion.frases.some(phrase =>
    normalizedResponseText.includes(normalizeText(phrase))
  );
  
  // Verificamos las palabras de confirmación usando la comparación adaptativa
  const confirmWordFound = client.keywordsData.respuestas.confirmacion.palabras.some(word => {
    const normalizedWord = normalizeText(word);
    return tokens.some(token => adaptiveSimilarityCheck(token, normalizedWord));
  });
  
  console.log(`Confirmación detectada: confirmPhraseFound=${confirmPhraseFound}, confirmWordFound=${confirmWordFound}`);
  
  // Buscar la incidencia desde la base de datos
  incidenceDB.getIncidenciaById(incidenciaId, async (err, incidencia) => {
    if (err || !incidencia) {
      console.error("Error al obtener detalles de la incidencia para confirmación.");
      return;
    }
    
    if (confirmPhraseFound || confirmWordFound) {
      // Flujo de confirmación
      let categoriaConfirmada = "";
      if (chatId === config.groupBotDestinoId) {
        categoriaConfirmada = "it";
      } else if (chatId === config.groupMantenimientoId) {
        categoriaConfirmada = "man";
      } else if (chatId === config.groupAmaId) {
        categoriaConfirmada = "ama";
      }
      
      // Actualizar confirmaciones en la incidencia
      if (incidencia.confirmaciones && typeof incidencia.confirmaciones === "object") {
        incidencia.confirmaciones[categoriaConfirmada] = new Date().toISOString();
      } else {
        incidencia.confirmaciones = { [categoriaConfirmada]: new Date().toISOString() };
      }
      
      // Registrar el feedback en el historial (como confirmación)
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
          // Aquí se puede notificar al grupo principal si es necesario.
        }
      });
      
    } else {
      // Si no se detecta confirmación, el mensaje se tratará como retroalimentación
      console.log("No se detectó confirmación; se procesará como retroalimentación.");
      await feedbackProcessor.processFeedbackResponse(client, message, incidencia);
    }
  });
}

module.exports = { processConfirmation };

//listo