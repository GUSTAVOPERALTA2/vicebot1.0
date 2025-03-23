// vicebot/modules/incidenceManager/incidenceDB.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
let db;

function initDB() {
  const dbPath = path.join(__dirname, '../../data/incidencias.db');
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error("Error al abrir la BD:", err);
    } else {
      console.log("Base de datos iniciada.");
      db.run(`CREATE TABLE IF NOT EXISTS incidencias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uniqueMessageId TEXT,
                descripcion TEXT,
                reportadoPor TEXT,
                fechaCreacion TEXT,
                estado TEXT,
                categoria TEXT,
                confirmaciones TEXT,
                grupoOrigen TEXT,
                media TEXT
              )`);
    }
  });
}

function getDB() {
  return db;
}

function insertarIncidencia(incidencia, callback) {
  const sql = `INSERT INTO incidencias 
    (uniqueMessageId, descripcion, reportadoPor, fechaCreacion, estado, categoria, confirmaciones, grupoOrigen, media) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(sql, [
    incidencia.uniqueMessageId,
    incidencia.descripcion,
    incidencia.reportadoPor,
    incidencia.fechaCreacion,
    incidencia.estado,
    incidencia.categoria,
    incidencia.confirmaciones ? JSON.stringify(incidencia.confirmaciones) : null,
    incidencia.grupoOrigen,
    incidencia.media
  ], function(err) {
    callback(err, this.lastID);
  });
}

function buscarIncidenciaPorUniqueIdAsync(uniqueId) {
  return new Promise((resolve, reject) => {
    const sql = "SELECT * FROM incidencias WHERE uniqueMessageId = ? LIMIT 1";
    db.get(sql, [uniqueId], (err, row) => {
      if (err) return reject(err);
      if (row && row.confirmaciones) {
        try {
          row.confirmaciones = JSON.parse(row.confirmaciones);
        } catch (e) {
          console.error("Error al parsear confirmaciones:", e);
        }
      }
      resolve(row);
    });
  });
}

/* Funciones adicionales para soportar los comandos */

// Busca una incidencia por ID (convertido a string o número según convenga)
function getIncidenciaById(incidenciaId, callback) {
  const sql = "SELECT * FROM incidencias WHERE id = ?";
  db.get(sql, [incidenciaId], (err, row) => {
    if (row && row.confirmaciones) {
      try {
        row.confirmaciones = JSON.parse(row.confirmaciones);
      } catch (e) {
        console.error("Error al parsear confirmaciones:", e);
      }
    }
    callback(err, row);
  });
}

// Obtiene incidencias cuya categoría contenga el valor dado (usamos LIKE)
function getIncidenciasByCategory(category, callback) {
  const sql = "SELECT * FROM incidencias WHERE categoria LIKE ?";
  db.all(sql, [`%${category}%`], (err, rows) => {
    if (err) {
      callback(err);
    } else {
      if (rows) {
        rows.forEach(row => {
          if (row.confirmaciones) {
            try {
              row.confirmaciones = JSON.parse(row.confirmaciones);
            } catch (e) {
              console.error("Error al parsear confirmaciones:", e);
            }
          }
        });
      }
      callback(null, rows);
    }
  });
}

// Obtiene incidencias por fecha (suponiendo formato YYYY-MM-DD en la fechaCreacion)
function getIncidenciasByDate(date, callback) {
  const sql = "SELECT * FROM incidencias WHERE fechaCreacion LIKE ?";
  db.all(sql, [`${date}%`], (err, rows) => {
    if (err) {
      callback(err);
    } else {
      if (rows) {
        rows.forEach(row => {
          if (row.confirmaciones) {
            try {
              row.confirmaciones = JSON.parse(row.confirmaciones);
            } catch (e) {
              console.error("Error al parsear confirmaciones:", e);
            }
          }
        });
      }
      callback(null, rows);
    }
  });
}

// Obtiene incidencias en un rango de fechas
function getIncidenciasByRange(fechaInicio, fechaFin, callback) {
  const sql = "SELECT * FROM incidencias WHERE fechaCreacion >= ? AND fechaCreacion <= ?";
  db.all(sql, [fechaInicio, fechaFin], (err, rows) => {
    if (err) {
      callback(err);
    } else {
      if (rows) {
        rows.forEach(row => {
          if (row.confirmaciones) {
            try {
              row.confirmaciones = JSON.parse(row.confirmaciones);
            } catch (e) {
              console.error("Error al parsear confirmaciones:", e);
            }
          }
        });
      }
      callback(null, rows);
    }
  });
}

module.exports = {
  initDB,
  getDB,
  insertarIncidencia,
  buscarIncidenciaPorUniqueIdAsync,
  getIncidenciaById,
  getIncidenciasByCategory,
  getIncidenciasByDate,
  getIncidenciasByRange
};
