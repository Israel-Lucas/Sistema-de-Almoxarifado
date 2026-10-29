const normalize = (value) =>
  value.trim().toLocaleUpperCase("pt-BR").replace(/\s+/g, " ");
const unitCodeFromName = (value) =>
  normalize(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

module.exports = { normalize, unitCodeFromName };
