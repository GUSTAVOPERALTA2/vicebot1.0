// modules/autoReminder.js
const moment = require('moment-timezone');
const config = require('./config');
const incidenciasDB = require('./incidenciasDB');

/**
 * Calcula el tiempo transcurrido entre la fecha de creación y el momento actual, en días, horas y minutos.
 * @param {string} fechaCreacion - Fecha de creación (ISO).
 * @returns {string} Tiempo formateado.
 */
function calcularTiempoSinRespuesta(fechaCreacion) {
  const ahora = moment();
  const inicio = moment(fechaCreacion);
  const duracion = moment.duration(ahora.diff(inicio));
  const dias = Math.floor(duracion.asDays());
  const horas = duracion.hours();
  const minutos = duracion.minutes();
  return `${dias} día(s), ${horas} hora(s), ${minutos} minuto(s)`;
}

/**
 * Revisa las incidencias pendientes y envía un recordatorio individual.
 * Si initialRun es true, se usa umbral 0h; si no, umbral 1h.
 * Solo se envía si la hora actual (en "America/Hermosillo") está entre 8:00 y 21:00.
 * @param {Client} client - El cliente de WhatsApp.
 * @param {boolean} initialRun 
 */
function checkPendingIncidences(client, initialRun = false) {
  const now = moment().tz("America/Hermosillo");
  const currentHour = now.hour();
  if (currentHour < 8 || currentHour >= 21) {
    console.log(`Fuera del horario laboral (hora actual: ${currentHour}). No se enviará recordatorio.`);
    return;
  }
  const threshold = initialRun ? now.toISOString() : now.clone().subtract(1, 'hour').toISOString();
  const threshold24 = now.clone().subtract(24, 'hours').toISOString();
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
                  `Fecha de creacion: ${fechaFormateada}\n` +
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
  // Chequeo inmediato: umbral 0h
  checkPendingIncidences(client, true);
  // Ejecución periódica cada 1 hora: umbral 1h
  setInterval(() => {
    checkPendingIncidences(client, false);
  }, 3600000);
}

module.exports = { startReminder };

//funcion con db
