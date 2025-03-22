const moment = require('moment-timezone');
const config = require('./config');
const incidenciasDB = require('../modules/incidenceManager/incidenceDB');

function calcularTiempoSinRespuesta(fechaCreacion) {
  const ahora = moment();
  const inicio = moment(fechaCreacion);
  const duracion = moment.duration(ahora.diff(inicio));
  const dias = Math.floor(duracion.asDays());
  const horas = duracion.hours();
  const minutos = duracion.minutes();
  return `${dias} día(s), ${horas} hora(s), ${minutos} minuto(s)`;
}

function checkPendingIncidences(client, initialRun = false) {
  const now = moment().tz("America/Hermosillo");
  const currentHour = now.hour();
  if (currentHour < 8 || currentHour >= 21) {
    console.log(`Fuera del horario laboral (hora actual: ${currentHour}). No se enviará recordatorio.`);
    return;
  }
  const threshold = initialRun ? now.toISOString() : now.clone().subtract(1, 'hour').toISOString();
  console.log(`Chequeando incidencias pendientes (umbral ${initialRun ? '0h' : '1h'}): ${threshold}`);

  const db = incidenciasDB.getDB();
  if (!db) {
    console.error("La base de datos no está inicializada.");
    return;
  }
  const sql = "SELECT * FROM incidencias WHERE estado != 'completada' AND fechaCreacion < ?";
  db.all(sql, [threshold], (err, rows) => {
    if (err) {
      console.error("Error en recordatorio automático:", err.message);
      return;
    }
    if (!rows || rows.length === 0) {
      console.log(`No se encontraron incidencias pendientes (umbral ${initialRun ? '0h' : '1h'}).`);
      return;
    }
    rows.forEach(row => {
      const categoria = row.categoria.split(',')[0].trim().toLowerCase();
      const groupId = config.destinoGrupos[categoria];
      if (!groupId) {
        console.warn(`No hay grupo asignado para la categoría: ${categoria}`);
        return;
      }
      const tiempoSinRespuesta = calcularTiempoSinRespuesta(row.fechaCreacion);
      const fechaFormateada = moment(row.fechaCreacion).format("DD/MM/YYYY hh:mm a");
      const msg = `*RECORDATORIO: TAREA INCOMPLETA*\n\n` +
                  `${row.descripcion}\n\n` +
                  `Fecha de creación: ${fechaFormateada}\n` +
                  `Tiempo sin respuesta: ${tiempoSinRespuesta}\n` +
                  `ID: ${row.id}`;
      console.log(`Enviando recordatorio para incidencia ${row.id} a grupo ${groupId}`);
      client.getChatById(groupId)
        .then(chat => {
          chat.sendMessage(msg);
          console.log(`Recordatorio enviado para incidencia ${row.id} a grupo ${groupId}.`);
        })
        .catch(e => console.error(`Error al enviar recordatorio para incidencia ${row.id}:`, e));
    });
  });
}

function startReminder(client) {
  // Ejecución inmediata con umbral 0h
  checkPendingIncidences(client, true);
  // Ejecución periódica cada 1 hora con umbral 1h
  setInterval(() => {
    checkPendingIncidences(client, false);
  }, 3600000);
}

module.exports = { startReminder };


//Reminder Final