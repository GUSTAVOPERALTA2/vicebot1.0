const incidenceDB = require('./incidenceDB');
const { getUser } = require('../../config/userManager');

/**
 * processCancelationNewMethod - Procesa una solicitud de cancelación mediante la cita de un mensaje.
 *
 * Si se cita un mensaje y el texto del mensaje de respuesta (exacto) coincide con alguna palabra o frase
 * de cancelación definidas en keywords.json, se busca la incidencia asociada:
 *
 * - Si el mensaje citado es el generado por /tareaDetalles (empieza con "*Detalles de la incidencia"),
 *   se extrae el ID de la incidencia del mensaje.
 * - De lo contrario, se utiliza el id del mensaje citado para buscar la incidencia mediante el campo originalMsgId.
 *
 * Se valida que el usuario tenga permiso (reportante o admin) y que la incidencia esté en estado "pendiente".
 * Luego se cancela la incidencia.
 *
 * @param {Object} client - Cliente de WhatsApp.
 * @param {Object} message - Mensaje recibido con la solicitud de cancelación.
 * @returns {Promise<boolean>} - Devuelve true si se procesó la cancelación, false en caso contrario.
 */
async function processCancelationNewMethod(client, message) {
  const chat = await message.getChat();
  const text = message.body.toLowerCase().trim();

  // Obtenemos las palabras y frases de cancelación definidas en keywords.json
  const cancelacionData = client.keywordsData.cancelacion;
  if (!cancelacionData) {
    return false;
  }
  
  // Se activa este método si se cita un mensaje y el contenido EXACTO del mensaje es una de las palabras/frases definidas.
  const validCancel = cancelacionData.palabras.includes(text) || cancelacionData.frases.includes(text);
  
  if (message.hasQuotedMsg && validCancel) {
    const quotedMessage = await message.getQuotedMessage();
    const quotedText = quotedMessage.body.toLowerCase();
    let incidenceLookupMethod = null;
    let incidenceLookupId = null;
    
    // Si el mensaje citado es el generado por /tareaDetalles, se espera que comience con "*Detalles de la incidencia"
    if (quotedText.startsWith("*detalles de la incidencia")) {
      // Se extrae el ID usando una expresión regular. Se asume que el mensaje contiene "ID: <número>"
      const match = quotedMessage.body.match(/ID:\s*(\d+)/i);
      if (match) {
        incidenceLookupMethod = 'byId';
        incidenceLookupId = match[1];
      } else {
        chat.sendMessage("No se pudo extraer el ID de la incidencia del mensaje de detalles.");
        return true;
      }
    } else {
      // Si no es mensaje de detalles, se utiliza el id del mensaje citado para buscar la incidencia mediante originalMsgId
      incidenceLookupMethod = 'byOriginalMsgId';
      incidenceLookupId = quotedMessage.id._serialized;
    }
    
    try {
      let incidence;
      if (incidenceLookupMethod === 'byId') {
        incidence = await new Promise((resolve, reject) => {
          incidenceDB.getIncidenciaById(incidenceLookupId, (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
      } else if (incidenceLookupMethod === 'byOriginalMsgId') {
        incidence = await incidenceDB.buscarIncidenciaPorOriginalMsgIdAsync(incidenceLookupId);
      }
      
      if (!incidence) {
        chat.sendMessage("No se encontró la incidencia asociada a ese mensaje.");
        return true;
      }
      
      const senderId = message.author ? message.author : message.from;
      const currentUser = getUser(senderId);
      if (incidence.reportadoPor !== senderId && (!currentUser || currentUser.rol !== 'admin')) {
        chat.sendMessage("No tienes permisos para cancelar esta incidencia.");
        return true;
      }
      
      if (incidence.estado !== "pendiente") {
        chat.sendMessage("La incidencia no se puede cancelar porque no está en estado pendiente.");
        return true;
      }
      
      return new Promise((resolve) => {
        incidenceDB.cancelarIncidencia(incidence.id, (err) => {
          if (err) {
            chat.sendMessage("Error al cancelar la incidencia.");
          } else {
            chat.sendMessage(`La incidencia con ID ${incidence.id} ha sido cancelada.`);
          }
          resolve(true);
        });
      });
    } catch (error) {
      chat.sendMessage("Error al buscar la incidencia.");
      return true;
    }
  }
  
  return false;
}

module.exports = { processCancelationNewMethod };

//tareaDetalles