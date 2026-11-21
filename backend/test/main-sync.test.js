'use strict';
// The lead also works on the paper in RStudio during a round: pull main, change
// code, add a figure, edit text, push. Quartorium must take that in, and keep
// main up to date with what was accepted in the round.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { createServer } = require('../src/server');
const { extractMeta } = require('../src/qmd/meta');
const { tmpdir, makeRemote, authorPush } = require('./helpers');

config.adminPassword = 'pw';
config.commitIdleSeconds = 0;
config.quarto = 'quartorium-test-no-quarto';

const PAPER = `---
title: Sync paper
---

## Introduction

First paragraph.

Second paragraph, which Anna will edit.

Third paragraph, which Anna comments on.

\`\`\`{r}
#| label: fig-x
plot(1:10)
\`\`\`

Closing paragraph.
`;

function client(base) {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
  };
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b) };
}

const paragraphs = (doc) => doc.content.filter((n) => n.type === 'paragraph').map((n) => (n.content || []).map((c) => c.text || '').join(''));
function edit(doc, starts, text) {
  const d = JSON.parse(JSON.stringify(doc));
  const n = d.content.find((x) => x.type === 'paragraph' && (x.content || []).map((c) => c.text || '').join('').startsWith(starts));
  n.content = [{ type: 'text', text }];
  return d;
}

/** A round where Anna's change was accepted and Anna left a comment. Main has not moved yet. */
async function setup(t) {
  const remote = makeRemote({ 'paper.qmd': PAPER });
  const { web, app, store } = createServer({ dataDir: tmpdir() });
  const server = web.listen(0);
  t.after(() => { server.closeAllConnections(); server.close(); store.close(); });
  const http = client(`http://localhost:${server.address().port}/api`);
  await http.post('/admin/login', { password: 'pw' });
  const proj = await http.post('/projects', { name: 'P', remoteUrl: remote.remote });
  const created = await http.post(`/projects/${proj.data.id}/rounds`, { docPath: 'paper.qmd', leadName: 'Lena' });
  const L = `/r/${created.data.leadToken}`;
  const A = `/r/${(await http.post(`${L}/people`, { name: 'Anna' })).data.token}`;
  const ad = (await http.get(A)).data;
  await http.put(`${A}/doc`, { doc: edit(ad.doc, 'Second', 'Second paragraph, rewritten by Anna.'), rev: ad.rev });
  const changes = (await http.get(L)).data.changes;
  assert.equal((await http.post(`${L}/changes/${changes[0].id}/accept`)).status, 200);
  assert.equal((await http.post(`${A}/comments`, { anchor: { quote: 'Anna comments on', prefix: 'which ', suffix: '.' }, text: 'Is this needed?' })).status, 201);
  await app.flush({ force: true });
  return { remote, http, app, L, A };
}

const remoteFile = (remote, file = 'paper.qmd') => {
  remote.sh('pull', '--quiet', 'origin', 'main');
  return fs.readFileSync(path.join(remote.work, file), 'utf8');
};

test('accepted text reaches main, and the lead\'s RStudio work comes into the round', async (t) => {
  const { remote, http, app, L } = await setup(t);

  // Main is kept up to date: a sync puts the round on main (a fast-forward).
  const first = await http.post(`${L}/sync`);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.published, true);
  let onMain = remoteFile(remote);
  assert.match(onMain, /rewritten by Anna/);
  assert.match(onMain, /Is this needed\?/, 'comments travel to main, invisibly');
  assert.match(remote.sh('log', '-1', '--format=%s', 'origin/main'), /^Comment by Anna/, 'main fast-forwarded to the round');

  // Lena works in RStudio: changes code, adds a figure, edits the last and the first paragraph.
  authorPush(remote, {
    'paper.qmd': remoteFile(remote).replace('plot(1:10)', 'plot(1:20)').replace('Closing paragraph.', 'Closing paragraph, extended in RStudio.')
      .replace('First paragraph.', 'First paragraph, edited in RStudio.'),
    'figures/new.png': 'png',
  }, 'Lena works in RStudio');

  // Meanwhile something happens in the round: Lena resolves Anna's comment in the browser.
  const lv = (await http.get(L)).data;
  assert.equal((await http.post(`${L}/comments/${lv.comments[0].id}/resolve`)).status, 200);

  // The periodic check picks up the push without anyone clicking.
  config.syncSeconds = 0;
  t.after(() => { config.syncSeconds = 60; });
  await app.flush();
  config.syncSeconds = 60;

  const after = (await http.get(L)).data;
  assert.deepEqual(paragraphs(after.doc), [
    'First paragraph, edited in RStudio.', 'Second paragraph, rewritten by Anna.', 'Third paragraph, which Anna comments on.', 'Closing paragraph, extended in RStudio.',
  ]);
  const chunk = after.doc.content.find((n) => n.type === 'locked' && n.attrs.kind === 'chunk');
  assert.match(chunk.attrs.source, /plot\(1:20\)/);
  assert.equal(after.comments[0].resolved, true, 'the round kept its own comment change');
  assert.deepEqual(after.sinceLastVisit.changes.map((c) => [c.by, c.new[0]?.text]), [
    ['Author (on main)', 'First paragraph, edited in RStudio.'], ['Author (on main)', '[Code chunk: fig-x]'], ['Author (on main)', 'Closing paragraph, extended in RStudio.'],
  ], 'changes from main are credited to whoever pushed them');

  // ...and main has everything, so the next `git pull` in RStudio brings it.
  await app.flush({ force: true });
  onMain = remoteFile(remote);
  assert.match(onMain, /First paragraph, edited in RStudio\./);
  assert.match(onMain, /rewritten by Anna/);
  assert.match(onMain, /"resolved": true/);
  assert.ok(fs.existsSync(path.join(remote.work, 'figures/new.png')));
  assert.equal(extractMeta(onMain).meta.comments.length, 1);
});

