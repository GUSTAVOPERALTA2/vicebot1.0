const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

function exportCSV() {
  return new Promise((resolve, reject) => {
    // Ajusta la ruta a la base de datos. Al estar en /config, subimos un nivel para llegar a /data.
    const dbPath = path.join(__dirname, '../data/incidencias.db');
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error("Error al abrir la base de datos:", err);
        return reject(err);
      } else {
        console.log("Base de datos abierta correctamente.");
      }
    });

    // Consulta para obtener todas las incidencias
    const sql = 'SELECT * FROM incidencias';
    db.all(sql, (err, rows) => {
      if (err) {
        console.error("Error al leer la base de datos:", err);
        db.close();
        return reject(err);
      }
      
      if (!rows || rows.length === 0) {
        console.log("No se encontraron registros en la base de datos.");
        db.close();
        return reject(new Error("No hay incidencias"));
      }
      
      // Construir la cabecera del CSV a partir de las claves del primer registro
      const headers = Object.keys(rows[0]).join(',') + '\n';
      
      // Construir las filas del CSV
      const csvRows = rows.map(row => {
        return Object.values(row).map(value => {
          if (value === null) return '';
          let strValue = value.toString().replace(/"/g, '""'); // Escapar comillas dobles
          // Si el valor contiene coma, salto de línea o comillas, se envuelve entre comillas
          if (strValue.search(/("|,|\n)/g) >= 0) {
            strValue = `"${strValue}"`;
          }
          return strValue;
        }).join(',');
      }).join('\n');
      
      const csvContent = headers + csvRows;
      
      // Ruta de salida del archivo CSV. Ajustamos la ruta para estar en /data.
      const outputPath = path.join(__dirname, '../data/incidencias_export.csv');
      
      fs.writeFile(outputPath, csvContent, 'utf8', (err) => {
        if (err) {
          console.error("Error al escribir el archivo CSV:", err);
          db.close();
          return reject(err);
        } else {
          console.log("Archivo CSV generado correctamente en:", outputPath);
          db.close();
          return resolve();
        }
      });
    });
  });
}

module.exports = { exportCSV };

// Si se ejecuta directamente, se ejecuta la función exportCSV.
if (require.main === module) {
  exportCSV()
    .then(() => console.log("Reporte generado."))
    .catch(err => console.error("Error:", err));
}


//generar reporte