'use strict';
// Two kinds of access, no third-party login:
//  - the admin (whoever runs the server) logs in with QUARTORIUM_ADMIN_PASSWORD
//    to connect repositories and start review rounds;
//  - everyone else uses their personal link (/r/<token>); the token is the key.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const COOKIE = 'qtm_admin';

function loadSecret(dataDir) {
  if (config.secret) return config.secret;
  const file = path.join(dataDir, 'secret');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* create below */ }
  fs.mkdirSync(dataDir, { recursive: true });
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

function adminAuth(dataDir) {
  const secret = loadSecret(dataDir);
  const sessionValue = () => crypto.createHmac('sha256', secret).update('admin|' + config.adminPassword).digest('base64url');
  const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

  const readCookie = (req) => {
    const header = req.headers.cookie || '';
    const m = header.split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
    return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
  };

  const isAdmin = (req) => {
    if (!config.adminPassword) return false;
    const v = readCookie(req);
    return Boolean(v) && crypto.timingSafeEqual(sha(v), sha(sessionValue()));
  };

  return {
    isAdmin,
    require(req, res, next) {
      if (isAdmin(req)) return next();
      res.status(401).json({ error: config.adminPassword ? 'Please log in.' : 'Set QUARTORIUM_ADMIN_PASSWORD on the server to enable the admin pages.' });
    },
    async login(req, res) {
      if (!config.adminPassword) return res.status(503).json({ error: 'Set QUARTORIUM_ADMIN_PASSWORD on the server to enable the admin pages.' });
      if (!crypto.timingSafeEqual(sha(req.body?.password || ''), sha(config.adminPassword))) {
        await new Promise((r) => setTimeout(r, 800)); // slow down guessing
        return res.status(401).json({ error: 'Wrong password.' });
      }
      const secure = req.secure ? '; Secure' : '';
      res.setHeader('Set-Cookie', `${COOKIE}=${sessionValue()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${secure}`);
      res.json({ ok: true });
    },
    logout(req, res) {
      res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
      res.json({ ok: true });
    },
  };
}

module.exports = { adminAuth };