test('the same paragraph changed in RStudio and in the round: main wins, the other version becomes a comment', async (t) => {
  const { remote, http, L, A } = await setup(t);
  // Lena pulled before Anna's change was accepted, and rewrote the same paragraph.
  authorPush(remote, { 'paper.qmd': PAPER.replace('Second paragraph, which Anna will edit.', 'Second paragraph, as Lena wrote it in RStudio.') }, 'Lena works in RStudio');

  const r = await http.post(`${L}/sync`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.conflicts, 1);

  const lv = (await http.get(L)).data;
  assert.ok(paragraphs(lv.doc).includes('Second paragraph, as Lena wrote it in RStudio.'));
  const note = lv.comments.find((c) => c.author === 'Quartorium');
  assert.ok(note, 'a comment keeps the other version');
  assert.equal(note.anchor.quote, 'Second paragraph, as Lena wrote it in RStudio.');
  assert.match(note.thread[0].text, /rewritten by Anna/);
  assert.equal(lv.notices[0].type, 'main-conflict');

  // Anna sees the paragraph as it is now, with no stale suggestion.
  const av = (await http.get(A)).data;
  assert.ok(paragraphs(av.doc).includes('Second paragraph, as Lena wrote it in RStudio.'));
  assert.equal(av.changes.length, 0);
  assert.match(remoteFile(remote), /as Lena wrote it in RStudio[\s\S]*Quartorium version was/);
});

test('a protected main turns automatic updates off and says how to merge', async (t) => {
  const { remote, http, L } = await setup(t);
  const hook = path.join(remote.remote, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do [ "$ref" = refs/heads/main ] && { echo "main is protected" >&2; exit 1; }; done\nexit 0\n', { mode: 0o755 });

  const r = await http.post(`${L}/sync`);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /did not accept updates to main/);
  const view = (await http.get(L)).data.round;
  assert.equal(view.keepMain, false);
  assert.match(view.mainError, /pull\/merge request/);

  // Picking up the lead's pushes still works; main is no longer touched.
  fs.rmSync(hook);
  authorPush(remote, { 'paper.qmd': PAPER.replace('Closing paragraph.', 'Closing, from RStudio.') }, 'Lena works in RStudio');
  const s = await http.post(`${L}/sync`);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.deepEqual([s.data.pulled, s.data.published], [true, false]);
  assert.doesNotMatch(remoteFile(remote), /rewritten by Anna/);

  // Turning it back on puts the round on main again.
  assert.equal((await http.post(`${L}/round/keep-main`, { on: true })).status, 200);
  const again = await http.post(`${L}/sync`);
  assert.equal(again.data.published, true);
  assert.match(remoteFile(remote), /rewritten by Anna[\s\S]*Closing, from RStudio/);
});

test('a repository URL with a trailing slash works and names the project', async (t) => {
  const remote = makeRemote({ 'paper.qmd': PAPER });
  const { web, store } = createServer({ dataDir: tmpdir() });
  const server = web.listen(0);
  t.after(() => { server.closeAllConnections(); server.close(); store.close(); });
  const http = client(`http://localhost:${server.address().port}/api`);
  await http.post('/admin/login', { password: 'pw' });
  const proj = await http.post('/projects', { remoteUrl: `${remote.remote}/ ` });
  assert.equal(proj.status, 201, JSON.stringify(proj.data));
  assert.equal((await http.get('/projects')).data[0].name, 'remote');
  assert.deepEqual((await http.get(`/projects/${proj.data.id}/files`)).data, ['paper.qmd']);
});
