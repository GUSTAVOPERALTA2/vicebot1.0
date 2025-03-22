// modules/config.js
const path = require('path');

module.exports = {
  // IDs de grupos generales (otros usos)
  groupPruebaId: "120363389868056953@g.us",
  groupBotDestinoId: "120363408965534037@g.us",
  groupMantenimientoId: "120363393791264206@g.us",
  groupAmaId: "120363409776076000@g.us",
  
  // Mapeo de categorías a grupos destino para recordatorios automáticos.
  // Los recordatorios se enviarán a estos grupos según la categoría de la incidencia.
  destinoGrupos: {
    it: "120363408965534037@g.us",
    man: "120363393791264206@g.us",
    ama: "120363409776076000@g.us"
  },
  
  // Ruta al archivo de keywords
  keywordsFile: path.join(__dirname, 'keywords.json')
};
