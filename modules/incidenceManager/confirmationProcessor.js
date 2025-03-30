const config = require('../../config/config');
const incidenceDB = require('./incidenceDB');
const moment = require('moment-timezone');

/**
 * Procesa un mensaje de confirmación recibido en los grupos destino.
 * Realiza:
 *  - Validación del mensaje citado y extracción del ID de la incidencia.
 *  - Detección de palabras o frases de confirmación usando client.keywordsData.
 *  - Actualización del objeto incidencia en la base de datos, de forma parcial (por fases) o final.
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
  const quotedBodyLower = quotedMessage.body.toLowerCase();

  // Aceptar mensajes que inicien con cualquiera de estos patrones:
  if (!(quotedBodyLower.startsWith("*recordatorio: tarea incompleta*") ||
        quotedBodyLower.startsWith("nueva tarea recibida") ||
        quotedBodyLower.startsWith("recordatorio: incidencia") ||
        quotedBodyLower.startsWith("solicitud de retroalimentacion para la tarea"))) {
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
    
    // Determinar el equipo que responde, según el id del chat
    let categoriaConfirmada = "";
    if (chatId === config.groupBotDestinoId) {
      categoriaConfirmada = "it";
    } else if (chatId === config.groupMantenimientoId) {
      categoriaConfirmada = "man";
    } else if (chatId === config.groupAmaId) {
      categoriaConfirmada = "ama";
    }
    
    // Actualizar el objeto de confirmaciones para ese equipo
    if (incidencia.confirmaciones && typeof incidencia.confirmaciones === "object") {
      incidencia.confirmaciones[categoriaConfirmada] = new Date().toISOString();
    } else {
      incidencia.confirmaciones = { [categoriaConfirmada]: new Date().toISOString() };
    }
    
    incidenceDB.updateConfirmaciones(incidenciaId, JSON.stringify(incidencia.confirmaciones), (err) => {
      if (err) {
        console.error("Error al actualizar confirmaciones:", err);
      } else {
        console.log(`Confirmación para categoría ${categoriaConfirmada} actualizada para incidencia ${incidenciaId}.`);
        
        // Calcular la fase y obtener los equipos requeridos a partir de la incidencia.
        // Suponemos que incidencia.categoria tiene las categorías separadas por coma.
        const teamNames = { it: "IT", man: "MANTENIMIENTO", ama: "AMA" };
        const requiredTeams = incidencia.categoria.split(',').map(c => c.trim().toLowerCase());
        // Si la propiedad confirmaciones ya existe, usamos sus claves; de lo contrario, usamos requiredTeams
        const confirmedTeams = incidencia.confirmaciones ? 
          Object.keys(incidencia.confirmaciones).filter(k => incidencia.confirmaciones[k] !== false) : [];
        const totalTeams = requiredTeams.length;
        
        // Calcular los equipos pendientes: usar nombres mapeados
        const missingTeams = requiredTeams
          .filter(team => !confirmedTeams.includes(team))
          .map(team => teamNames[team] || team.toUpperCase());
        
        // Calcular el tiempo de respuesta
        const responseTime = moment().diff(moment(incidencia.fechaCreacion));
        const diffDuration = moment.duration(responseTime);
        const diffResponseStr = `${Math.floor(diffDuration.asDays())} día(s), ${diffDuration.hours()} hora(s), ${diffDuration.minutes()} minuto(s)`;
        
        // Construir el bloque de comentarios para cada equipo
        // Buscamos en feedbackHistory el último feedback de cada equipo
        let comentarios = "";
        let feedbackHistory = [];
        try {
          feedbackHistory = incidencia.feedbackHistory ? JSON.parse(incidencia.feedbackHistory) : [];
        } catch (e) {
          feedbackHistory = [];
        }
        for (let team of requiredTeams) {
          const displayName = teamNames[team] || team.toUpperCase();
          // Buscar feedback para este equipo
          const record = feedbackHistory.find(r => r.equipo.toLowerCase() === team && r.tipo === "feedback");
          const comentario = record && record.comentario ? record.comentario : "Sin comentarios";
          comentarios += `${displayName}: ${comentario}\n`;
        }
        
        // Construir el mensaje parcial con el nuevo formato
        const partialMessage = `*ATENCIÓN TAREA EN FASE ${confirmedTeams.length} de ${totalTeams}*\n` +
          `${incidencia.descripcion}\n\n` +
          `Tarea terminada por:\n${confirmedTeams.length > 0 ? confirmedTeams.map(t => teamNames[t] || t.toUpperCase()).join(", ") : "Ninguno"}\n\n` +
          `Equipo(s) que faltan:\n${missingTeams.length > 0 ? missingTeams.join(", ") : "Ninguno"}\n\n` +
          `Comentarios:\n${comentarios}\n` +
          `⏱️Tiempo de respuesta: ${diffResponseStr}`;
        
        client.getChatById(config.groupPruebaId)
          .then(chat => {
            chat.sendMessage(partialMessage);
            console.log("Mensaje de confirmación parcial enviado al grupo principal:", partialMessage);
          })
          .catch(e => console.error("Error al enviar confirmación parcial al grupo principal:", e));
      }
    });
  });
}

module.exports = { processConfirmation };

//nueva tarea