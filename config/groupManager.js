// config/groupManager.js
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../data/groups.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { main: null, destinations: {} };
  }
}

function save(cfg) {
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
}

function getMainGroup() {
  return load().main;
}

function setMainGroup(groupId) {
  const cfg = load();
  cfg.main = groupId;
  save(cfg);
}

function getDestinations(category) {
  const dest = load().destinations;
  return category ? (dest[category]||[]) : dest;
}

function addDestination(category, groupId) {
  const cfg = load();
  cfg.destinations[category] = cfg.destinations[category] || [];
  if (!cfg.destinations[category].includes(groupId)) {
    cfg.destinations[category].push(groupId);
    save(cfg);
    return true;
  }
  return false;
}

function removeDestination(category, groupId) {
  const cfg = load();
  const arr = cfg.destinations[category] || [];
  const idx = arr.indexOf(groupId);
  if (idx !== -1) {
    arr.splice(idx,1);
    save(cfg);
    return true;
  }
  return false;
}

module.exports = {
  getMainGroup,
  setMainGroup,
  getDestinations,
  addDestination,
  removeDestination
};
