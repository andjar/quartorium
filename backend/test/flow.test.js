'use strict';
// End-to-end: the whole review-round flow over HTTP, against a bare Git repo
// on disk standing in for Codeberg/GitLab/GitHub.
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { createServer } = require('../src/server');
const { tmpdir, makeRemote, authorPush, sh } = require('./helpers');

config.adminPassword = 'secret-pw';
config.commitIdleSeconds = 0;
config.quarto = 'quartorium-test-no-quarto'; // rendering is covered in render.test.js
config.smtpUrl = 'json'; // e-mails are collected in mail.outbox
const mail = require('../src/mail');

const PAPER = `---
title: Flow paper
bibliography: refs.bib
---

## Introduction

First paragraph stays as it is.

Second paragraph, which two people will edit.

Third paragraph with a citation [@doe2020].

\`\`\`{r}
#| label: fig-x
plot(1:10)
\`\`\`

Closing paragraph.
`;

function client(base) {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    return { status: res.status, data };
  };
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u) };
}

const texts = (doc) => doc.content.map((n) => (n.content || []).map((c) => c.text || c.attrs?.label || '').join(''));
function editParagraph(doc, startsWith, newText) {
  const d = JSON.parse(JSON.stringify(doc));
  const n = d.content.find((x) => x.type === 'paragraph' && (x.content || []).map((c) => c.text || '').join('').startsWith(startsWith));
  assert.ok(n, `paragraph "${startsWith}" not found`);
  n.content = [{ type: 'text', text: newText }];
  return d;
}

