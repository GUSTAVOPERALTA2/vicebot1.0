const incidenceDB = require('./incidenceDB');
const { getUser } = require('../../config/userManager');

/**
 * processCancelation - Detecta si un mensaje solicita cancelar una incidencia mediante palabras clave.
 * 
 * Se verifica que el mensaje contenga la palabra "incidencia" junto con alguna palabra o frase de cancelación.
 * Si se cumple, se extrae el ID numérico, se valida que el usuario sea el reportante o admin y se procede a cancelar.
 * 
 * @param {Object} client - El cliente de WhatsApp.
 * @param {Object} message - El mensaje recibido.
 * @returns {Promise<boolean>} - Devuelve true si el mensaje fue manejado como cancelación, false en caso contrario.
 */
async function processCancelation(client, message) {
  const chat = await message.getChat();
  const mensajeTexto = message.body.toLowerCase();

  // Verificamos que exista la sección "cancelacion" en las keywords
  const cancelacionData = client.keywordsData.cancelacion;
  if (!cancelacionData) {
    return false;
  }

  // Comprobar si el mensaje menciona "incidencia" y alguna palabra o frase de cancelación
  if (
    mensajeTexto.includes("incidencia") &&
    (
      cancelacionData.palabras.some(p => mensajeTexto.includes(p)) ||
      cancelacionData.frases.some(f => mensajeTexto.includes(f))
    )
  ) {
    // Intentar extraer un número (ID) del mensaje
    const match = mensajeTexto.match(/(\d+)/);
    if (match) {
      const idExtraido = match[1];
      const senderId = message.author ? message.author : message.from;
      const currentUser = getUser(senderId);

      return new Promise((resolve) => {
        incidenceDB.getIncidenciaById(idExtraido, (err, incidencia) => {
          if (err || !incidencia) {
            chat.sendMessage("No se encontró la incidencia con ese ID.");
            return resolve(true);
          }
          if (
            incidencia.reportadoPor !== senderId &&
            (!currentUser || currentUser.rol !== 'admin')
          ) {
            chat.sendMessage("No tienes permisos para cancelar esta incidencia.");
            return resolve(true);
          }
          if (incidencia.estado !== "pendiente") {
            chat.sendMessage("La incidencia no se puede cancelar porque no está en estado pendiente.");
            return resolve(true);
          }
          // Proceder a cancelar la incidencia
          incidenceDB.cancelarIncidencia(idExtraido, (err) => {
            if (err) {
              chat.sendMessage("Error al cancelar la incidencia.");
            } else {
              chat.sendMessage(`La incidencia con ID ${idExtraido} ha sido cancelada.`);
            }
            return resolve(true);
          });
        });
      });
    } else {
      chat.sendMessage("No se pudo extraer el ID de la incidencia.");
      return true;
    }
  }
  return false;
}

module.exports = { processCancelation };
