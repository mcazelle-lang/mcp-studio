const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { SAMPLES_DIR, readJson, writeJson } = require('./store');

const PORT = Number(process.env.PORT) || 3000;
const USE_HTTPS = process.argv.includes('--https') || process.env.HTTPS === '1';
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist', 'client', 'browser');
const MAX_SAMPLE_BYTES = 50 * 1024 * 1024;

const AUDIO_EXTENSIONS = {
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/ogg': '.ogg',
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
};

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------- Samples ----------

const upload = multer({
  storage: multer.diskStorage({
    destination: SAMPLES_DIR,
    filename: (req, file, cb) => {
      const mime = file.mimetype.split(';')[0];
      const ext = AUDIO_EXTENSIONS[mime] || path.extname(file.originalname).toLowerCase() || '.bin';
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_SAMPLE_BYTES },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('audio/') || /\.(wav|mp3|ogg|webm|m4a|aac|flac)$/i.test(file.originalname);
    cb(ok ? null : new Error('Format audio non supporté'), ok);
  },
});

const listSamples = () => readJson('samples', []);
const saveSamples = (samples) => writeJson('samples', samples);

app.get('/api/samples', (req, res) => {
  res.json(listSamples());
});

app.post('/api/samples', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  const sample = {
    id: path.parse(req.file.filename).name,
    name: String(req.body.name || path.parse(req.file.originalname).name || 'Sample').slice(0, 60),
    source: ['recording', 'import', 'synth', 'preset', 'take'].includes(req.body.source) ? req.body.source : 'import',
    file: req.file.filename,
    mimeType: req.file.mimetype,
    size: req.file.size,
    duration: Number(req.body.duration) || null,
    createdAt: new Date().toISOString(),
  };
  saveSamples([sample, ...listSamples()]);
  res.status(201).json(sample);
});

app.get('/api/samples/:id/audio', (req, res) => {
  const sample = listSamples().find((s) => s.id === req.params.id);
  if (!sample) return res.sendStatus(404);
  res.type(sample.mimeType);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(path.join(SAMPLES_DIR, sample.file));
});

app.patch('/api/samples/:id', (req, res) => {
  const samples = listSamples();
  const sample = samples.find((s) => s.id === req.params.id);
  if (!sample) return res.sendStatus(404);
  if (typeof req.body.name === 'string' && req.body.name.trim()) {
    sample.name = req.body.name.trim().slice(0, 60);
  }
  saveSamples(samples);
  res.json(sample);
});

app.delete('/api/samples/:id', (req, res) => {
  const samples = listSamples();
  const sample = samples.find((s) => s.id === req.params.id);
  if (!sample) return res.sendStatus(404);
  fs.rm(path.join(SAMPLES_DIR, sample.file), { force: true }, () => {});
  saveSamples(samples.filter((s) => s.id !== sample.id));

  // Libère les pads qui utilisaient ce sample.
  const kit = readJson('kit', null);
  if (kit?.pads) {
    kit.pads.forEach((pad) => {
      if (pad.sampleId === sample.id) pad.sampleId = null;
    });
    writeJson('kit', kit);
  }
  res.sendStatus(204);
});

// ---------- Kit (affectation des pads + réglages des potards) ----------

app.get('/api/kit', (req, res) => {
  res.json(readJson('kit', null));
});

app.put('/api/kit', (req, res) => {
  if (!req.body || !Array.isArray(req.body.pads)) {
    return res.status(400).json({ error: 'Kit invalide' });
  }
  writeJson('kit', req.body);
  res.json(req.body);
});

// ---------- Presets du synthé ----------

app.get('/api/presets', (req, res) => {
  res.json(readJson('presets', []));
});

app.post('/api/presets', (req, res) => {
  const { name, patch } = req.body || {};
  if (!name || typeof patch !== 'object') return res.status(400).json({ error: 'Preset invalide' });
  const preset = { id: crypto.randomUUID(), name: String(name).slice(0, 40), patch, createdAt: new Date().toISOString() };
  writeJson('presets', [...readJson('presets', []), preset]);
  res.status(201).json(preset);
});

app.delete('/api/presets/:id', (req, res) => {
  writeJson('presets', readJson('presets', []).filter((p) => p.id !== req.params.id));
  res.sendStatus(204);
});

// ---------- Prises enregistrées au clavier (notes + son utilisé) ----------

const MAX_TAKE_NOTES = 5000;

app.get('/api/takes', (req, res) => {
  res.json(readJson('takes', []));
});

app.post('/api/takes', (req, res) => {
  const { name, bpm, beatsPerBar, bars, length, sound, notes } = req.body || {};
  if (!Array.isArray(notes) || notes.length > MAX_TAKE_NOTES || typeof sound !== 'object' || !(length > 0)) {
    return res.status(400).json({ error: 'Prise invalide' });
  }
  const take = {
    id: crypto.randomUUID(),
    name: String(name || 'Prise').slice(0, 60),
    createdAt: new Date().toISOString(),
    bpm: Number(bpm) || 120,
    beatsPerBar: Number(beatsPerBar) || 4,
    bars: Number(bars) || 1,
    length: Number(length),
    sound,
    notes,
  };
  writeJson('takes', [take, ...readJson('takes', [])]);
  res.status(201).json(take);
});

app.patch('/api/takes/:id', (req, res) => {
  const takes = readJson('takes', []);
  const take = takes.find((t) => t.id === req.params.id);
  if (!take) return res.sendStatus(404);
  if (typeof req.body.name === 'string' && req.body.name.trim()) take.name = req.body.name.trim().slice(0, 60);
  writeJson('takes', takes);
  res.json(take);
});

app.delete('/api/takes/:id', (req, res) => {
  writeJson('takes', readJson('takes', []).filter((t) => t.id !== req.params.id));
  res.sendStatus(204);
});

// ---------- Client Angular compilé ----------

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

app.use((err, req, res, next) => {
  const status = err instanceof multer.MulterError ? 413 : 400;
  res.status(status).json({ error: err.message });
});

// ---------- Démarrage ----------

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

function createServer() {
  if (!USE_HTTPS) return require('http').createServer(app);
  // Le micro (getUserMedia) n'est accessible sur mobile qu'en HTTPS :
  // on génère un certificat auto-signé pour les tests sur le réseau local.
  let pems = readJson('cert', null);
  if (!pems) {
    pems = require('selfsigned').generate([{ name: 'commonName', value: 'mpc.local' }], { days: 825, keySize: 2048 });
    writeJson('cert', { private: pems.private, cert: pems.cert });
  }
  return require('https').createServer({ key: pems.private, cert: pems.cert }, app);
}

createServer().listen(PORT, '0.0.0.0', () => {
  const scheme = USE_HTTPS ? 'https' : 'http';
  console.log(`MPC server prêt : ${scheme}://localhost:${PORT}`);
  lanAddresses().forEach((ip) => console.log(`  sur le réseau local : ${scheme}://${ip}:${PORT}`));
  if (!fs.existsSync(CLIENT_DIST)) console.log('  (client non compilé : lancez "npm run build" à la racine, ou "npm run dev")');
});
