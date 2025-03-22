// modules/commandsHandler.js
const config = require('./config');
const { addEntry, removeEntry, editEntry, loadKeywords } = require('./keywordsManager');
const incidenciasDB = require('./incidenciasDB');
const { registerUser, getUser, loadUsers, saveUsers } = require('./userManager');

async function handleCommands(client, message) {
  const chat = await message.getChat();
  const senderId = message.author ? message.author : message.from;
  const body = message.body ? message.body.trim() : "";
  
  // Normalizamos el comando a minúsculas para comparar
  const normalizedBody = body.toLowerCase();
  console.log(`Procesando comando: "${body}" desde: ${senderId}`);

  // ------------------- Comandos para administradores -------------------
  // Comando para usuarios: /ayuda (excluyendo /helpAdmin)
  if (normalizedBody.startsWith('/ayuda') && !normalizedBody.startsWith('/helpadmin')) {
    const helpMessage =
      "*COMANDOS USUARIOS* \n\n" +
      "*/id* \n Muestra tu ID.\n\n" +
      "*/ayuda* \n Muestra esta lista de comandos.\n\n" +
      "*/tareas <categoria>* \n Consulta incidencias de la categoría (it, ama, man).\n\n" +
      "*/tareasFecha <YYYY-MM-DD>* \n Consulta incidencias de una fecha específica.\n\n" +
      "*/tareasRango <fechaInicio> <fechaFin>* \n Consulta incidencias en un rango de fechas.\n\n" +
      "*/tareasPendientes <categoria>* \n Muestra únicamente las incidencias pendientes.\n\n" +
      "*/tareasCompletadas <categoria>* \n Muestra únicamente las incidencias completadas.\n\n" +
      "*/tareaDetalles <id>* \n Muestra los detalles de una incidencia.\n\n";
    await chat.sendMessage(helpMessage);
    return true;
  }

  // Comando para administradores: /helpAdmin
  if (normalizedBody.startsWith('/helpadmin')) {
    const currentUser = getUser(senderId);
    console.log("DEBUG /helpadmin - getUser:", currentUser);
    if (!currentUser || currentUser.rol !== 'admin') {
      await chat.sendMessage("No tienes permisos para ver los comandos de administración.");
      return true;
    }
    const helpAdminMessage =
      "*COMANDOS ADMINISTRADORES*\n\n\n" +
      "*KEYWORDS*\n\n" +
      "*/reloadKeywords* \n Recarga el archivo de keywords.\n\n" +
      "*/addKeyword <categoria> <tipo> <entrada>* \n Agrega una nueva entrada.\n\n" +
      "*/editKeyword <categoria> <tipo> <oldEntry>|<newEntry>* \n Edita una entrada.\n\n" +
      "*/viewKeywords* \n Muestra las keywords guardadas.\n\n\n" +
      "*USERS*\n\n" +
      "*/registerUser <id> | <nombre-apellido> | <cargo> | <rol>* \n Registra un usuario.\n\n" +
      "*/editUser <id> | <nombre-apellido> | <cargo> | <rol>* \n Edita la información de un usuario.\n\n" +
      "*/removeUser <id>* \n Elimina un usuario.\n\n" +
      "*/viewUser* \n Muestra la lista de usuarios registrados.\n\n";
      
    await chat.sendMessage(helpAdminMessage);
    return true;
  }
  // -------------------------------COMANDOS PARA PALABRAS -------------------------------------------
  
  // Comando: /viewkeywords (solo admin)
  if (normalizedBody.startsWith('/viewkeywords')) {
    const currentUser = getUser(senderId);
    if (!currentUser || currentUser.rol !== 'admin') {
      await chat.sendMessage("No tienes permisos para ejecutar este comando.");
      return true;
    }
    const keywords = loadKeywords();
    let messageText = "*KEYWORDS*\n\n";
    if (keywords.identificadores) {
      messageText += "*TRIGGERS:*\n\n";
      for (const category in keywords.identificadores) {
        const data = keywords.identificadores[category];
        messageText += `*${category.toUpperCase()}*\n`;
        messageText += `  *Palabras:* ${data.palabras.join(', ')}\n`;
        messageText += `  *Frases:* ${data.frases.join(', ')}\n\n`;
      }
    }
    if (keywords.confirmacion) {
      messageText += "*CHECKERS:*\n\n";
      messageText += `  *Palabras:* ${keywords.confirmacion.palabras.join(', ')}\n`;
      messageText += `  *Frases:* ${keywords.confirmacion.frases.join(', ')}\n`;
    }
    await chat.sendMessage(messageText);
    return true;
  }


  // Comando: /reloadKeywords
  if (normalizedBody.startsWith('/reloadkeywords')) {
    const currentUser = getUser(senderId);
    console.log("DEBUG /reloadkeywords - getUser:", currentUser);
    if (!currentUser || currentUser.rol !== 'admin') {
      await chat.sendMessage("No tienes permisos para ejecutar este comando.");
      return true;
    }
    const keywords = loadKeywords();
    client.keywordsData = keywords;
    await chat.sendMessage("Keywords recargadas.");
    return true;
  }

  // Comando: /addKeyword <categoria> <tipo> <entrada>
  if (normalizedBody.startsWith('/addkeyword')) {
    const currentUser = getUser(senderId);
    console.log("DEBUG /addkeyword - getUser:", currentUser);
    if (!currentUser || currentUser.rol !== 'admin') {
      await chat.sendMessage("No tienes permisos para ejecutar este comando.");
      return true;
    }
    const commandContent = body.substring('/addKeyword'.length).trim();
    const parts = commandContent.split(' ');
    if (parts.length < 3) {
      await chat.sendMessage("Formato inválido. Uso: /addKeyword <categoria> <tipo> <entrada>");
      return true;
    }
    const categoria = parts[0].toLowerCase();
    const tipo = parts[1].toLowerCase();
    const entrada = parts.slice(2).join(' ').trim();
    const result = addEntry(categoria, tipo, entrada);
    if (result) {
      await chat.sendMessage(`Entrada agregada a la categoría ${categoria}: ${entrada}`);
    } else {
      await chat.sendMessage("Error o la entrada ya existe.");
    }
    return true;
  }

  // Comando: /editKeyword <categoria> <tipo> <oldEntry>|<newEntry>
  if (normalizedBody.startsWith('/editkeyword')) {
    const currentUser = getUser(senderId);
    console.log("DEBUG /editkeyword - getUser:", currentUser);
    if (!currentUser || currentUser.rol !== 'admin') {
      await chat.sendMessage("No tienes permisos para ejecutar este comando.");
      return true;
    }
    const commandContent = body.substring('/editKeyword'.length).trim();
    // Usamos "|" para separar directamente
    const parts = commandContent.split('|');
    if (parts.length < 2) {
      await chat.sendMessage("Formato inválido. Uso: /editKeyword <categoria> <tipo> <oldEntry>|<newEntry>");
      return true;
    }
    // Se asume que la parte izquierda tiene "<categoria> <tipo> <oldEntry>"
    const leftParts = parts[0].trim().split(' ');
    if (leftParts.length < 3) {
      await chat.sendMessage("Formato inválido. Uso: /editKeyword <categoria> <tipo> <oldEntry>|<newEntry>");
      return true;
    }
    const categoria = leftParts[0].toLowerCase();
    const tipo = leftParts[1].toLowerCase();
    // El resto de la parte izquierda se concatena como oldEntry
    const oldEntry = leftParts.slice(2).join(' ').trim();
    const newEntry = parts[1].trim();
    const result = editEntry(categoria, tipo, oldEntry, newEntry);
    if (result) {
      await chat.sendMessage(`Entrada editada en la categoría ${categoria}:\n${oldEntry} -> ${newEntry}`);
    } else {
      await chat.sendMessage("Error o la entrada no existe/ya existe el nuevo valor.");
    }
    return true;
  }

  // ------------------------------------------ COMANDOS PARA ROLES Y USUARIOS -------------------------------------------
  
  // Comando: /registeruser <id> | <nombre-apellido> | <cargo> | <rol> (solo admin)
  if (normalizedBody.startsWith('/registeruser')) {
    const currentUser = getUser(senderId);
    if (!currentUser || currentUser.rol !== 'admin') {
      await chat.sendMessage("No tienes permisos para ejecutar este comando.");
      return true;
    }
    const commandContent = body.substring('/registerUser'.length).trim();
    const parts = commandContent.split('|');
    if (parts.length < 4) {
      await chat.sendMessage("Formato inválido. Uso: /registerUser <id> | <nombre-apellido> | <cargo> | <rol>");
      return true;
    }
    const idPart = parts[0].trim();
    const nombreApellido = parts[1].trim();
    const cargo = parts[2].trim();
    const rol = parts[3].trim().toLowerCase();
    const result = registerUser(idPart, nombreApellido, cargo, rol);
    let responseMessage = "";
    if (result) {
      responseMessage = `Usuario ${nombreApellido} (${cargo}, rol: ${rol}) registrado con ID: ${idPart}`;
    } else {
      responseMessage = "Error al registrar el usuario.";
    }
    await chat.sendMessage(responseMessage);
    return true;
  }

  // Comando: /edituser <id> | <nombre-apellido> | <cargo> | <rol> (solo admin)
  if (normalizedBody.startsWith('/edituser')) {
    const currentUser = getUser(senderId);
    if (!currentUser || currentUser.rol !== 'admin') {
      await chat.sendMessage("No tienes permisos para ejecutar este comando.");
      return true;
    }
    const commandContent = body.substring('/editUser'.length).trim();
    const parts = commandContent.split('|');
    if (parts.length < 4) {
      await chat.sendMessage("Formato inválido. Uso: /editUser <id> | <nombre-apellido> | <cargo> | <rol>");
      return true;
    }
    const idPart = parts[0].trim();
    const nombreApellido = parts[1].trim();
    const cargo = parts[2].trim();
    const rol = parts[3].trim().toLowerCase();
    let users = loadUsers();
    if (!users[idPart]) {
      await chat.sendMessage(`No se encontró un usuario con ID ${idPart}.`);
      return true;
    }
    users[idPart] = { nombre: nombreApellido, cargo: cargo, rol: rol };
    const saved = saveUsers(users);
    if (saved) {
      await chat.sendMessage(`Usuario con ID ${idPart} actualizado a: ${nombreApellido} (${cargo}, rol: ${rol}).`);
    } else {
      await chat.sendMessage("Error al actualizar el usuario.");
    }
    return true;
  }

  // Comando: /removeuser <id> (solo admin)
  if (normalizedBody.startsWith('/removeuser')) {
    const currentUser = getUser(senderId);
    if (!currentUser || currentUser.rol !== 'admin') {
      await chat.sendMessage("No tienes permisos para ejecutar este comando.");
      return true;
    }
    const parts = body.split(' ');
    if (parts.length < 2) {
      await chat.sendMessage("Formato inválido. Uso: /removeUser <id>");
      return true;
    }
    const idToRemove = parts[1].trim();
    let users = loadUsers();
    if (!users[idToRemove]) {
      await chat.sendMessage(`No se encontró el usuario con ID ${idToRemove}.`);
      return true;
    }
    delete users[idToRemove];
    const saved = saveUsers(users);
    if (saved) {
      await chat.sendMessage(`El usuario con ID ${idToRemove} ha sido eliminado.`);
    } else {
      await chat.sendMessage("Error al eliminar el usuario.");
    }
    return true;
  }

  // Comando: /viewuser (solo admin)
  if (normalizedBody.startsWith('/viewuser')) {
    const currentUser = getUser(senderId);
    if (!currentUser || currentUser.rol !== 'admin') {
      await chat.sendMessage("No tienes permisos para ejecutar este comando.");
      return true;
    }
    const users = loadUsers();
    let userList = "";
    for (let id in users) {
      userList += `${id} => ${users[id].nombre} (${users[id].cargo}, rol: ${users[id].rol})\n`;
    }
    if (!userList) userList = "No hay usuarios registrados.";
    await chat.sendMessage(`Usuarios registrados:\n${userList}`);
    return true;
  }



  // ------------------- Comandos para IDs -------------------
  // /identificador
  if (normalizedBody.startsWith('/id')) {
    await chat.sendMessage(`Tu ID es: ${senderId}`);
    return true;
  }

  // ------------------- Comandos para incidencias -------------------
  // Si no se detecta un comando admin o de usuario, se asume que es incidencia.
  
   // /tareas <categoria>
   if (normalizedBody.startsWith('/tareas ') &&
       !normalizedBody.startsWith('/tareasfecha') &&
       !normalizedBody.startsWith('/tareasrango') &&
       !normalizedBody.startsWith('/tareaspendientes') &&
       !normalizedBody.startsWith('/tareascompletadas')) {
     const parts = body.split(' ');
     if (parts.length < 2) {
       await chat.sendMessage("Formato inválido. Uso: /tareas <categoria> (it, ama, man)");
       return true;
     }
     const categoria = parts[1].toLowerCase();
     if (!['it', 'ama', 'man'].includes(categoria)) {
       await chat.sendMessage("Categoría inválida. Usa: it, ama o man.");
       return true;
     }
     incidenciasDB.getIncidenciasByCategory(categoria, (err, rows) => {
       if (err) {
         chat.sendMessage("Error al consultar las incidencias.");
       } else {
         let summary = `Incidencias para la categoría *${categoria.toUpperCase()}*:\n\n`;
         if (!rows.length) {
           summary += "No hay incidencias registradas en esta categoría.";
         } else {
           rows.forEach(row => {
             summary += `ID: ${row.id} | Estado: ${row.estado} | Descripción: ${row.descripcion}\n`;
           });
         }
         chat.sendMessage(summary);
       }
     });
     return true;
   }
 
   // /tareasfecha <YYYY-MM-DD>
   if (normalizedBody.startsWith('/tareasfecha')) {
     const parts = body.split(' ');
     if (parts.length < 2) {
       await chat.sendMessage("Formato inválido. Uso: /tareasFecha <YYYY-MM-DD>");
       return true;
     }
     const date = parts[1].trim();
     incidenciasDB.getIncidenciasByDate(date, (err, rows) => {
       if (err) {
         chat.sendMessage("Error al consultar incidencias por fecha.");
       } else {
         let summary = `Incidencias del *${date}*:\n\n`;
         if (!rows.length) {
           summary += "No hay incidencias registradas para esa fecha.";
         } else {
           rows.forEach(row => {
             summary += `ID: ${row.id} | Estado: ${row.estado} | Descripción: ${row.descripcion}\n`;
           });
         }
         chat.sendMessage(summary);
       }
     });
     return true;
   }
 
   // /tareasrango <fechaInicio> <fechaFin>
   if (normalizedBody.startsWith('/tareasrango')) {
     const parts = body.split(' ');
     if (parts.length < 3) {
       await chat.sendMessage("Formato inválido. Uso: /tareasRango <fechaInicio> <fechaFin> (YYYY-MM-DD)");
       return true;
     }
     let fechaInicio = parts[1].trim();
     let fechaFin = parts[2].trim();
     fechaInicio = `${fechaInicio}T00:00:00.000Z`;
     fechaFin = `${fechaFin}T23:59:59.999Z`;
     incidenciasDB.getIncidenciasByRange(fechaInicio, fechaFin, (err, rows) => {
       if (err) {
         chat.sendMessage("Error al consultar incidencias por rango.");
       } else {
         let summary = `Incidencias entre ${parts[1]} y ${parts[2]}:\n\n`;
         if (!rows.length) {
           summary += "No hay incidencias registradas en ese rango.";
         } else {
           rows.forEach(row => {
             summary += `ID: ${row.id} | Estado: ${row.estado} | Descripción: ${row.descripcion}\n`;
           });
         }
         chat.sendMessage(summary);
       }
     });
     return true;
   }
 
   // /tareaspendientes <categoria>
   if (normalizedBody.startsWith('/tareaspendientes')) {
     const parts = body.split(' ');
     if (parts.length < 2) {
       await chat.sendMessage("Formato inválido. Uso: /tareasPendientes <categoria> (it, ama, man)");
       return true;
     }
     const categoria = parts[1].toLowerCase();
     if (!['it', 'ama', 'man'].includes(categoria)) {
       await chat.sendMessage("Categoría inválida. Usa: it, ama o man.");
       return true;
     }
     incidenciasDB.getIncidenciasByCategory(categoria, (err, rows) => {
       if (err) {
         chat.sendMessage("Error al consultar incidencias.");
       } else {
         const pendingRows = rows.filter(r => r.estado !== "completada");
         let summary = `Incidencias pendientes en categoría ${categoria.toUpperCase()}:\n\n`;
         if (!pendingRows.length) {
           summary += "No hay incidencias pendientes en esta categoría.";
         } else {
           pendingRows.forEach(row => {
             summary += `*ID:* ${row.id} | *Estado:* ${row.estado} | *Descripción:* ${row.descripcion}\n\n`;
           });
         }
         chat.sendMessage(summary);
       }
     });
     return true;
   }
 
   // /tareascompletadas <categoria>
   if (normalizedBody.startsWith('/tareascompletadas')) {
     const parts = body.split(' ');
     if (parts.length < 2) {
       await chat.sendMessage("Formato inválido. Uso: /tareasCompletadas <categoria> (it, ama, man)");
       return true;
     }
     const categoria = parts[1].toLowerCase();
     if (!['it', 'ama', 'man'].includes(categoria)) {
       await chat.sendMessage("Categoría inválida. Usa: it, ama o man.");
       return true;
     }
     incidenciasDB.getIncidenciasByCategory(categoria, (err, rows) => {
       if (err) {
         chat.sendMessage("Error al consultar incidencias.");
       } else {
         const compRows = rows.filter(r => r.estado === "completada");
         let summary = `Incidencias completadas en categoría *${categoria.toUpperCase()}*:\n\n`;
         if (!compRows.length) {
           summary += "No hay incidencias completadas en esta categoría.";
         } else {
           compRows.forEach(row => {
             summary += `*ID:* ${row.id} | *Estado:* ${row.estado} | *Descripción:* ${row.descripcion}\n\n`;
           });
         }
         chat.sendMessage(summary);
       }
     });
     return true;
   }
 
   // /tareaDetalles <id>
   if (normalizedBody.startsWith('/tareadetalles')) {
     const parts = body.split(' ');
     if (parts.length < 2) {
       await chat.sendMessage("Formato inválido. Uso: /tareaDetalles <id>");
       return true;
     }
     const incId = parts[1].trim();
     incidenciasDB.getIncidenciaById(incId, async (err, row) => {
       if (err) {
         await chat.sendMessage("Error al consultar la incidencia.");
       } else if (!row) {
         await chat.sendMessage(`No se encontró ninguna incidencia con ID ${incId}.`);
       } else {
         let detailMessage = `*Detalles de la incidencia (ID: ${row.id}):*\n\n`;
         detailMessage += `*Descripción:*\n ${row.descripcion}\n`;
         const user = getUser(row.reportadoPor);
         if (user) {
           detailMessage += `*Reportado por:*\n ${user.nombre} (${user.cargo}, rol: ${user.rol})\n`;
         } else {
           detailMessage += `*Reportado por:*\n ${row.reportadoPor}\n`;
         }
         detailMessage += `*Fecha de Creación:*\n ${row.fechaCreacion}\n`;
         detailMessage += `*Estado:*\n ${row.estado}\n`;
         detailMessage += `*Categoría:*\n ${row.categoria}\n`;
         detailMessage += `*Grupo de Origen:*\n ${row.grupoOrigen}\n`;
         detailMessage += row.media ? "*Media:*\n [Adjunta]" : "*Media:*\n No hay";
         await chat.sendMessage(detailMessage);
         if (row.media) {
           const { MessageMedia } = require('whatsapp-web.js');
           const media = new MessageMedia("image/png", row.media);
           await chat.sendMessage(media);
         }
       }
     });
     return true;
   }
   
   // Si ningún comando se detecta, se retorna false
   return false;
 }
 
 module.exports = { handleCommands };
 
 //manejador de comandos
