'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const db = require('./db');
const { Quartorium } = require('./rounds');
const { adminAuth } = require('./auth');
const { routes } = require('./api');

function createServer({ dataDir = config.dataDir } = {}) {
  const store = db.open(dataDir);
  const app = new Quartorium({ db: store, dataDir });
  const auth = adminAuth(dataDir);
  const web = express();
  web.set('trust proxy', 'loopback');
  web.disable('x-powered-by');
  web.use('/api', routes(app, auth));

  // Serve the built frontend (npm run build) with client-side routing.
  const dist = path.join(__dirname, '..', '..', 'frontend', 'dist');
  if (fs.existsSync(dist)) {
    web.use(express.static(dist, { index: false }));
    web.get('/*path', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return { web, app, store };
}

if (require.main === module) {
  const { web, app, store } = createServer();
  if (!config.adminPassword) console.warn('QUARTORIUM_ADMIN_PASSWORD is not set: the admin pages are disabled (links keep working).');
  const timer = setInterval(() => app.flush().catch((e) => console.error('flush failed:', e.message)), 15000);
  const server = web.listen(config.port, () => console.log(`Quartorium listening on http://localhost:${config.port}`));
  const shutdown = async () => {
    clearInterval(timer);
    server.close();
    try { await app.flush({ force: true }); } catch (e) { console.error('final flush failed:', e.message); }
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createServer };
