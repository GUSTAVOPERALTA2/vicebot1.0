// index.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const messageHandler = require('./modules/messageHandler');
const incidenciasDB = require('./modules/incidenciasDB');
const { loadKeywords } = require('./modules/keywordsManager');
const { startReminder } = require('./modules/autoReminder');

// Inicializamos la base de datos SQLite y creamos la tabla de incidencias (si no existe)
incidenciasDB.initDB();

// Creamos el cliente de WhatsApp con autenticación local
const client = new Client({
  authStrategy: new LocalAuth()
});

// Cargamos las keywords y las asignamos a la propiedad del cliente para que estén disponibles en otros módulos
client.keywordsData = loadKeywords();

// Evento para generar el código QR y escanearlo con WhatsApp Web
client.on('qr', qr => {
  console.log('Escanea este QR con WhatsApp Web:');
  qrcode.generate(qr, { small: true });
});

// Cuando el cliente esté listo, se muestran algunos datos opcionales (chats y grupos)
client.on('ready', async () => {
  console.log('Bot de WhatsApp conectado y listo.');
  startReminder(client);
  const chats = await client.getChats();
  console.log(`Chats disponibles: ${chats.length}`);
  const groups = chats.filter(chat => chat.id._serialized.endsWith('@g.us'));
  console.log(`Grupos disponibles: ${groups.length}`);
  groups.forEach(group => {
    console.log(`Grupo: ${group.name} - ID: ${group.id._serialized}`);
  });
});

// Cada vez que se reciba un mensaje, se delega el procesamiento al messageHandler
client.on('message', async message => {
  await messageHandler(client, message);
});

// Inicializamos el cliente para comenzar a escuchar mensajes
client.initialize();

//NUEVO INDEX
