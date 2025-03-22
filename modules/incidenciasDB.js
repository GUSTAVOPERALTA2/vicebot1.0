// modules/incidenciasDB.js
const sqlite3 = require('sqlite3').verbose();
let db;

function initDB() {
  db = new sqlite3.Database('./incidencias.db', (err) => {
    if (err) {
      console.error("Error al abrir la BD:", err);
    } else {
      console.log("Base de datos iniciada.");
      db.run(`CREATE TABLE IF NOT EXISTS incidencias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    (descripcion, reportadoPor, fechaCreacion, estado, categoria, confirmaciones, grupoOrigen, media) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(sql, [
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

function updateIncidenciaStatus(incidenciaId, estado, callback) {
  const sql = `UPDATE incidencias SET estado = ? WHERE id = ?`;
  db.run(sql, [estado, incidenciaId], function(err) {
    callback(err);
  });
}

function updateConfirmaciones(incidenciaId, confirmaciones, callback) {
  const sql = `UPDATE incidencias SET confirmaciones = ? WHERE id = ?`;
  db.run(sql, [confirmaciones, incidenciaId], function(err) {
    callback(err);
  });
}

function getIncidenciaById(incidenciaId, callback) {
  const sql = `SELECT * FROM incidencias WHERE id = ?`;
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
  // Se asume que 'date' viene en formato "YYYY-MM-DD"
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

module.exports = {
  initDB,
  getDB,
  insertarIncidencia,
  updateIncidenciaStatus,
  updateConfirmaciones,
  getIncidenciaById,
  getIncidenciasByCategory,
  getIncidenciasByDate,
  getIncidenciasByRange
};

//Funcional1
