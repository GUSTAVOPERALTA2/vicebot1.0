// config/stringUtils.js

/**
 * normalizeText: Normaliza el texto eliminando diacríticos, espacios extras y pasando a minúsculas.
 * Por ejemplo, "Telé" se convertirá en "tele".
 *
 * @param {string} text - El texto a normalizar.
 * @returns {string} - El texto normalizado.
 */
function normalizeText(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

/**
 * levenshteinDistance: Calcula la distancia de edición de Levenshtein entre dos cadenas.
 *
 * @param {string} a - La primera cadena.
 * @param {string} b - La segunda cadena.
 * @returns {number} - La distancia de Levenshtein entre ambas.
 */
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,      // Eliminación
          dp[i][j - 1] + 1,      // Inserción
          dp[i - 1][j - 1] + 1   // Sustitución
        );
      }
    }
  }
  return dp[m][n];
}

/**
 * similarity: Calcula el porcentaje de similitud entre dos cadenas utilizando la distancia de Levenshtein.
 * Se normalizan ambas cadenas antes de la comparación.
 *
 * @param {string} a - La primera cadena.
 * @param {string} b - La segunda cadena.
 * @returns {number} - Un número entre 0 y 1 representando la similitud (1 es idéntica).
 */
function similarity(a, b) {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  const distance = levenshteinDistance(normA, normB);
  const maxLen = Math.max(normA.length, normB.length);
  return maxLen === 0 ? 1 : 1 - (distance / maxLen);
}

// Definimos el umbral de similitud para considerar dos cadenas iguales
const SIMILARITY_THRESHOLD = 0.5;

module.exports = {
  normalizeText,
  levenshteinDistance,
  similarity,
  SIMILARITY_THRESHOLD
};

