// config/exportCsv.js
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

/**
 * exportCSV - Exporta las incidencias de la BD a un archivo CSV.
 * Se seleccionan únicamente las columnas relevantes (excluyendo uniqueMessageId, originalMsgId y grupoOrigen)
 * y se formatean los campos confirmaciones y feedbackHistory para que sean legibles.
 * El archivo se genera en /data/incidencias_export.csv.
 * 
 * @returns {Promise<string>} - Una promesa que se resuelve con la ruta del archivo generado.
 */
function exportCSV() {
  return new Promise((resolve, reject) => {
    // Ruta a la base de datos (desde /config subimos un nivel a /data)
    const dbPath = path.join(__dirname, '../data/incidencias.db');
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error("Error al abrir la base de datos:", err);
        return reject(err);
      } else {
        console.log("Base de datos abierta correctamente.");
      }
    });

    // Consulta: Seleccionamos solo las columnas importantes
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
      
      // Definir headers para el CSV (en orden deseado)
      const headers = ['ID', 'Descripcion', 'ReportadoPor', 'FechaCreacion', 'Estado', 'Categoria', 'Confirmaciones', 'FeedbackHistory', 'Media', 'FechaCancelacion'].join(',') + '\n';
      
      // Procesar cada fila y formatear confirmaciones y feedbackHistory
      const csvRows = rows.map(row => {
        // Formatear feedbackHistory para que cada registro aparezca en una nueva línea
        let feedbackFormatted = "";
        if (row.feedbackHistory) {
          try {
            const feedbackArray = JSON.parse(row.feedbackHistory);
            if (Array.isArray(feedbackArray) && feedbackArray.length > 0) {
              feedbackFormatted = feedbackArray.map(fb => {
                return `Equipo: ${fb.equipo || ''} - Comentario: ${fb.comentario || ''} - Fecha: ${fb.fecha || ''}`;
              }).join("\n");  // Saltos de línea para cada registro
            } else {
              feedbackFormatted = row.feedbackHistory;
            }
          } catch (e) {
            feedbackFormatted = row.feedbackHistory;
          }
        }
        
        // Formatear confirmaciones de forma legible, separando cada entrada en una línea
        let confirmacionesFormatted = "";
        if (row.confirmaciones) {
          try {
            const conf = JSON.parse(row.confirmaciones);
            if (conf && typeof conf === 'object') {
              confirmacionesFormatted = Object.entries(conf)
                .map(([key, val]) => {
                  let formattedVal = val;
                  if (val && !isNaN(Date.parse(val))) {
                    formattedVal = new Date(val).toLocaleString();
                  }
                  return `${key.toUpperCase()}: ${formattedVal}`;
                })
                .join("\n");
            } else {
              confirmacionesFormatted = row.confirmaciones;
            }
          } catch (e) {
            confirmacionesFormatted = row.confirmaciones;
          }
        }
        
        // Valores a exportar en el orden definido
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
        
        // Escapar valores que puedan contener comas, saltos de línea o comillas dobles
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
      // Ruta de salida: /data/incidencias_export.csv (desde /config, subimos un nivel a /data)
      const outputPath = path.join(__dirname, '../data/reports/incidencias_export.csv');
      
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
    .then((outputPath) => console.log("Reporte generado en:", outputPath))
    .catch(err => console.error("Error:", err));
}
