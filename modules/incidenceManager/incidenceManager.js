const fs = require('fs');
const path = require('path');

const incidenciasFile = path.join(__dirname, 'incidencias.json');

function loadIncidencias() {
  try {
    const data = fs.readFileSync(incidenciasFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading incidencias:", err);
    return [];
  }
}

function saveIncidencias(incidencias) {
  try {
    fs.writeFileSync(incidenciasFile, JSON.stringify(incidencias, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error("Error saving incidencias:", err);
    return false;
  }
}

function getIncidenciasByCategory(categoria, callback) {
  const incidencias = loadIncidencias();
  const filtradas = incidencias.filter(inc => inc.categoria === categoria);
  callback(null, filtradas);
}

function formatIncidenciasSummary(incidencias) {
  if (!incidencias.length) {
    return "No hay incidencias registradas en esta categoría.";
  }
  let message = "Resumen de Incidencias:\n";
  let total = incidencias.length;
  let completadas = incidencias.filter(inc => inc.estado === "completada").length;
  let pendientes = incidencias.filter(inc => inc.estado !== "completada").length;
  message += `Total: ${total} - Completadas: ${completadas} - Pendientes: ${pendientes}\n\n`;
  incidencias.forEach(inc => {
    message += `ID: ${inc.id} | Estado: ${inc.estado} | Descripción: ${inc.descripcion}\n`;
  });
  return message;
}

module.exports = {
  loadIncidencias,
  saveIncidencias,
  getIncidenciasByCategory,
  formatIncidenciasSummary
};
