// config/exportCsv.js
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

/**
 * exportCSV - Exporta las incidencias de la BD a un archivo CSV,
 * excluyendo campos no relevantes y formateando feedbackHistory y confirmaciones para facilitar su lectura.
 * El archivo se genera en /data/incidencias_export.csv.
 * 
 * @returns {Promise<string>} - Promesa que se resuelve con la ruta del archivo generado.
 */
function exportCSV() {
  return new Promise((resolve, reject) => {
    // Ruta a la base de datos (desde /config, subimos a /data)
    const dbPath = path.join(__dirname, '../data/incidencias.db');
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error("Error al abrir la base de datos:", err);
        return reject(err);
      } else {
        console.log("Base de datos abierta correctamente.");
      }
    });

    // Seleccionamos solo las columnas importantes
    const sql = `SELECT id, descripcion, reportadoPor, fechaCreacion, estado, categoria, confirmaciones, feedbackHistory, media, fechaCancelacion
                 FROM incidencias`;
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
      
      // Definir los headers para el CSV (excluyendo campos no relevantes)
      const headers = ['ID', 'Descripcion', 'ReportadoPor', 'FechaCreacion', 'Estado', 'Categoria', 'Confirmaciones', 'FeedbackHistory', 'Media', 'FechaCancelacion'].join(',') + '\n';
      
      // Procesamos cada fila y formateamos confirmaciones y feedbackHistory
      const csvRows = rows.map(row => {
        // Formatear feedbackHistory para que sea legible
        let feedbackFormatted = "";
        if (row.feedbackHistory) {
          try {
            const feedbackArray = JSON.parse(row.feedbackHistory);
            if (Array.isArray(feedbackArray) && feedbackArray.length > 0) {
              feedbackFormatted = feedbackArray.map(fb => {
                // Se formatea cada entrada de feedback
                return `Equipo: ${fb.equipo || ''} - Comentario: ${fb.comentario || ''} - Fecha: ${fb.fecha || ''}`;
              }).join(" | ");
            } else {
              feedbackFormatted = row.feedbackHistory;
            }
          } catch (e) {
            feedbackFormatted = row.feedbackHistory;
          }
        }
        
        // Formatear confirmaciones de forma legible:
        let confirmacionesFormatted = "";
        if (row.confirmaciones) {
          try {
            const conf = JSON.parse(row.confirmaciones);
            if (conf && typeof conf === 'object') {
              confirmacionesFormatted = Object.entries(conf)
                .map(([key, val]) => {
                  // Si se puede interpretar como fecha, se formatea
                  let formattedVal = val;
                  if (val && !isNaN(Date.parse(val))) {
                    formattedVal = new Date(val).toLocaleString();
                  }
                  return `${key.toUpperCase()}: ${formattedVal}`;
                })
                .join(" | ");
            } else {
              confirmacionesFormatted = row.confirmaciones;
            }
          } catch (e) {
            confirmacionesFormatted = row.confirmaciones;
          }
        }
        
        // Valores a exportar en el orden deseado
        const values = [
          row.id,
          row.descripcion,
          row.reportadoPor,
          row.fechaCreacion,
          row.estado,
          row.categoria,
          confirmacionesFormatted,
          feedbackFormatted,
          row.media,
          row.fechaCancelacion
        ];
        
        // Escapar los valores que puedan contener comas, saltos de línea o comillas
        const formattedValues = values.map(value => {
          if (value === null || value === undefined) return '';
          let strValue = value.toString().replace(/"/g, '""');
          if (strValue.search(/("|,|\n)/g) >= 0) {
            strValue = `"${strValue}"`;
          }
          return strValue;
        });
        
        return formattedValues.join(',');
      }).join('\n');
      
      const csvContent = headers + csvRows;
      const outputPath = path.join(__dirname, '../data/incidencias_export.csv');
      
      fs.writeFile(outputPath, csvContent, 'utf8', (err) => {
        if (err) {
          console.error("Error al escribir el archivo CSV:", err);
          db.close();
          return reject(err);
        } else {
          console.log("Archivo CSV generado correctamente en:", outputPath);
          db.close();
          return resolve(outputPath);
        }
      });
    });
  });
}

module.exports = { exportCSV };

if (require.main === module) {
  exportCSV()
    .then(() => console.log("Reporte generado."))
    .catch(err => console.error("Error:", err));
}

//nuevo