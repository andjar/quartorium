'use strict';
const path = require('path');

const dataDir = path.resolve(process.env.QUARTORIUM_DATA || path.join(__dirname, '..', 'data'));

module.exports = {
  port: Number(process.env.PORT || 8000),
  dataDir,
  /** Password for the admin pages (projects and review rounds). Required in production. */
  adminPassword: process.env.QUARTORIUM_ADMIN_PASSWORD || '',
  /** Secret used to sign the admin session cookie. */
  secret: process.env.QUARTORIUM_SECRET || '',
  quarto: process.env.QUARTORIUM_QUARTO || 'quarto',
  /** Optional explicit pandoc command, e.g. "pandoc" or "/usr/bin/pandoc". Defaults to `quarto pandoc`. */
  pandoc: process.env.QUARTORIUM_PANDOC || '',
  /** Identity used as committer for every commit Quartorium writes. */
  committerName: process.env.QUARTORIUM_COMMITTER_NAME || 'Quartorium',
  committerEmail: process.env.QUARTORIUM_COMMITTER_EMAIL || 'quartorium@localhost',
  /** Seconds a draft must be idle before it is committed. */
  commitIdleSeconds: Number(process.env.QUARTORIUM_COMMIT_IDLE || 60),
  /** Set to "0" to never push to the remote (useful for trying things out). */
  push: process.env.QUARTORIUM_PUSH !== '0',
  renderTimeoutMs: Number(process.env.QUARTORIUM_RENDER_TIMEOUT || 15 * 60) * 1000,
};