test('review round flow', async (t) => {
  const remote = makeRemote({
    'paper.qmd': PAPER, 'data.csv': 'x\n1\n',
    'refs.bib': '@article{doe2020, author = {Doe, Jane and Roe, Rick}, title = {On Things}, journal = {J}, year = {2020}}\n@book{lee2018, author = {Lee, Kim}, title = {Methods}, publisher = {P}, year = {2018}}\n',
  });
  const { web, app, store } = createServer({ dataDir: tmpdir() });
  const server = web.listen(0);
  t.after(() => { server.closeAllConnections(); server.close(); store.close(); });
  const base = `http://localhost:${server.address().port}/api`;
  const admin = client(base), anon = client(base);

  // --- admin: connect the repository and start a round
  assert.equal((await anon.get('/projects')).status, 401);
  assert.equal((await admin.post('/admin/login', { password: 'nope' })).status, 401);
  assert.equal((await admin.post('/admin/login', { password: 'secret-pw' })).status, 200);
  const proj = await admin.post('/projects', { name: 'Paper', remoteUrl: remote.remote });
  assert.equal(proj.status, 201, JSON.stringify(proj.data));
  assert.deepEqual((await admin.get(`/projects/${proj.data.id}/files`)).data, ['paper.qmd']);
  const created = await admin.post(`/projects/${proj.data.id}/rounds`, { docPath: 'paper.qmd', leadName: 'Lena Lead', leadEmail: 'lena@example.org' });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const L = `/r/${created.data.leadToken}`;

  // --- lead invites two co-authors
  const lead = await anon.get(L);
  assert.equal(lead.data.me.role, 'lead');
  assert.equal(lead.data.round.title, 'Flow paper');
  const anna = (await anon.post(`${L}/people`, { name: 'Anna', email: 'anna@example.org' })).data;
  const bob = (await anon.post(`${L}/people`, { name: 'Bob' })).data;
  const A = `/r/${anna.token}`, B = `/r/${bob.token}`;
  assert.equal((await anon.post(`${A}/people`, { name: 'Eve' })).status, 403);

  // --- both edit in parallel
  const a1 = (await anon.get(A)).data;
  assert.equal(a1.me.role, 'reviewer');
  assert.equal(a1.people.find((p) => p.name === 'Bob').token, undefined, 'reviewers do not see links');
  const aSave = await anon.put(`${A}/doc`, { doc: editParagraph(a1.doc, 'Second', 'Second paragraph, improved by Anna.'), rev: a1.rev });
  assert.equal(aSave.status, 200, JSON.stringify(aSave.data));
  const b1 = (await anon.get(B)).data;
  let bdoc = editParagraph(b1.doc, 'Second', 'Second paragraph, rewritten by Bob.');
  bdoc = editParagraph(bdoc, 'Third', 'Third paragraph, clarified by Bob [@doe2020].');
  // keep the citation chip: copy it from the original
  const third = bdoc.content.find((n) => (n.content || [])[0]?.text?.startsWith('Third paragraph, clarified'));
  const origThird = b1.doc.content.find((n) => (n.content || [])[0]?.text?.startsWith('Third'));
  third.content = [{ type: 'text', text: 'Third paragraph, clarified by Bob ' }, origThird.content.find((c) => c.type === 'opaque')];
  const bSave = await anon.put(`${B}/doc`, { doc: bdoc, rev: b1.rev });
  assert.equal(bSave.status, 200, JSON.stringify(bSave.data));

  // A stale save from another window is refused.
  assert.equal((await anon.put(`${B}/doc`, { doc: bdoc, rev: b1.rev })).status, 409);
  // Code chunks cannot be removed from the browser.
  const noChunk = { ...a1.doc, content: a1.doc.content.filter((n) => !(n.type === 'locked' && n.attrs.kind === 'chunk')) };
  assert.equal((await anon.put(`${A}/doc`, { doc: noChunk, rev: aSave.data.rev })).status, 409);

  // --- everyone sees everyone's changes
  let act = (await anon.get(`${A}/activity`)).data;
  assert.equal(act.changes.length, 3);
  const annaChange = act.changes.find((c) => c.author === 'Anna');
  const bobSecond = act.changes.find((c) => c.author === 'Bob' && c.new[0].text.startsWith('Second'));
  const bobThird = act.changes.find((c) => c.author === 'Bob' && c.new[0].text.startsWith('Third'));
  assert.equal(annaChange.old[0].text, 'Second paragraph, which two people will edit.');
  assert.equal(bobSecond.anchor.key, annaChange.anchor.key, 'both changes point at the same paragraph');
  assert.equal(bobThird.new[0].text, 'Third paragraph, clarified by Bob @doe2020'.replace('@doe2020', '[@doe2020]'));

  // --- citations: the bibliography and labels are offered; only known keys get in
  const refs = (await anon.get(A)).data.references;
  assert.deepEqual(refs.entries.map((e) => [e.id, e.label]), [['doe2020', 'Doe & Roe 2020'], ['lee2018', 'Lee 2018']]);
  assert.deepEqual(refs.labels.map((l) => [l.id, l.kind]), [['fig-x', 'Figure']]);
  const a2 = (await anon.get(A)).data;
  const citeNode = (id, mode, suffix = []) => ({ type: 'opaque', attrs: { kind: 'Cite', label: id, ast: { t: 'Cite', c: [[{ citationId: id, citationPrefix: [], citationSuffix: suffix, citationMode: { t: mode }, citationNoteNum: 0, citationHash: 0 }], []] } } });
  const withCite = JSON.parse(JSON.stringify(a2.doc));
  const closing = withCite.content.find((n) => (n.content || [])[0]?.text?.startsWith('Closing'));
  closing.content = [
    { type: 'text', text: 'Closing paragraph, see ' },
    citeNode('lee2018', 'NormalCitation', [{ t: 'Str', c: ',' }, { t: 'Space' }, { t: 'Str', c: 'p.' }, { t: 'Space' }, { t: 'Str', c: '7' }]),
    { type: 'text', text: ' and ' }, citeNode('fig-x', 'AuthorInText'),
    { type: 'text', text: ' but not ' }, citeNode('made-up', 'NormalCitation'),
    { type: 'text', text: '.' },
  ];
  assert.equal((await anon.put(`${A}/doc`, { doc: withCite, rev: a2.rev })).status, 200);
  const citeChange = (await anon.get(`${L}/activity`)).data.changes.find((c) => c.new[0]?.text.startsWith('Closing paragraph, see'));
  assert.equal(citeChange.new[0].text, 'Closing paragraph, see [@lee2018, p. 7] and @fig-x but not made-up.');
  const req = (await anon.post(`${A}/comments`, { type: 'reference', anchor: { quote: 'Closing paragraph' }, text: 'Please add doi:10.1000/xyz (Smith 2021) here.' })).data;
  assert.equal(req.type, 'reference');
  // Anna takes the citation edit back again so the rest of the flow is unchanged.
  assert.equal((await anon.post(`${A}/changes/${citeChange.id}/reject`)).status, 200);

  // --- comments are shared
  const c = (await anon.post(`${A}/comments`, { anchor: { quote: 'Closing paragraph', prefix: '', suffix: '.' }, text: 'Should we cut this?' })).data;
  await anon.post(`${B}/comments/${c.id}/agree`);
  await anon.post(`${L}/comments/${c.id}/replies`, { text: 'Agreed, will do.' });
  assert.equal((await anon.post(`${B}/comments/${c.id}/resolve`)).status, 403, 'only lead or author resolves');
  await anon.post(`${L}/comments/${c.id}/resolve`);
  const comments = (await anon.get(`${B}/activity`)).data.comments.filter((x) => x.type !== 'reference');
  assert.deepEqual(comments[0].agree, ['Bob']);
  assert.equal(comments[0].thread.length, 2);
  assert.equal(comments[0].resolved, true);

  // --- the lead decides
  assert.equal((await anon.post(`${A}/changes/${annaChange.id}/accept`)).status, 403);
  assert.equal((await anon.post(`${L}/changes/${annaChange.id}/accept`)).status, 200);
  act = (await anon.get(`${L}/activity`)).data;
  assert.equal(act.changes.find((x) => x.id === bobSecond.id).status, 'outdated', 'Bob edited the same paragraph');
  assert.equal(act.changes.find((x) => x.author === 'Anna'), undefined, 'accepted change is gone');
  assert.equal((await anon.post(`${L}/changes/${bobSecond.id}/accept`)).status, 409);
  assert.equal((await anon.post(`${L}/changes/${bobSecond.id}/reject`)).status, 200);
  assert.equal((await anon.post(`${L}/changes/${bobThird.id}/accept`)).status, 200);

  // --- Bob reloads: his copy follows the round, the rejected edit is gone
  const b2 = (await anon.get(B)).data;
  assert.ok(texts(b2.doc).includes('Second paragraph, improved by Anna.'));
  assert.ok(texts(b2.doc).includes('Third paragraph, clarified by Bob [@doe2020]'));
  assert.deepEqual(b2.changes, []);
  assert.deepEqual(b2.notices.map((n) => n.type).sort(), ['accepted', 'rejected']);

  // --- the lead edits directly
  const l2 = (await anon.get(L)).data;
  const lSave = await anon.put(`${L}/doc`, { doc: editParagraph(l2.doc, 'Closing', 'Closing paragraph, shortened.'), proseVersion: l2.proseVersion });
  assert.equal(lSave.status, 200, JSON.stringify(lSave.data));
  assert.equal((await anon.put(`${L}/doc`, { doc: l2.doc, proseVersion: l2.proseVersion })).status, 409);

  // --- everything lands in Git, attributed, and is pushed to the remote
  await app.flush({ force: true });
  const roundBranch = l2.round.branch;
  const git = (...a) => sh(remote.root, '--git-dir', remote.remote, ...a);
  const file = git('show', `${roundBranch}:paper.qmd`);
  assert.ok(file.includes('Second paragraph, improved by Anna.'));
  assert.ok(file.includes('Third paragraph, clarified by Bob [@doe2020]\n'));
  assert.ok(file.includes('Closing paragraph, shortened.'));
  assert.ok(file.includes('```{r}\n#| label: fig-x\nplot(1:10)\n```'), 'code untouched');
  assert.ok(file.includes('First paragraph stays as it is.'));
  assert.match(file, /<!-- quartorium\n[\s\S]*Should we cut this\?[\s\S]*-->$/);
  const authors = git('log', '--format=%an: %s', roundBranch).split('\n');
  for (const expected of [/^Anna: Reference request by Anna/, /^Anna: Anna withdrew a change/, /^Anna: Anna's change accepted/, /^Bob: Bob's change accepted/, /^Lena Lead: Bob's change declined/, /^Anna: Comment by Anna/, /^Lena Lead: Lena Lead's edits/]) {
    assert.ok(authors.some((l) => expected.test(l)), `missing ${expected} in\n${authors.join('\n')}`);
  }
  const branches = git('for-each-ref', '--format=%(refname:short)', 'refs/heads/quartorium');
  assert.equal(branches.split('\n').length, 3, branches);
  assert.ok(git('show', `${roundBranch}--anna-2:paper.qmd`).includes('improved by Anna'));

  // --- the author keeps working on main; the lead brings it in
  authorPush(remote, { 'paper.qmd': PAPER.replace('First paragraph stays as it is.', 'First paragraph, updated on main.') });
  const synced = await anon.post(`${L}/sync`);
  assert.equal(synced.status, 200, JSON.stringify(synced.data));
  const l3 = (await anon.get(L)).data;
  assert.ok(texts(l3.doc).includes('First paragraph, updated on main.'));
  assert.ok(texts(l3.doc).includes('Closing paragraph, shortened.'));

  // --- history is the paper trail
  const hist = (await anon.get(`${L}/history`)).data;
  assert.ok(hist.length >= 8);

  assert.equal((await anon.get('/r/not-a-token')).status, 404);

  // ================================================================ lifecycle
  // --- reviewers see their own edits inline, and what changed since their last visit
  const a4 = (await anon.get(A)).data;
  assert.ok(a4.sinceLastVisit.changes.some((c) => c.by === 'Bob (accepted by Lena Lead)'), JSON.stringify(a4.sinceLastVisit));
  assert.ok(a4.sinceLastVisit.changes.some((c) => c.by === 'Lena Lead'), 'lead edits are attributed');
  assert.ok(!a4.sinceLastVisit.changes.some((c) => c.by.startsWith('Anna')), 'your own accepted change is not news to you');
  assert.equal((await anon.get(A)).data.sinceLastVisit.changes.length, 0, 'seen now');
  const tracked = await anon.put(`${A}/doc`, { doc: editParagraph(a4.doc, 'First paragraph', 'First paragraph, Anna again.'), rev: a4.rev });
  assert.equal(tracked.status, 200);
  const a5 = (await anon.get(A)).data;
  assert.equal(a5.track.length, 1);
  assert.equal(a5.track[0].old[0].text, 'First paragraph, updated on main.');
  assert.ok(Array.isArray(a5.track[0].old[0].nodes), 'nodes for inline marking');

  // --- accept all from one person (nothing competing)
  const b3 = (await anon.get(B)).data;
  await anon.put(`${B}/doc`, { doc: editParagraph(b3.doc, 'Closing', 'Closing paragraph, by Bob.'), rev: b3.rev });
  const before = (await anon.get(`${L}/activity`)).data.changes;
  assert.equal(before.length, 2);
  assert.deepEqual(before.map((c) => c.competing), [[], []]);
  assert.deepEqual((await anon.post(`${L}/changes/accept-all`, { authorId: anna.id })).data, { accepted: 1 });
  assert.deepEqual((await anon.get(`${L}/activity`)).data.changes.map((c) => c.author), ['Bob']);

  // --- Bob finishes his review: a commit with his note, the lead is told
  assert.equal((await anon.post(`${L}/finish`, {})).status, 400, 'leads finish rounds, not reviews');
  const fin = await anon.post(`${B}/finish`, { note: 'Mostly small things; see the closing paragraph.' });
  assert.deepEqual(fin.data, { status: 'done' });
  const people = (await anon.get(`${L}/activity`)).data.people;
  assert.equal(people.find((p) => p.name === 'Bob').status, 'done');
  assert.equal(people.find((p) => p.name === 'Bob').doneNote, 'Mostly small things; see the closing paragraph.');
  assert.equal(people.find((p) => p.name === 'Anna').status, 'working');
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(mail.outbox.some((m) => m.to[0].address === 'lena@example.org' && /Bob finished reviewing/.test(m.subject)), JSON.stringify(mail.outbox.map((m) => m.subject)));
  await app.flush({ force: true });
  assert.match(git('log', '-1', '--format=%an|%B', `${roundBranch}--bob-3`), /^Bob\|Bob finished their review \(1 suggested change, 0 comments\)\n\nMostly small things/);

  // --- leaving the page commits work in progress right away
  const a6 = (await anon.get(A)).data;
  await anon.put(`${A}/doc`, { doc: editParagraph(a6.doc, 'First paragraph', 'First paragraph, Anna once more.'), rev: a6.rev });
  await anon.post(`${A}/pause`);
  assert.equal(sh(remote.root, '--git-dir', app.repoFor(app.project(proj.data.id)).dir, 'log', '-1', '--format=%s', `${roundBranch}--anna-2`), "Anna's edits (in progress)");

  // --- history entries show what changed
  const commits = (await anon.get(`${L}/history`)).data;
  const acceptCommit = commits.find((c) => /Anna's change accepted/.test(c.subject));
  const diff = (await anon.get(`${L}/history/${acceptCommit.hash}`)).data;
  assert.equal(diff.changes.length, 1);
  assert.equal(diff.changes[0].new[0].text, 'First paragraph, Anna again.');

  // --- the lead finishes the round: read-only, resolved threads leave the file
  assert.equal((await anon.post(`${A}/round/finish`)).status, 403);
  assert.equal((await anon.post(`${L}/round/finish`, {})).status, 200);
  const af = (await anon.get(A)).data;
  assert.equal(af.round.status, 'finished');
  assert.equal((await anon.put(`${A}/doc`, { doc: af.doc, rev: af.rev })).status, 409);
  assert.equal((await anon.post(`${A}/comments`, { anchor: {}, text: 'late' })).status, 409);
  await app.flush({ force: true });
  const finishedText = git('show', `${roundBranch}:paper.qmd`);
  assert.ok(!finishedText.includes('Should we cut this?'), 'resolved thread removed from the file');
  assert.ok(finishedText.includes('Please add doi:10.1000/xyz'), 'open reference request kept');
  assert.match(git('log', '-1', '--format=%B', roundBranch), /^Review round finished: Flow paper/);

  // --- merge into main (the round already contains main, so this fast-forwards)
  const merged = await anon.post(`${L}/round/merge`);
  assert.equal(merged.status, 200, JSON.stringify(merged.data));
  assert.equal(git('rev-parse', 'main'), git('rev-parse', roundBranch));
  assert.ok(git('show', 'main:paper.qmd').includes('Second paragraph, improved by Anna.'));

  // --- next round: same links, new branch, people told what changed
  assert.equal((await anon.post(`${A}/round/next`)).status, 403);
  const next = await anon.post(`${L}/round/next`, {});
  assert.equal(next.status, 200, JSON.stringify(next.data));
  assert.equal(next.data.from, 'main');
  assert.equal(next.data.token, created.data.leadToken, 'the lead keeps the same link');
  const ln = (await anon.get(L)).data;
  assert.equal(ln.round.id, next.data.roundId);
  assert.equal(ln.round.previousRoundId, l2.round.id);
  assert.equal(ln.round.status, 'open');
  const an = (await anon.get(A)).data;
  assert.equal(an.round.id, next.data.roundId, "Anna's old link opens the new round");
  assert.deepEqual(an.notices.map((n) => n.type), ['new-round']);
  assert.equal(an.changes.length, 0);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(mail.outbox.some((m) => m.to[0].address === 'anna@example.org' && /New version to review/.test(m.subject)));
  const prev = (await anon.get(`${L}/rounds`)).data;
  assert.equal(prev.length, 1);
  const old = (await anon.get(`/r/${prev[0].token}`)).data;
  assert.equal(old.round.status, 'finished');
});
