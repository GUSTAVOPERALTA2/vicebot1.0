// modules/messageManager/editHandler.js

const incidenceDB = require('../../modules/incidenceManager/incidenceDB');
const config      = require('../../config/config');

/**
 * Registra el listener para ediciones de mensaje.
 * - Vuelve a detectar categorías.
 * - Actualiza descripción y categoría en la BD.
 * - (Opcional) Notifica al grupo principal si cambia de categoría.
 */
function setupEditHandler(client) {
  client.on('message_edit', async (msg, newBody) => {
    try {
      const msgId = msg.id._serialized;
      console.log(`Mensaje editado ${msgId}: "${newBody}"`);

      // 1) Buscar la incidencia por originalMsgId
      const inc = await incidenceDB.buscarIncidenciaPorOriginalMsgIdAsync(msgId);
      if (!inc) return;

      // 2) Re-detectar categorías sobre newBody
      const text = newBody.toLowerCase();
      const cats = [];
      for (const cat of ['it','man','ama']) {
        const data = client.keywordsData.identificadores[cat] || { palabras:[], frases:[] };
        const hasWord   = data.palabras.some(w => text.includes(w));
        const hasPhrase = data.frases .some(f => text.includes(f));
        if (hasWord || hasPhrase) cats.push(cat);
      }
      const newCategoria = cats.join(',');

      // 3) Si la categoría cambió, actualizarla
      if (newCategoria && newCategoria !== inc.categoria) {
        incidenceDB.updateCategoria(inc.id, newCategoria, err => {
          if (err) console.error('Error al actualizar categoría:', err);
          else console.log(`Incidencia ${inc.id} recategorizada: ${inc.categoria} → ${newCategoria}`);
        });
        // Opcional: notificar al grupo principal
        client.getChatById(config.groupPruebaId)
          .then(c => c.sendMessage(
            `Incidencia *${inc.id}* recategorizada:\n${inc.categoria} → ${newCategoria}`
          ))
          .catch(() => {});
      }

      // 4) Actualizar la descripción
      incidenceDB.updateDescripcion(inc.id, newBody, err => {
        if (err) console.error('Error al actualizar descripción:', err);
        else console.log(`Descripción de incidencia ${inc.id} actualizada.`);
      });

    } catch (e) {
      console.error('Error en editHandler:', e);
    }
  });
}

module.exports = { setupEditHandler };
