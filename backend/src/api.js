'use strict';
const express = require('express');
const { redactUrl } = require('./git');

/** All HTTP routes. `app` is the Quartorium service, `auth` the admin auth helper. */
function routes(app, auth) {
  const r = express.Router();
  r.use(express.json({ limit: '10mb' }));

  // ---------------------------------------------------------------- admin
  r.post('/admin/login', auth.login);
  r.post('/admin/logout', auth.logout);
  r.get('/admin/session', (req, res) => res.json({ admin: auth.isAdmin(req) }));

  const admin = auth.require;
  r.get('/projects', admin, (req, res) => res.json(app.listProjects().map((p) => ({ ...p, remote_url: redactUrl(p.remote_url) }))));
  r.post('/projects', admin, async (req, res) => {
    const p = await app.createProject(req.body || {});
    res.status(201).json({ id: p.id });
  });
  r.delete('/projects/:id', admin, (req, res) => { app.deleteProject(Number(req.params.id)); res.json({ ok: true }); });
  r.get('/projects/:id/files', admin, async (req, res) => res.json(await app.listFiles(Number(req.params.id))));
  r.post('/projects/:id/rounds', admin, async (req, res) => {
    const { round, lead } = await app.createRound(Number(req.params.id), req.body || {});
    res.status(201).json({ roundId: round.id, leadToken: lead.token });
  });
  r.get('/rounds/:id', admin, (req, res) => res.json(app.adminRound(Number(req.params.id))));

  // ---------------------------------------------------------------- personal links
  const link = express.Router({ mergeParams: true });
  link.use((req, res, next) => { req.ctx = app.context(req.params.token); next(); });
  link.get('/', async (req, res) => res.json(await app.load(req.ctx)));
  link.get('/activity', async (req, res) => res.json(await app.activity(req.ctx, { renderKey: req.query.renderKey })));
  link.put('/doc', async (req, res) => res.json(await app.save(req.ctx, req.body || {})));
  link.post('/comments', async (req, res) => res.status(201).json(await app.addComment(req.ctx, req.body || {})));
  link.post('/comments/:cid/replies', async (req, res) => res.json(await app.reply(req.ctx, req.params.cid, req.body?.text)));
  link.post('/comments/:cid/resolve', async (req, res) => res.json(await app.resolve(req.ctx, req.params.cid, req.body?.resolved !== false)));
  link.post('/comments/:cid/agree', async (req, res) => res.json(await app.agree(req.ctx, req.params.cid)));
  link.post('/changes/:id/accept', async (req, res) => { await app.accept(req.ctx, req.params.id); res.json({ ok: true }); });
  link.post('/changes/:id/reject', async (req, res) => { await app.reject(req.ctx, req.params.id); res.json({ ok: true }); });
  link.post('/people', async (req, res) => {
    if (req.ctx.member.role !== 'lead') return res.status(403).json({ error: 'Only the lead can invite people.' });
    const m = await app.addMember(req.ctx.round, { name: req.body?.name, email: req.body?.email, role: req.body?.role || 'reviewer' });
    res.status(201).json({ id: m.id, name: m.name, role: m.role, token: m.token });
  });
  link.delete('/people/:id', async (req, res) => {
    if (req.ctx.member.role !== 'lead') return res.status(403).json({ error: 'Only the lead can remove people.' });
    await app.removeMember(req.ctx.round, Number(req.params.id));
    res.json({ ok: true });
  });
  link.post('/sync', async (req, res) => res.json(await app.sync(req.ctx)));
  link.post('/render', async (req, res) => res.json(await app.renderInfo(app.round(req.ctx.round.id), { force: true })));
  link.get('/history', async (req, res) => res.json(await app.history(req.ctx)));
  r.use('/r/:token', link);

  // ---------------------------------------------------------------- rendered assets
  r.get('/render/:key/*path', (req, res) => {
    const rel = [].concat(req.params.path).join('/');
    const file = app.renderer.assetPath(req.params.key, rel);
    if (!file) return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(file);
  });

  r.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 && !err.expose ? `Something went wrong: ${err.message}` : err.message, ...(err.reload ? { reload: true } : {}) });
  });
  return r;
}

module.exports = { routes };
