// modules/userManager.js
const fs = require('fs');
const path = require('path');

const usersFile = path.join(__dirname, 'users.json');

function loadUsers() {
  try {
    const data = fs.readFileSync(usersFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading users:", error);
    return {};  // Retorna un objeto vacío si no existe o hay error
  }
}

function saveUsers(users) {
  try {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf8');
    console.log("Users saved successfully.");
    return true;
  } catch (error) {
    console.error("Error saving users:", error);
    return false;
  }
}

/**
 * Registra un usuario con sus datos: id, nombre, cargo y rol.
 * Formato del comando: 
 *   /registerUser <id> | <nombre-apellido> | <cargo> | <rol>
 */
function registerUser(id, nombre, cargo, rol) {
  let users = loadUsers();
  users[id] = { nombre, cargo, rol };
  return saveUsers(users);
}

/**
 * Obtiene la información del usuario registrado según su ID.
 */
function getUser(id) {
  let users = loadUsers();
  return users[id] || null;
}

module.exports = {
  registerUser,
  getUser,
  loadUsers,
  saveUsers
};
