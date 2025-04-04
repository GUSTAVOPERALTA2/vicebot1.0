const incidenceDB = require('./incidenceDB');
const { getUser } = require('../../config/userManager');

/**
 * processCancelationNewMethod - Procesa una solicitud de cancelación utilizando el método de citar el mensaje original.
 * 
 * Se utiliza el campo originalMsgId para rastrear la incidencia y, si el mensaje citado se acompaña de un mensaje
 * cuyo contenido EXACTO se encuentra en las palabras o frases de cancelación definidas en keywords.json, se procede a cancelar.
 * 
 * @param {Object} client - Cliente de WhatsApp.
 * @param {Object} message - Mensaje recibido con la solicitud de cancelación.
 * @returns {Promise<boolean>} - Devuelve true si se procesó la cancelación, false en caso contrario.
 */
async function processCancelationNewMethod(client, message) {
  const chat = await message.getChat();
  const text = message.body.toLowerCase().trim();

  // Obtenemos las palabras y frases de cancelación desde keywords.json
  const cancelacionData = client.keywordsData.cancelacion;
  if (!cancelacionData) {
    return false;
  }
  
  // Se activa este método solo si se cita un mensaje y el texto coincide EXACTAMENTE con alguna palabra o frase definida
  const validCancel =
    cancelacionData.palabras.includes(text) ||
    cancelacionData.frases.includes(text);
  
  if (message.hasQuotedMsg && validCancel) {
    const quotedMessage = await message.getQuotedMessage();
    // Usamos el id del mensaje citado para rastrear la incidencia mediante el campo originalMsgId
    const originalMsgId = quotedMessage.id._serialized;
    
    try {
      const incidence = await incidenceDB.buscarIncidenciaPorOriginalMsgIdAsync(originalMsgId);
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
