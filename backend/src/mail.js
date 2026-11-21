'use strict';
// Optional e-mail. Without QUARTORIUM_SMTP_URL nothing is sent and the browser
// offers "open in your mail program" links instead.

const nodemailer = require('nodemailer');
const config = require('./config');

let transport = null;
const outbox = []; // filled when QUARTORIUM_SMTP_URL=json (tests)

const enabled = () => Boolean(config.smtpUrl);

function getTransport() {
  if (!transport) {
    transport = config.smtpUrl === 'json' ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport(config.smtpUrl);
  }
  return transport;
}

async function send({ to, subject, text }) {
  if (!enabled() || !to) return false;
  const info = await getTransport().sendMail({ from: config.mailFrom, to, subject, text });
  if (config.smtpUrl === 'json') outbox.push(JSON.parse(info.message));
  return true;
}

/** Fire-and-forget: a failing mail server must never break the request. */
function notify(message) {
  send(message).catch((e) => console.error('mail failed:', e.message));
}

const templates = {
  invite: ({ name, title, lead, link }) => ({
    subject: `Please review: ${title}`,
    text: `Hi ${name},\n\n${lead} has invited you to review "${title}".\n\nOpen your personal link to read the paper, edit the text and comment:\n${link}\n\nYour edits are saved automatically and shown to ${lead} as suggestions. No account or software is needed; please keep the link to yourself.\n`,
  }),
  newRound: ({ name, title, lead, link }) => ({
    subject: `New version to review: ${title}`,
    text: `Hi ${name},\n\n${lead} has started a new review round of "${title}". Your link is the same as before:\n${link}\n\nWhen you open it you will see what changed since your last visit.\n`,
  }),
  finished: ({ name, reviewer, title, note, link }) => ({
    subject: `${reviewer} finished reviewing "${title}"`,
    text: `Hi ${name},\n\n${reviewer} has finished their review of "${title}".${note ? `\n\nTheir note:\n${note}` : ''}\n\nOpen the round:\n${link}\n`,
  }),
};

module.exports = { enabled, send, notify, templates, outbox };
