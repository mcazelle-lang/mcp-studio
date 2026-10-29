// Persistance très simple sur disque : un fichier JSON par collection + un dossier de fichiers audio.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.MPC_DATA_DIR || path.join(__dirname, 'data');
const SAMPLES_DIR = path.join(DATA_DIR, 'samples');

fs.mkdirSync(SAMPLES_DIR, { recursive: true });

function readJson(name, fallback) {
  const file = path.join(DATA_DIR, `${name}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  const file = path.join(DATA_DIR, `${name}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { DATA_DIR, SAMPLES_DIR, readJson, writeJson };
