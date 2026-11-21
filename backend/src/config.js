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
  /** Seconds without typing after which a draft is committed (leaving the page commits at once). */
  commitIdleSeconds: Number(process.env.QUARTORIUM_COMMIT_IDLE || 600),
  /** How often (seconds) open rounds check the main branch for new commits and catch up. */
  syncSeconds: Number(process.env.QUARTORIUM_SYNC || 60),
  /** Address people use to reach this server, for links in e-mails (e.g. https://review.example.org). */
  publicUrl: (process.env.QUARTORIUM_PUBLIC_URL || '').replace(/\/$/, ''),
  /** Optional mail server, e.g. smtp://user:pass@smtp.example.org:587. Unset: no e-mails are sent. */
  smtpUrl: process.env.QUARTORIUM_SMTP_URL || '',
  mailFrom: process.env.QUARTORIUM_MAIL_FROM || 'Quartorium <quartorium@localhost>',
  /** Set to "0" to never push to the remote (useful for trying things out). */
  push: process.env.QUARTORIUM_PUSH !== '0',
  renderTimeoutMs: Number(process.env.QUARTORIUM_RENDER_TIMEOUT || 15 * 60) * 1000,
};
