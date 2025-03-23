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
                originalMsgId TEXT,
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
    (uniqueMessageId, originalMsgId, descripcion, reportadoPor, fechaCreacion, estado, categoria, confirmaciones, grupoOrigen, media) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(sql, [
    incidencia.uniqueMessageId,
    incidencia.originalMsgId,
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

function buscarIncidenciaPorOriginalMsgIdAsync(originalMsgId) {
  return new Promise((resolve, reject) => {
    const sql = "SELECT * FROM incidencias WHERE originalMsgId = ? LIMIT 1";
    db.get(sql, [originalMsgId], (err, row) => {
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

function updateIncidenciaStatus(incidenciaId, estado, callback) {
  const sql = "UPDATE incidencias SET estado = ? WHERE id = ?";
  db.run(sql, [estado, incidenciaId], function(err) {
    callback(err);
  });
}

function updateConfirmaciones(incidenciaId, confirmaciones, callback) {
  const sql = "UPDATE incidencias SET confirmaciones = ? WHERE id = ?";
  db.run(sql, [confirmaciones, incidenciaId], function(err) {
    callback(err);
  });
}

module.exports = {
  initDB,
  getDB,
  insertarIncidencia,
  buscarIncidenciaPorUniqueIdAsync,
  buscarIncidenciaPorOriginalMsgIdAsync,
  getIncidenciaById,
  getIncidenciasByCategory,
  getIncidenciasByDate,
  getIncidenciasByRange,
  updateIncidenciaStatus,
  updateConfirmaciones
};
