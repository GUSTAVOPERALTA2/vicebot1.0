// modules/messageHandler.js
const config = require('./config');
const { addEntry, removeEntry, editEntry, loadKeywords } = require('./keywordsManager');
const { getAdmins, addAdmin } = require('./adminManager');

async function handleMessage(client, message) {
  try {
    console.log(`Mensaje recibido: "${message.body}"`);
    const chat = await message.getChat();
    const chatId = chat.id._serialized;
    console.log("Chat ID recibido:", chatId);
    console.log("config.groupPruebaId:", config.groupPruebaId);

    // Procesamos los comandos que inician con '/'
    if (message.body.startsWith('/')) {
      // /help
      if (message.body.startsWith('/help')) {
        const helpMessage =
          "Comandos disponibles:\n" +
          "/myid - Muestra tu ID.\n" +
          "/help - Muestra esta lista de comandos.\n" +
          "/reloadKeywords - Recarga el archivo de keywords (solo admins).\n" +
          "/addAdmin <nuevoAdmin> - Agrega un nuevo administrador (solo admins).\n" +
          "/addKeyword <categoria> <tipo> <entrada> - Agrega una nueva entrada (solo admins).\n" +
          "/removeKeyword <categoria> <tipo> <entrada> - Elimina una entrada (solo admins).\n" +
          "/editKeyword <categoria> <tipo> <oldEntry>|<newEntry> - Edita una entrada (solo admins).\n" +
          "/viewKeywords - Muestra las keywords guardadas (solo admins).\n" +
          "/estadoIncidencias <categoria> - Consulta incidencias de la categoría (it, ama, man).\n";
        await chat.sendMessage(helpMessage);
        return;
      }

      // /myid
      if (message.body.startsWith('/myid')) {
        const senderId = message.author ? message.author : message.from;
        await chat.sendMessage(`Tu ID es: ${senderId}`);
        return;
      }

      // /reloadKeywords (solo admins)
      if (message.body.startsWith('/reloadKeywords')) {
        console.log("Comando /reloadKeywords detectado.");
        const senderId = message.author ? message.author : message.from;
        if (!getAdmins().includes(senderId)) {
          console.log(`Acceso denegado para el usuario ${senderId}.`);
          await chat.sendMessage("No tienes permisos para ejecutar este comando.");
          return;
        }
        const newKeywordsData = loadKeywords();
        client.keywordsData = newKeywordsData;
        await chat.sendMessage("Las keywords han sido recargadas exitosamente.");
        console.log("Keywords recargadas:", newKeywordsData);
        return;
      }

      // /addAdmin (solo admins)
      if (message.body.startsWith('/addAdmin')) {
        console.log("Comando /addAdmin detectado.");
        const senderId = message.author ? message.author : message.from;
        if (!getAdmins().includes(senderId)) {
          console.log(`Acceso denegado para el usuario ${senderId}.`);
          await chat.sendMessage("No tienes permisos para ejecutar este comando.");
          return;
        }
        const parts = message.body.split(' ');
        if (parts.length < 2) {
          await chat.sendMessage("Formato inválido. Uso: /addAdmin <nuevoAdmin>");
          return;
        }
        const newAdmin = parts[1].trim();
        console.log(`Intentando agregar nuevo admin: ${newAdmin}`);
        const result = addAdmin(newAdmin);
        if (result) {
          await chat.sendMessage(`El nuevo administrador "${newAdmin}" ha sido agregado.`);
        } else {
          await chat.sendMessage(`No se pudo agregar "${newAdmin}". Es posible que ya sea administrador.`);
        }
        return;
      }

      // /addKeyword (solo admins)
      if (message.body.startsWith('/addKeyword')) {
        console.log("Comando /addKeyword detectado.");
        const senderId = message.author ? message.author : message.from;
        if (!getAdmins().includes(senderId)) {
          console.log(`Acceso denegado para el usuario ${senderId}.`);
          await chat.sendMessage("No tienes permisos para ejecutar este comando.");
          return;
        }
        const parts = message.body.split(' ');
        if (parts.length < 4) {
          await chat.sendMessage("Formato inválido. Uso: /addKeyword <categoria> <tipo> <entrada>");
          return;
        }
        const category = parts[1].toLowerCase();
        const type = parts[2].toLowerCase();
        const newEntry = parts.slice(3).join(' ');
        console.log(`Intentando agregar entrada: Categoría=${category}, Tipo=${type}, Entrada="${newEntry}"`);
        const result = addEntry(category, type, newEntry);
        if (result) {
          await chat.sendMessage(`La entrada "${newEntry}" fue agregada a ${category} (${type}).`);
        } else {
          await chat.sendMessage(`No se pudo agregar la entrada "${newEntry}". Puede que ya exista o que la categoría/tipo sean inválidos.`);
        }
        return;
      }

      // /removeKeyword (solo admins)
      if (message.body.startsWith('/removeKeyword')) {
        console.log("Comando /removeKeyword detectado.");
        const senderId = message.author ? message.author : message.from;
        if (!getAdmins().includes(senderId)) {
          console.log(`Acceso denegado para el usuario ${senderId}.`);
          await chat.sendMessage("No tienes permisos para ejecutar este comando.");
          return;
        }
        const parts = message.body.split(' ');
        if (parts.length < 4) {
          await chat.sendMessage("Formato inválido. Uso: /removeKeyword <categoria> <tipo> <entrada>");
          return;
        }
        const category = parts[1].toLowerCase();
        const type = parts[2].toLowerCase();
        const entryToRemove = parts.slice(3).join(' ');
        console.log(`Intentando remover entrada: Categoría=${category}, Tipo=${type}, Entrada="${entryToRemove}"`);
        const result = removeEntry(category, type, entryToRemove);
        if (result) {
          await chat.sendMessage(`La entrada "${entryToRemove}" fue eliminada de ${category} (${type}).`);
        } else {
          await chat.sendMessage(`No se pudo eliminar la entrada "${entryToRemove}". Puede que no exista o que la categoría/tipo sean inválidos.`);
        }
        return;
      }

      // /editKeyword (solo admins)
      if (message.body.startsWith('/editKeyword')) {
        console.log("Comando /editKeyword detectado.");
        const senderId = message.author ? message.author : message.from;
        if (!getAdmins().includes(senderId)) {
          console.log(`Acceso denegado para el usuario ${senderId}.`);
          await chat.sendMessage("No tienes permisos para ejecutar este comando.");
          return;
        }
        const parts = message.body.split(' ');
        if (parts.length < 4) {
          await chat.sendMessage("Formato inválido. Uso: /editKeyword <categoria> <tipo> <oldEntry>|<newEntry>");
          return;
        }
        const category = parts[1].toLowerCase();
        const type = parts[2].toLowerCase();
        const rest = parts.slice(3).join(' ');
        const entries = rest.split('|');
        if (entries.length < 2) {
          await chat.sendMessage("Formato inválido. Asegúrate de usar '|' para separar la entrada antigua y la nueva.");
          return;
        }
        const oldEntry = entries[0].trim();
        const newEntry = entries[1].trim();
        console.log(`Intentando editar entrada: Categoría=${category}, Tipo=${type}, Vieja="${oldEntry}", Nueva="${newEntry}"`);
        const result = editEntry(category, type, oldEntry, newEntry);
        if (result) {
          await chat.sendMessage(`La entrada "${oldEntry}" fue modificada a "${newEntry}" en ${category} (${type}).`);
        } else {
          await chat.sendMessage(`No se pudo editar la entrada "${oldEntry}". Verifica que exista y que el formato sea correcto.`);
        }
        return;
      }

      // /viewKeywords (solo admins)
      if (message.body.startsWith('/viewKeywords')) {
        console.log("Comando /viewKeywords detectado.");
        const senderId = message.author ? message.author : message.from;
        if (!getAdmins().includes(senderId)) {
          console.log(`Acceso denegado para el usuario ${senderId}.`);
          await chat.sendMessage("No tienes permisos para ejecutar este comando.");
          return;
        }
        const keywordsData = loadKeywords();
        let response = "Keywords guardadas:\n\n";
        for (let cat in keywordsData.identificadores) {
          response += `Categoría ${cat.toUpperCase()}:\n`;
          response += `  Palabras: ${keywordsData.identificadores[cat].palabras.join(', ')}\n`;
          response += `  Frases: ${keywordsData.identificadores[cat].frases.join(', ')}\n\n`;
        }
        response += "Confirmación:\n";
        response += `  Palabras: ${keywordsData.confirmacion.palabras.join(', ')}\n`;
        response += `  Frases: ${keywordsData.confirmacion.frases.join(', ')}\n`;
        await chat.sendMessage(response);
        return;
      }

      // /estadoIncidencias (uso público)
      if (message.body.startsWith('/estadoIncidencias')) {
        const parts = message.body.split(' ');
        if (parts.length < 2) {
          await chat.sendMessage("Formato inválido. Uso: /estadoIncidencias <categoria> (it, ama, man)");
          return;
        }
        const categoria = parts[1].toLowerCase();
        if (!['it', 'ama', 'man'].includes(categoria)) {
          await chat.sendMessage("Categoría inválida. Usa: it, ama o man.");
          return;
        }
        const { getIncidenciasByCategory, formatIncidenciasSummary } = require('./incidenciasManager');
        getIncidenciasByCategory(categoria, (err, incidencias) => {
          if (err) {
            chat.sendMessage("Error al consultar las incidencias.");
          } else {
            const summary = formatIncidenciasSummary(incidencias);
            chat.sendMessage(summary);
          }
        });
        return;
      }
    } // Fin de comandos que inician con '/'

    // Procesamiento de incidencias en el Grupo de Pruebas (registro automático)
    if (chatId === config.groupPruebaId) {
      console.log("Procesando mensaje de Grupo Pruebas (incidencia).");
      const messageText = message.body.toLowerCase();
      const cleanedMessage = messageText.replace(/[.,!?()]/g, '');
      if (!cleanedMessage.trim()) {
        console.log("El mensaje está vacío tras la limpieza. Se omite.");
        return;
      }
      const wordsSet = new Set(cleanedMessage.split(/\s+/));
      console.log("Conjunto de palabras:", wordsSet);
      const categories = ['it', 'ama', 'man'];
      let foundCategories = [];
      const keywordsData = client.keywordsData;
      for (let category of categories) {
        const data = keywordsData.identificadores[category];
        const foundKeyword = data.palabras.some(word => wordsSet.has(word.toLowerCase()));
        const foundPhrase = data.frases.some(phrase => messageText.includes(phrase.toLowerCase()));
        console.log(`Evaluando categoría ${category}: foundKeyword=${foundKeyword}, foundPhrase=${foundPhrase}`);
        if (foundKeyword || foundPhrase) {
          foundCategories.push(category);
        }
      }
      console.log("Categorías detectadas:", foundCategories);
      if (!foundCategories.length) {
        console.log("No se encontró ninguna categoría en el mensaje.");
        return;
      }
      console.log(`Registrando incidencia para categorías ${foundCategories.join(', ')}: ${message.body}`);
      
      // Función para reenviar el mensaje al grupo destino según la categoría detectada
      async function forwardMessage(targetGroupId, categoryLabel) {
        try {
          const targetChat = await client.getChatById(targetGroupId);
          await targetChat.sendMessage(`Nueva tarea recibida: \n\n*${message.body}*`);
          console.log(`Mensaje reenviado a ${categoryLabel}: ${message.body}`);
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
      
      // Construir mensaje de resumen de equipos a los que se envió la incidencia
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
      await chat.sendMessage(`El mensaje se ha enviado al equipo de ${teamList}.`);
      return;
    }

    // Procesamiento para mensajes en grupos de destino (confirmación de incidencia)
    if ([config.groupBotDestinoId, config.groupMantenimientoId, config.groupAmaId].includes(chatId)) {
      console.log("Procesando mensaje de Grupo Destino (confirmación).");
      if (!message.hasQuotedMsg) {
        console.log("El mensaje no es una respuesta (no cita ningún mensaje). Se omite.");
        return;
      }
      const quotedMessage = await message.getQuotedMessage();
      if (!quotedMessage.body.startsWith("Nueva tarea recibida:")) {
        console.log("El mensaje citado no corresponde a una tarea enviada. Se omite.");
        return;
      }
      // Se define keywordsData en este bloque para confirmar
      const keywordsData = client.keywordsData;
      const responseText = message.body.toLowerCase();
      const responseWords = new Set(responseText.split(/\s+/));
      const confirmPhraseFound = keywordsData.confirmacion.frases.some(phrase => responseText.includes(phrase.toLowerCase()));
      const confirmWordFound = keywordsData.confirmacion.palabras.some(word => responseWords.has(word.toLowerCase()));
      console.log(`Confirmación detectada: confirmPhraseFound=${confirmPhraseFound}, confirmWordFound=${confirmWordFound}`);
      if (!(confirmPhraseFound || confirmWordFound)) {
        console.log("No se detectó ninguna palabra o frase de confirmación. Se ignora el mensaje.");
        return;
      }
      const taskMessage = quotedMessage.body.replace(/^Nueva tarea recibida:\s*/, '');
      const confirmationMessage = `La tarea:\n${taskMessage}\nha sido COMPLETADA.`;
      const responseGroupChat = await client.getChatById(config.groupPruebaId);
      await responseGroupChat.sendMessage(confirmationMessage);
      console.log(`Confirmación reenviada al Grupo de Pruebas: ${confirmationMessage}`);
      return;
    }

    console.log("El mensaje proviene de un grupo no monitoreado o no coincide con ninguna lógica. Se omite.");
    
  } catch (err) {
    console.error("Error en handleMessage:", err);
  }
}

module.exports = handleMessage;
//Modulo con envio de mensajes
