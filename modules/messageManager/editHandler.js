// modules/messageManager/editHandler.js
const incidenceDB = require('../../modules/incidenceManager/incidenceDB');
const config      = require('../../config/config');

function setupEditHandler(client) {
  client.on('message', async message => {
    try {
      // 1) ¿Existe ya una incidencia con este originalMsgId?
      const inc = await incidenceDB.buscarIncidenciaPorOriginalMsgIdAsync(
        message.id._serialized
      );
      if (!inc) return;  // no es edición, es mensaje nuevo

      console.log(
        `Mensaje editado detectado (incidencia ${inc.id}): "${message.body}"`
      );

      // 2) Recalcular categorías según el texto nuevo
      const text = message.body.toLowerCase();
      const cats = [];
      for (const cat of ['it', 'man', 'ama']) {
        const data = client.keywordsData.identificadores[cat];
        if (!data) continue;
        const hasWord   = data.palabras.some(w => text.includes(w));
        const hasPhrase = data.frases .some(f => text.includes(f));
        if (hasWord || hasPhrase) cats.push(cat);
      }
      const newCategoria = cats.join(',');

      // 3) Si cambió la categoría, actualízala en BD
      if (newCategoria && newCategoria !== inc.categoria) {
        incidenceDB.updateCategoria(inc.id, newCategoria, err => {
          if (err) console.error(err);
          else {
            console.log(
              `Categoria de incidencia ${inc.id}: ${inc.categoria} → ${newCategoria}`
            );
            client
              .getChatById(config.groupPruebaId)
              .then(main => main.sendMessage(
                `*Incidencia ${inc.id} recategorizada:* ${inc.categoria} → ${newCategoria}`
              ));
          }
        });
      }

      // 4) Actualizar descripción siempre
      incidenceDB.updateDescripcion(inc.id, message.body, err => {
        if (err) console.error(err);
        else console.log(`Descripción de incidencia ${inc.id} actualizada.`);
      });

    } catch (e) {
      console.error("Error en editHandler:", e);
    }
  });
}

module.exports = { setupEditHandler };
