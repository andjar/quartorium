'use strict';
// Review rounds: the whole collaboration flow.
//
//   project  = a Git remote (any host) + base branch ("main")
//   round    = one .qmd under review, on branch quartorium/<name>
//   member   = a person with a link: one or more leads, any number of reviewers
//
// Reviewers edit private copies; their edits show up for everyone as changes
// to the round's text, and the lead accepts or rejects them. Comments are
// shared and stored invisibly in the .qmd.
//
// When things are committed (see docs/git.qmd):
//   - typing: never; drafts are saved on the server and visible to others
//   - leaving the page / 10 minutes without typing: "Anna's edits (in progress)"
//   - "Finish my review": a commit with the reviewer's note
//   - accept: a commit authored by the person who wrote the text
//   - reject, comment, reply, resolve: one commit each (agreements are bundled)
//   - "Finish round", "Merge into main": explicit lead actions

const crypto = require('crypto');
const path = require('path');
const config = require('./config');
const { Repo } = require('./git');
const { Renderer } = require('./render');
const { splitQmd } = require('./qmd/blocks');
const { parseQmd, serializeQmd, withMeta, blockViews, yamlSummary } = require('./qmd/document');
const { emptyMeta } = require('./qmd/meta');
const review = require('./review');
const mail = require('./mail');
const { loadBibliography, documentLabels } = require('./references');

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const prose = (text) => withMeta(text, null);
const metaOf = (text) => splitQmd(text).meta || emptyMeta();
const token = () => crypto.randomBytes(18).toString('base64url');
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'x';
const snippet = (s, n = 60) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const emailFor = (m) => m.email || `${slug(m.name)}@users.quartorium.invalid`;
const authorOf = (m) => ({ name: m.name, email: emailFor(m) });
const docTitle = (text) => { const y = splitQmd(text).blocks.find((b) => b.kind === 'yaml'); return y ? yamlSummary(y.source).title : null; };
const sameKeys = (a, b) => JSON.stringify(a) === JSON.stringify(b);

class Quartorium {
  constructor({ db, dataDir = config.dataDir }) {
    this.db = db;
    this.dataDir = dataDir;
    this.repos = new Map();
    this.renderer = new Renderer(path.join(dataDir, 'renders'));
    this.locks = new Map();
    this.parsed = new Map();
    this.pendingPush = new Set();
    this.renderKeys = new Map();
    this.bibCache = new Map();
  }

  // ------------------------------------------------------------ helpers

  withLock(key, fn) {
    const prev = this.locks.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(key, next.catch(() => {}));
    return next;
  }

  repoFor(project) {
    let repo = this.repos.get(project.id);
    if (!repo) {
      repo = new Repo(path.join(this.dataDir, 'repos', `${project.id}.git`), { remoteUrl: project.remote_url, username: project.username, token: project.token });
      this.repos.set(project.id, repo);
    }
    return repo;
  }

  async parse(text) {
    let p = this.parsed.get(text);
    if (!p) {
      p = await parseQmd(text);
      this.parsed.set(text, p);
      if (this.parsed.size > 100) this.parsed.delete(this.parsed.keys().next().value);
    }
    return p;
  }

  project(id) { return this.db.get('SELECT * FROM projects WHERE id = ?', id); }
  round(id) { return this.db.get('SELECT * FROM rounds WHERE id = ?', id); }
  member(id) { return this.db.get('SELECT * FROM members WHERE id = ?', id); }
  members(roundId) { return this.db.all('SELECT * FROM members WHERE round_id = ? AND active = 1 ORDER BY role, id', roundId); }
  leads(roundId) { return this.members(roundId).filter((m) => m.role === 'lead'); }

  /** Resolve a link token into { member, round, project } or throw 404. */
  context(tok) {
    const member = tok && this.db.get('SELECT * FROM members WHERE token = ? AND active = 1', tok);
    if (!member) throw new HttpError(404, 'This link is not valid (any more).');
    const round = this.round(member.round_id);
    return { member, round, project: this.project(round.project_id) };
  }

  refresh(ctx) {
    return { member: this.member(ctx.member.id), round: this.round(ctx.round.id), project: ctx.project };
  }

  requireLead(ctx, what = 'do this') {
    if (ctx.member.role !== 'lead') throw new HttpError(403, `Only the lead author can ${what}.`);
  }

  assertOpen(round) {
    if (this.round(round.id).status !== 'open') throw new HttpError(409, 'This review round has finished; the paper can no longer be changed here.', { reload: true });
  }

  linkFor(baseUrl, member) {
    return `${config.publicUrl || baseUrl || ''}/r/${member.token}`;
  }

  addEvent(round, member, type, data = {}) {
    this.db.run('INSERT INTO events (round_id, member_id, type, data) VALUES (?, ?, ?, ?)', round.id, member ? member.id : null, type, JSON.stringify(data));
  }

  // ------------------------------------------------------------ projects

  listProjects() {
    return this.db.all('SELECT id, name, remote_url, username, base_branch, push_error, created_at FROM projects ORDER BY id DESC').map((p) => ({
      ...p,
      rounds: this.db.all('SELECT id, title, doc_path, branch, status, created_at, updated_at FROM rounds WHERE project_id = ? ORDER BY id DESC', p.id),
    }));
  }

  async createProject({ name, remoteUrl, baseBranch, username, token: tok }) {
    if (!remoteUrl) throw new HttpError(400, 'A Git URL is required.');
    const res = this.db.run('INSERT INTO projects (name, remote_url, username, token, base_branch) VALUES (?, ?, ?, ?, ?)',
      name || remoteUrl.replace(/\.git$/, '').split(/[/:]/).pop(), remoteUrl, username || null, tok || null, baseBranch || 'main');
    const project = this.project(Number(res.lastInsertRowid));
    try {
      const repo = this.repoFor(project);
      await repo.clone();
      if (!baseBranch) this.db.update('projects', project.id, { base_branch: await repo.defaultBranch() });
      const branch = this.project(project.id).base_branch;
      if (!(await repo.resolve(`refs/remotes/origin/${branch}`))) throw new Error(`Branch "${branch}" was not found in the repository.`);
    } catch (e) {
      this.db.run('DELETE FROM projects WHERE id = ?', project.id);
      this.repos.delete(project.id);
      require('fs').rmSync(path.join(this.dataDir, 'repos', `${project.id}.git`), { recursive: true, force: true });
      throw new HttpError(400, `Could not clone the repository: ${e.message.replace(/Authorization: Basic \S+/g, '***')}`);
    }
    return this.project(project.id);
  }

  deleteProject(id) {
    this.db.run('DELETE FROM projects WHERE id = ?', id);
    this.repos.delete(Number(id));
    require('fs').rmSync(path.join(this.dataDir, 'repos', `${Number(id)}.git`), { recursive: true, force: true });
  }

  async listFiles(projectId) {
    const project = this.project(projectId);
    if (!project) throw new HttpError(404, 'Project not found');
    const repo = this.repoFor(project);
    await repo.fetch();
    const files = await repo.listFiles(`refs/remotes/origin/${project.base_branch}`);
    return files.filter((f) => /\.qmd$/i.test(f) && !f.startsWith('_'));
  }

  // ------------------------------------------------------------ rounds & people

  async createRound(projectId, { docPath, title, leadName, leadEmail }) {
    const project = this.project(projectId);
    if (!project) throw new HttpError(404, 'Project not found');
    if (!docPath || !leadName) throw new HttpError(400, 'Choose a document and enter the lead author\'s name.');
    const repo = this.repoFor(project);
    await repo.fetch();
    const round = await this.startRound(project, { docPath, title, baseRef: `refs/remotes/origin/${project.base_branch}` });
    const lead = await this.addMember(round, { name: leadName, email: leadEmail, role: 'lead' });
    return { round: this.round(round.id), lead };
  }

  /** Create the branch and the round record. */
  async startRound(project, { docPath, title, baseRef, previousRoundId = null }) {
    const repo = this.repoFor(project);
    const text = await repo.readFile(baseRef, docPath);
    if (text == null) throw new HttpError(404, `${docPath} was not found.`);
    const date = new Date().toISOString().slice(0, 10);
    const branch = `quartorium/${slug(path.basename(docPath, '.qmd'))}-${date}-${crypto.randomBytes(2).toString('hex')}`;
    await repo.createBranch(branch, baseRef);
    const res = this.db.run('INSERT INTO rounds (project_id, doc_path, title, branch, base_text, previous_round_id) VALUES (?, ?, ?, ?, ?, ?)',
      project.id, docPath, title || docTitle(text) || docPath, branch, text, previousRoundId);
    const round = this.round(Number(res.lastInsertRowid));
    // Comments in the format of earlier Quartorium versions are rewritten right away.
    const meta = splitQmd(text).meta;
    if (meta && !/<!--[ \t]*quartorium/.test(text)) this.db.update('rounds', round.id, { base_text: withMeta(text, meta), version: 2 });
    this.pendingPush.add(project.id);
    this.renderInfo(this.round(round.id)).catch(() => {});
    return this.round(round.id);
  }

  async addMember(round, { name, email, role = 'reviewer', tok = null }) {
    name = String(name || '').trim();
    if (!name) throw new HttpError(400, 'A name is required.');
    if (!['lead', 'reviewer'].includes(role)) throw new HttpError(400, 'Unknown role.');
    const project = this.project(round.project_id);
    const repo = this.repoFor(project);
    const res = this.db.run('INSERT INTO members (round_id, name, email, role, token, branch, copy_base) VALUES (?, ?, ?, ?, ?, ?, ?)',
      round.id, name, email || null, role, tok || token(), 'pending', prose(round.base_text));
    const id = Number(res.lastInsertRowid);
    const branch = `${round.branch}--${slug(name)}-${id}`;
    if (role === 'reviewer') await repo.createBranch(branch, `refs/heads/${round.branch}`);
    this.db.update('members', id, { branch: role === 'reviewer' ? branch : round.branch });
    this.pendingPush.add(project.id);
    return this.member(id);
  }

  async removeMember(round, memberId) {
    const m = this.member(memberId);
    if (!m || m.round_id !== round.id) throw new HttpError(404, 'Person not found');
    if (m.role === 'lead' && this.leads(round.id).length === 1) throw new HttpError(400, 'A round needs at least one lead.');
    await this.withLock(round.id, async () => {
      await this.commitMember(m);
      this.db.update('members', m.id, { active: 0 });
    });
  }

  async invite(ctx, memberId, baseUrl) {
    this.requireLead(ctx, 'send invitations');
    const m = this.member(memberId);
    if (!m || m.round_id !== ctx.round.id) throw new HttpError(404, 'Person not found');
    if (!mail.enabled()) throw new HttpError(400, 'This server has no mail server configured.');
    if (!m.email) throw new HttpError(400, `Add an e-mail address for ${m.name} first.`);
    await mail.send({ to: m.email, ...mail.templates.invite({ name: m.name, title: ctx.round.title, lead: ctx.member.name, link: this.linkFor(baseUrl, m) }) });
    this.db.update('members', m.id, { invited_at: this.db.now() });
    return { ok: true };
  }

  peopleView(round, viewer, changes = []) {
    const comments = metaOf(round.base_text).comments;
    return this.members(round.id).map((m) => ({
      id: m.id, name: m.name, role: m.role, lastSeen: m.last_seen, status: m.status, doneAt: m.done_at, doneNote: m.done_note,
      suggestions: changes.filter((c) => c.authorId === m.id).length,
      comments: comments.filter((c) => c.author === m.name).length,
      ...(viewer.role === 'lead' ? { token: m.token, email: m.email, invitedAt: m.invited_at } : {}),
    }));
  }

  adminRound(roundId) {
    const round = this.round(roundId);
    if (!round) throw new HttpError(404, 'Round not found');
    return {
      id: round.id, title: round.title, docPath: round.doc_path, branch: round.branch, status: round.status,
      people: this.members(round.id).map((m) => ({ id: m.id, name: m.name, role: m.role, token: m.token, lastSeen: m.last_seen, status: m.status })),
    };
  }

  // ------------------------------------------------------------ committing

  /**
   * Commit the round's text. Without `author`, only pending changes are
   * committed (the lead's own edits or bundled comment reactions).
   * Returns the head commit of the round branch.
   */
  async commitRound(round, { author, message } = {}) {
    round = this.round(round.id);
    const repo = this.repoFor(this.project(round.project_id));
    const ref = `refs/heads/${round.branch}`;
    if (round.version <= round.committed_version && !author) return repo.resolve(ref);
    const lead = round.dirty_author_id ? this.member(round.dirty_author_id) : null;
    if (!author && lead) {
      // Remember which paragraphs the lead changed, for "since your last visit".
      const before = await repo.readFile(ref, round.doc_path);
      const hunks = review.diffBlocks(review.blocksOf(prose(before || '')).blocks, review.blocksOf(prose(round.base_text)).blocks);
      const nb = review.blocksOf(prose(round.base_text)).blocks;
      const keys = hunks.flatMap((h) => review.keysOf(nb.slice(h.bStart, h.bEnd)));
      if (keys.length) this.addEvent(round, lead, 'edited', { keys, by: lead.name });
    }
    const commit = await repo.commitFile({
      branch: round.branch, filepath: round.doc_path, content: round.base_text,
      author: author || (lead ? authorOf(lead) : null),
      message: message || (lead ? `${lead.name}'s edits` : 'Reactions to comments'),
      allowEmpty: Boolean(author),
    });
    this.db.update('rounds', round.id, { committed_version: round.version, dirty_author_id: null });
    this.pendingPush.add(round.project_id);
    return commit;
  }

  /** Commit a reviewer's copy to their branch if it changed since the last commit. */
  async commitMember(member, { message, force = false } = {}) {
    member = this.member(member.id);
    if (member.role !== 'reviewer' || (member.copy_rev <= member.committed_rev && !force)) return;
    const round = this.round(member.round_id);
    const repo = this.repoFor(this.project(round.project_id));
    await repo.commitFile({
      branch: member.branch, filepath: round.doc_path, content: member.copy_text ?? member.copy_base,
      author: authorOf(member), message: message || `${member.name}'s edits (in progress)`,
      extraParents: member.rebased_onto ? [member.rebased_onto] : [], allowEmpty: force,
    });
    this.db.update('members', member.id, { committed_rev: member.copy_rev, rebased_onto: null });
    this.pendingPush.add(round.project_id);
  }

  /** The person left the page: commit what they did. */
  async pause(ctx) {
    return this.withLock(ctx.round.id, async () => {
      const { member, round } = this.refresh(ctx);
      if (member.role === 'reviewer') await this.commitMember(member);
      else if (round.dirty_author_id === member.id) await this.commitRound(round);
      return { ok: true };
    });
  }

  /** Commit drafts nobody typed in for a while, and push. Called every few seconds and on shutdown. */
  async flush({ force = false } = {}) {
    const cutoff = new Date(Date.now() - config.commitIdleSeconds * 1000).toISOString();
    for (const round of this.db.all('SELECT * FROM rounds WHERE version > committed_version')) {
      // Comment reactions are bundled quickly; the lead's own edits wait for a pause.
      const due = force || round.updated_at < (round.dirty_author_id ? cutoff : new Date(Date.now() - 30000).toISOString());
      if (due) await this.withLock(round.id, () => this.commitRound(round));
    }
    for (const m of this.db.all("SELECT * FROM members WHERE role = 'reviewer' AND copy_rev > committed_rev")) {
      if (force || m.updated_at < cutoff) await this.withLock(m.round_id, () => this.commitMember(m));
    }
    for (const projectId of [...this.pendingPush]) {
      const project = this.project(projectId);
      this.pendingPush.delete(projectId);
      if (!project) continue;
      try {
        await this.repoFor(project).push(['refs/heads/quartorium/*:refs/heads/quartorium/*']);
        if (project.push_error) this.db.update('projects', projectId, { push_error: null });
      } catch (e) {
        this.db.update('projects', projectId, { push_error: e.message.slice(0, 2000) });
      }
    }
  }

  // ------------------------------------------------------------ rendering & references

  async renderInfo(round, { force = false } = {}) {
    const project = this.project(round.project_id);
    const repo = this.repoFor(project);
    const ref = `refs/heads/${round.branch}`;
    const head = await repo.resolve(ref);
    const lockedSig = splitQmd(round.base_text).blocks.filter((b) => b.locked).map((b) => b.key).join(',');
    const memo = this.renderKeys.get(round.id);
    let key;
    if (memo && memo.head === head && memo.lockedSig === lockedSig) key = memo.key;
    else {
      key = await this.renderer.keyFor(repo, ref, round.doc_path, round.base_text);
      this.renderKeys.set(round.id, { head, lockedSig, key });
    }
    const cached = force ? null : this.renderer.get(key);
    if (cached) return { key, status: cached.status, error: cached.error || null, outputs: cached.outputs, xrefs: cached.xrefs || {} };
    this.renderer.ensure({ repo, ref, docPath: round.doc_path, text: round.base_text, key, force }).catch(() => {});
    return { key, status: 'rendering', error: null, outputs: {}, xrefs: {} };
  }

  /** What can be cited: bibliography entries (read-only) and labels in the paper. */
  async references(round) {
    const repo = this.repoFor(this.project(round.project_id));
    const ref = `refs/heads/${round.branch}`;
    const memoKey = (await repo.resolve(ref)) + (splitQmd(round.base_text).blocks.find((b) => b.kind === 'yaml')?.key || '');
    let bib = this.bibCache.get(round.id);
    if (!bib || bib.memoKey !== memoKey) {
      bib = { memoKey, ...(await loadBibliography(repo, ref, round.doc_path, round.base_text)) };
      this.bibCache.set(round.id, bib);
    }
    return { files: bib.files, missing: bib.missing, entries: bib.entries, labels: documentLabels(round.base_text) };
  }

  async citeIds(round) {
    const refs = await this.references(round);
    return new Set([...refs.entries.map((e) => e.id), ...refs.labels.map((l) => l.id)]);
  }

  // ------------------------------------------------------------ changes

  async views(items) {
    const map = new Map((await blockViews(items)).map((v) => [v.key, v]));
    return (b) => { const v = map.get(b.key); return { key: b.key, kind: v.kind, locked: v.locked, text: v.text, nodes: v.nodes }; };
  }

  /** All reviewers' changes against the round's current text. */
  async changes(round) {
    const baseProse = prose(round.base_text);
    const baseBlocks = review.blocksOf(baseProse).blocks;
    const raw = [];
    for (const m of this.members(round.id)) {
      if (m.role !== 'reviewer' || (m.copy_text == null && m.orphans.length === 0)) continue;
      for (const c of review.changesOf({
        memberId: m.id, copyBase: m.copy_base, copy: m.copy_text ?? m.copy_base, base: baseProse,
        resolved: m.resolved, orphans: m.orphans,
      })) raw.push({ ...c, member: m });
    }
    const view = await this.views(raw.flatMap((c) => [...c.old, ...c.new]));
    const out = raw.map((c) => {
      let anchor = null;
      if (c.status === 'open') {
        if (c.old.length) anchor = { key: baseBlocks[c.pos].key, after: false };
        else if (c.pos > 0) anchor = { key: baseBlocks[c.pos - 1].key, after: true };
        else if (baseBlocks[0]) anchor = { key: baseBlocks[0].key, after: false };
      }
      return { id: c.id, authorId: c.member.id, author: c.member.name, status: c.status, anchor, pos: c.pos, old: c.old.map(view), new: c.new.map(view), raw: c };
    });
    // Changes touching the same paragraphs compete: the lead picks one.
    for (const c of out) {
      c.competing = out.filter((o) => o !== c && o.status === 'open' && c.status === 'open' && o.authorId !== c.authorId
        && o.pos < c.pos + Math.max(1, c.old.length) && c.pos < o.pos + Math.max(1, o.old.length)).map((o) => o.id);
    }
    return out;
  }

  async changesView(round) {
    return (await this.changes(round)).map(({ raw, ...v }) => v);
  }

  async findChange(round, id) {
    const c = (await this.changes(round)).find((x) => x.id === id);
    if (!c) throw new HttpError(404, 'This change no longer exists (it may have been edited or handled already).');
    return c;
  }

  addNotice(memberId, notice) {
    const m = this.member(memberId);
    this.db.update('members', m.id, { notices: [...m.notices, { ...notice, at: this.db.now() }].slice(-20) });
  }

  /** Apply one open change to the round (caller holds the lock). */
  async acceptOne(round, c, lead) {
    if (c.status !== 'open') throw new HttpError(409, 'This change is outdated: the text it was based on has changed. Copy what you need by hand, or reject it.');
    await this.commitMember(c.raw.member);
    await this.commitRound(round);
    round = this.round(round.id);
    const newText = withMeta(review.applyChange(prose(round.base_text), c.raw), metaOf(round.base_text));
    const desc = snippet(c.new.map((b) => b.text).join(' ') || c.old.map((b) => b.text).join(' '));
    this.db.update('rounds', round.id, { base_text: newText, prose_version: round.prose_version + 1, version: round.version + 1, updated_at: this.db.now() });
    await this.commitRound(round, {
      author: authorOf(c.raw.member),
      message: `${c.raw.member.name}'s change accepted: “${desc}”\n\nAccepted by ${lead.name} in Quartorium.`,
    });
    const m = this.member(c.raw.member.id);
    this.db.update('members', m.id, { resolved: [...m.resolved, { old: review.keysOf(c.raw.old), new: review.keysOf(c.raw.new), outcome: 'accepted' }] });
    this.addNotice(m.id, { type: 'accepted', by: lead.name, text: desc });
    this.addEvent(round, lead, 'accepted', { keys: review.keysOf(c.raw.new), oldKeys: review.keysOf(c.raw.old), author: m.name, authorId: m.id, by: lead.name });
  }

  async accept(ctx, changeId) {
    this.requireLead(ctx, 'accept changes');
    this.assertOpen(ctx.round);
    return this.withLock(ctx.round.id, async () => {
      const round = this.round(ctx.round.id);
      await this.acceptOne(round, await this.findChange(round, changeId), ctx.member);
    });
  }

  /** Accept every open change that competes with no other (optionally from one person). */
  async acceptAll(ctx, { authorId } = {}) {
    this.requireLead(ctx, 'accept changes');
    this.assertOpen(ctx.round);
    return this.withLock(ctx.round.id, async () => {
      let accepted = 0;
      const tried = new Set();
      for (;;) {
        const round = this.round(ctx.round.id);
        const next = (await this.changes(round)).find((c) => c.status === 'open' && c.competing.length === 0 && !tried.has(c.id)
          && (authorId == null || c.authorId === Number(authorId)));
        if (!next) break;
        tried.add(next.id);
        await this.acceptOne(round, next, ctx.member);
        accepted++;
      }
      return { accepted };
    });
  }

  async reject(ctx, changeId) {
    this.assertOpen(ctx.round);
    return this.withLock(ctx.round.id, async () => {
      const round = this.round(ctx.round.id);
      const c = await this.findChange(round, changeId);
      const own = c.raw.member.id === ctx.member.id;
      if (ctx.member.role !== 'lead' && !own) throw new HttpError(403, 'Only the lead (or the person who made it) can reject a change.');
      await this.commitMember(c.raw.member);
      const m = this.member(c.raw.member.id);
      const oldKeys = review.keysOf(c.raw.old), newKeys = review.keysOf(c.raw.new);
      const isThis = (o) => sameKeys(review.keysOf(o.old), oldKeys) && sameKeys(review.keysOf(o.new), newKeys);
      if (m.orphans.some(isThis)) this.db.update('members', m.id, { orphans: m.orphans.filter((o) => !isThis(o)) });
      else this.db.update('members', m.id, { resolved: [...m.resolved, { old: oldKeys, new: newKeys, outcome: 'rejected' }] });
      const desc = snippet(c.new.map((b) => b.text).join(' ') || c.old.map((b) => b.text).join(' '));
      await this.commitRound(round);
      await this.commitRound(round, {
        author: authorOf(ctx.member),
        message: own ? `${m.name} withdrew a change: “${desc}”` : `${m.name}'s change declined: “${desc}”\n\nDeclined by ${ctx.member.name} in Quartorium.`,
      });
      if (!own) {
        this.addNotice(m.id, { type: 'rejected', by: ctx.member.name, text: desc });
        this.addEvent(round, ctx.member, 'rejected', { author: m.name, text: desc });
      }
    });
  }

  // ------------------------------------------------------------ loading & saving

  /** Bring a reviewer's copy up to date with the round (only done on page load). */
  async rebase(member, round) {
    const baseProse = prose(round.base_text);
    if (member.copy_base === baseProse) return;
    if (member.copy_text == null) {
      this.db.update('members', member.id, { copy_base: baseProse, copy_rev: member.copy_rev + 1, committed_rev: member.copy_rev + 1, resolved: [] });
      return;
    }
    await this.commitMember(member);
    const head = await this.commitRound(round);
    member = this.member(member.id);
    const rejected = member.resolved.filter((r) => r.outcome === 'rejected');
    const { copy, conflicts } = review.rebaseCopy({ copyBase: member.copy_base, copy: member.copy_text, base: baseProse, rejected });
    const slim = (items) => items.map((b) => ({ key: b.key, kind: b.kind, locked: b.locked, source: b.source, sep: b.sep }));
    const orphans = [...member.orphans, ...conflicts.map((c) => ({ old: slim(c.old), new: slim(c.new) }))];
    this.db.update('members', member.id, {
      copy_text: copy === baseProse ? null : copy, copy_base: baseProse, copy_rev: member.copy_rev + 1,
      resolved: [], orphans, rebased_onto: head, updated_at: this.db.now(),
    });
    if (conflicts.length) this.addNotice(member.id, { type: 'conflict', count: conflicts.length });
  }

  /** For a reviewer: where their copy differs from the round, so the editor can mark it inline. */
  async trackBase(member) {
    if (member.role !== 'reviewer' || member.copy_text == null) return [];
    const o = review.blocksOf(member.copy_base).blocks;
    const c = review.blocksOf(member.copy_text).blocks;
    const hunks = review.diffBlocks(o, c);
    const view = await this.views(hunks.flatMap((h) => o.slice(h.aStart, h.aEnd)));
    return hunks.map((h) => ({
      newKeys: review.keysOf(c.slice(h.bStart, h.bEnd)),
      afterKey: h.bStart > 0 ? c[h.bStart - 1].key : null,
      old: o.slice(h.aStart, h.aEnd).map(view),
    }));
  }

  /** What changed in the round since this person last opened it, and who did it. */
  async sinceLastVisit(member, round) {
    if (!member.seen_prose) return null;
    const now = prose(round.base_text);
    if (now === member.seen_prose) return { at: member.seen_at, changes: [] };
    const o = review.blocksOf(member.seen_prose).blocks;
    const n = review.blocksOf(now).blocks;
    // Events of this round and the earlier ones (people are matched by name across rounds).
    const ids = [round.id];
    for (let r = round; r && r.previous_round_id && ids.length < 20;) { ids.push(r.previous_round_id); r = this.round(r.previous_round_id); }
    const events = this.db.all(`SELECT e.*, m.name AS actor FROM events e LEFT JOIN members m ON m.id = e.member_id WHERE e.round_id IN (${ids.map(() => '?').join(',')}) AND e.type IN ('accepted', 'edited', 'main') ORDER BY e.id DESC`, ...ids);
    const raw = [];
    for (const h of review.diffBlocks(o, n)) {
      const oldItems = o.slice(h.aStart, h.aEnd), newItems = n.slice(h.bStart, h.bEnd);
      const keys = new Set([...review.keysOf(newItems), ...review.keysOf(oldItems)]);
      const ev = events.find((e) => [...(e.data.keys || []), ...(e.data.oldKeys || [])].some((k) => keys.has(k)));
      let by;
      if (!ev) by = 'the lead author';
      else if (ev.type === 'accepted') {
        if (ev.data.author === member.name || ev.data.by === member.name) continue; // your own change, or your own decision
        by = `${ev.data.author} (accepted by ${ev.data.by})`;
      } else if (ev.type === 'edited') {
        if (ev.data.by === member.name) continue;
        by = ev.data.by;
      } else by = 'an update from the main branch';
      raw.push({ oldItems, newItems, by, anchor: newItems.length ? { key: newItems[0].key, after: false } : (h.bStart > 0 ? { key: n[h.bStart - 1].key, after: true } : null) });
    }
    const view = await this.views(raw.flatMap((r) => [...r.oldItems, ...r.newItems]));
    return { at: member.seen_at, changes: raw.map((r) => ({ by: r.by, anchor: r.anchor, old: r.oldItems.map(view), new: r.newItems.map(view) })) };
  }

  roundView(round, project) {
    return {
      id: round.id, title: round.title, docPath: round.doc_path, branch: round.branch, project: project.name, baseBranch: project.base_branch,
      status: round.status, finishedAt: round.finished_at, mergedAt: round.merged_at, previousRoundId: round.previous_round_id, nextRoundId: round.next_round_id,
    };
  }

  async load(ctx) {
    return this.withLock(ctx.round.id, async () => {
      if (ctx.member.role === 'reviewer' && ctx.round.status === 'open') await this.rebase(ctx.member, ctx.round);
      const { member, round, project } = this.refresh(ctx);
      const text = member.role === 'lead' ? round.base_text : (member.copy_text ?? member.copy_base);
      const parsed = await this.parse(text);
      const since = await this.sinceLastVisit(member, round);
      const changes = await this.changesView(round);
      this.db.update('members', member.id, {
        last_seen: this.db.now(), notices: [], seen_prose: prose(round.base_text), seen_at: this.db.now(),
        status: member.status === 'invited' ? 'working' : member.status,
      });
      return {
        me: { id: member.id, name: member.name, role: member.role, status: member.status === 'invited' ? 'working' : member.status },
        round: this.roundView(round, project),
        doc: parsed.doc,
        rev: member.copy_rev,
        proseVersion: round.prose_version,
        version: round.version,
        comments: metaOf(round.base_text).comments,
        changes,
        track: await this.trackBase(member),
        sinceLastVisit: since,
        people: this.peopleView(round, member, changes),
        render: await this.renderInfo(round),
        references: await this.references(round),
        notices: member.notices,
        mail: mail.enabled(),
        pushError: member.role === 'lead' ? project.push_error : null,
      };
    });
  }

  async activity(ctx, { renderKey } = {}) {
    const { member, round, project } = this.refresh(ctx);
    this.db.update('members', member.id, { last_seen: this.db.now() });
    const render = await this.renderInfo(round);
    if (render.key === renderKey) { delete render.outputs; delete render.xrefs; }
    const changes = await this.changesView(round);
    return {
      round: this.roundView(round, project),
      proseVersion: round.prose_version,
      version: round.version,
      comments: metaOf(round.base_text).comments,
      changes,
      people: this.peopleView(round, member, changes),
      render,
      pushError: member.role === 'lead' ? project.push_error : null,
    };
  }

  async save(ctx, { doc, rev, proseVersion }) {
    this.assertOpen(ctx.round);
    return this.withLock(ctx.round.id, async () => {
      const { member, round } = this.refresh(ctx);
      if (member.role === 'lead') {
        if (proseVersion !== round.prose_version) throw new HttpError(409, 'The document changed in the meantime.', { reload: true });
        const parsed = await this.parse(round.base_text);
        const text = await serializeQmd(doc, [parsed], { citeIds: await this.citeIds(round) });
        if (text !== round.base_text) {
          this.db.update('rounds', round.id, { base_text: text, prose_version: round.prose_version + 1, version: round.version + 1, dirty_author_id: member.id, updated_at: this.db.now() });
        }
        return { proseVersion: this.round(round.id).prose_version };
      }
      if (rev !== member.copy_rev) throw new HttpError(409, 'Your copy was updated in another window.', { reload: true });
      const ref = member.copy_text ?? member.copy_base;
      const contexts = [await this.parse(ref)];
      if (member.copy_text != null) contexts.push(await this.parse(member.copy_base));
      const text = await serializeQmd(doc, contexts, { meta: null, citeIds: await this.citeIds(round) });
      const copy = text === member.copy_base ? null : text;
      if (copy !== member.copy_text) {
        // Editing after "finished" means the review is in progress again.
        this.db.update('members', member.id, { copy_text: copy, copy_rev: member.copy_rev + 1, updated_at: this.db.now(), status: 'working' });
      }
      return { rev: this.member(member.id).copy_rev, status: this.member(member.id).status };
    });
  }

  /** A reviewer is done, like sending the Word file back. */
  async finishReview(ctx, { note } = {}, baseUrl) {
    if (ctx.member.role !== 'reviewer') throw new HttpError(400, 'Only reviewers finish a review; the lead finishes the round.');
    this.assertOpen(ctx.round);
    note = String(note || '').trim().slice(0, 5000);
    return this.withLock(ctx.round.id, async () => {
      const { member, round } = this.refresh(ctx);
      const changes = (await this.changes(round)).filter((c) => c.authorId === member.id).length;
      const comments = metaOf(round.base_text).comments.filter((c) => c.author === member.name).length;
      await this.commitMember(member, {
        force: true,
        message: `${member.name} finished their review (${changes} suggested change${changes === 1 ? '' : 's'}, ${comments} comment${comments === 1 ? '' : 's'})${note ? `\n\n${note}` : ''}`,
      });
      this.db.update('members', member.id, { status: 'done', done_at: this.db.now(), done_note: note || null });
      this.addEvent(round, member, 'finished', { note });
      for (const lead of this.leads(round.id)) {
        this.addNotice(lead.id, { type: 'finished', by: member.name, text: note });
        if (lead.email) mail.notify({ to: lead.email, ...mail.templates.finished({ name: lead.name, reviewer: member.name, title: round.title, note, link: this.linkFor(baseUrl, lead) }) });
      }
      return { status: 'done' };
    });
  }

  // ------------------------------------------------------------ the round's lifecycle

  /** Close the round: everything is committed, resolved threads leave the file. */
  async finishRound(ctx, { removeResolved = true } = {}) {
    this.requireLead(ctx, 'finish the round');
    this.assertOpen(ctx.round);
    return this.withLock(ctx.round.id, async () => {
      const round = this.round(ctx.round.id);
      for (const m of this.members(round.id)) await this.commitMember(m);
      await this.commitRound(round);
      const meta = metaOf(round.base_text);
      const resolvedCount = meta.comments.filter((c) => c.resolved).length;
      if (removeResolved && resolvedCount) {
        meta.comments = meta.comments.filter((c) => !c.resolved);
        const r = this.round(round.id);
        this.db.update('rounds', round.id, { base_text: withMeta(r.base_text, meta), version: r.version + 1 });
      }
      const open = (await this.changes(this.round(round.id))).length;
      const summary = [
        `${meta.comments.length} open comment thread${meta.comments.length === 1 ? '' : 's'} carried in the file`,
        removeResolved ? `${resolvedCount} resolved thread${resolvedCount === 1 ? '' : 's'} removed (still in the history)` : null,
        open ? `${open} undecided suggestion${open === 1 ? '' : 's'} left on the reviewers' branches` : null,
      ].filter(Boolean).join('\n');
      await this.commitRound(round, { author: authorOf(ctx.member), message: `Review round finished: ${round.title}\n\n${summary}` });
      this.db.update('rounds', round.id, { status: 'finished', finished_at: this.db.now() });
      this.addEvent(round, ctx.member, 'round-finished', {});
      return { ok: true };
    });
  }

  async reopenRound(ctx) {
    this.requireLead(ctx, 'reopen the round');
    const round = this.round(ctx.round.id);
    if (round.status !== 'finished' || round.next_round_id) throw new HttpError(409, 'Only the latest finished round can be reopened.');
    this.db.update('rounds', round.id, { status: 'open', finished_at: null });
    return { ok: true };
  }

  /**
   * Merge the round into the base branch and push it. Only when Git can merge
   * without conflicts; otherwise explain how to do it by hand.
   */
  async mergeIntoMain(ctx) {
    this.requireLead(ctx, `merge into the main branch`);
    return this.withLock(ctx.round.id, async () => {
      const round = this.round(ctx.round.id);
      const project = this.project(round.project_id);
      const repo = this.repoFor(project);
      const base = project.base_branch;
      if (round.status === 'open') for (const m of this.members(round.id)) await this.commitMember(m);
      const roundHead = await this.commitRound(round);
      await repo.fetch();
      const mainHead = await repo.resolve(`refs/remotes/origin/${base}`);
      const result = await repo.mergeCommits(mainHead, roundHead, { author: authorOf(ctx.member), message: `Merge review round “${round.title}” into ${base}` });
      if (!result.clean) {
        throw new HttpError(409, `${base} has changes to the same lines as this round (${result.conflicts.join(', ')}). Use “Update from ${base}” first if it’s a small overlap, or merge the branch ${round.branch} with your Git tools or a pull request.`);
      }
      if (result.upToDate) return { upToDate: true };
      try {
        await repo.pushCommit(result.commit, base);
      } catch (e) {
        throw new HttpError(409, `Your Git host did not accept the push to ${base} (it may be protected). Open a pull/merge request from ${round.branch} into ${base} instead.\n\n${e.message.replace(/Authorization: Basic \S+/g, '***').slice(0, 500)}`);
      }
      await repo.fetch();
      // Main and the round are now the same; keep working from there.
      if (result.commit !== roundHead) {
        await repo.setBranch(round.branch, result.commit, roundHead);
        const text = await repo.readFile(`refs/heads/${round.branch}`, round.doc_path);
        const r = this.round(round.id);
        const changed = text !== r.base_text;
        this.db.update('rounds', round.id, {
          base_text: text, prose_version: r.prose_version + (changed ? 1 : 0), version: r.version + 1, committed_version: r.version + 1,
        });
      }
      this.db.update('rounds', round.id, { merged_at: this.db.now(), merged_commit: result.commit });
      this.addEvent(round, ctx.member, 'merged', { commit: result.commit });
      this.pendingPush.add(project.id);
      return { merged: true, commit: result.commit, fastForward: Boolean(result.fastForward) };
    });
  }

  /**
   * Start the next round of the same paper. People keep their links: each
   * link now opens the new round; the old round stays in the history.
   */
  async nextRound(ctx, { title, memberIds } = {}, baseUrl) {
    this.requireLead(ctx, 'start a new round');
    const round = this.round(ctx.round.id);
    if (round.status !== 'finished') throw new HttpError(409, 'Finish this round first.');
    if (round.next_round_id) throw new HttpError(409, 'A next round has already been started.');
    const project = this.project(round.project_id);
    const repo = this.repoFor(project);
    await this.flush({ force: true });
    await repo.fetch();
    const roundHead = await repo.resolve(`refs/heads/${round.branch}`);
    const mainRef = `refs/remotes/origin/${project.base_branch}`;
    // Start from main when it contains this round (it was merged); otherwise continue from this round.
    const baseRef = (await repo.isAncestor(roundHead, await repo.resolve(mainRef))) ? mainRef : `refs/heads/${round.branch}`;
    const next = await this.startRound(project, { docPath: round.doc_path, title: title || round.title, baseRef, previousRoundId: round.id });
    const keep = memberIds ? new Set(memberIds.map(Number)) : null;
    let leadToken = null;
    for (const m of this.members(round.id)) {
      if (keep && !keep.has(m.id) && m.role !== 'lead') continue;
      const oldToken = m.token;
      this.db.update('members', m.id, { token: token() }); // the old round keeps a private link
      const nm = await this.addMember(next, { name: m.name, email: m.email, role: m.role, tok: oldToken });
      this.db.update('members', nm.id, { seen_prose: m.seen_prose, seen_at: m.seen_at, notices: [{ type: 'new-round', by: ctx.member.name, text: next.title, at: this.db.now() }] });
      if (m.id === ctx.member.id) leadToken = oldToken;
      if (m.role === 'reviewer' && m.email) {
        mail.notify({ to: m.email, ...mail.templates.newRound({ name: m.name, title: next.title, lead: ctx.member.name, link: this.linkFor(baseUrl, nm) }) });
      }
    }
    this.db.update('rounds', round.id, { next_round_id: next.id });
    return { roundId: next.id, token: leadToken, from: baseRef === mainRef ? project.base_branch : round.branch };
  }

  /** Earlier rounds of this paper (lead only), newest first, with read-only links. */
  previousRounds(ctx) {
    this.requireLead(ctx, 'see earlier rounds');
    const out = [];
    let r = this.round(ctx.round.id);
    while (r && r.previous_round_id) {
      r = this.round(r.previous_round_id);
      if (!r) break;
      const lead = this.db.get("SELECT token FROM members WHERE round_id = ? AND role = 'lead' AND active = 1 ORDER BY id LIMIT 1", r.id);
      out.push({ id: r.id, title: r.title, branch: r.branch, finishedAt: r.finished_at, mergedAt: r.merged_at, token: lead?.token || null });
    }
    return out;
  }

  // ------------------------------------------------------------ comments

  async editComments(ctx, fn, message) {
    this.assertOpen(ctx.round);
    return this.withLock(ctx.round.id, async () => {
      const round = this.round(ctx.round.id);
      await this.commitRound(round);
      const meta = metaOf(round.base_text);
      const result = fn(meta);
      const r = this.round(round.id);
      this.db.update('rounds', round.id, { base_text: withMeta(r.base_text, meta), version: r.version + 1, updated_at: this.db.now() });
      if (message) await this.commitRound(round, { author: authorOf(ctx.member), message: typeof message === 'function' ? message(result) : message });
      return result;
    });
  }

  findComment(meta, id) {
    const c = meta.comments.find((x) => x.id === id);
    if (!c) throw new HttpError(404, 'Comment not found');
    return c;
  }

  addComment(ctx, { anchor, text, type }) {
    text = String(text || '').trim();
    if (!text) throw new HttpError(400, 'Write something first.');
    if (text.length > 20000) throw new HttpError(400, 'That comment is too long.');
    const a = anchor || {};
    const clean = { quote: String(a.quote || '').slice(0, 2000), prefix: String(a.prefix || '').slice(0, 64), suffix: String(a.suffix || '').slice(0, 64) };
    const now = this.db.now();
    const isRequest = type === 'reference';
    const comment = { id: 'c' + crypto.randomBytes(5).toString('hex'), ...(isRequest ? { type: 'reference' } : {}), anchor: clean, author: ctx.member.name, created: now, resolved: false, thread: [{ author: ctx.member.name, created: now, text }], agree: [] };
    return this.editComments(ctx, (meta) => { meta.comments.push(comment); return comment; },
      `${isRequest ? 'Reference request' : 'Comment'} by ${ctx.member.name}${clean.quote ? ` on “${snippet(clean.quote, 40)}”` : ''}: ${snippet(text)}`);
  }

  reply(ctx, id, text) {
    text = String(text || '').trim();
    if (!text) throw new HttpError(400, 'Write something first.');
    return this.editComments(ctx, (meta) => {
      const c = this.findComment(meta, id);
      c.thread.push({ author: ctx.member.name, created: this.db.now(), text });
      return c;
    }, `Reply by ${ctx.member.name}: ${snippet(text)}`);
  }

  resolve(ctx, id, resolved) {
    return this.editComments(ctx, (meta) => {
      const c = this.findComment(meta, id);
      if (ctx.member.role !== 'lead' && c.author !== ctx.member.name) throw new HttpError(403, 'Only the lead or the comment\'s author can resolve it.');
      c.resolved = Boolean(resolved);
      return c;
    }, `${ctx.member.name} ${resolved ? 'resolved' : 'reopened'} a comment`);
  }

  /** 👍 is bundled into the next commit instead of making one of its own. */
  agree(ctx, id) {
    return this.editComments(ctx, (meta) => {
      const c = this.findComment(meta, id);
      const i = c.agree.indexOf(ctx.member.name);
      if (i === -1) c.agree.push(ctx.member.name); else c.agree.splice(i, 1);
      return c;
    }, null);
  }

  // ------------------------------------------------------------ syncing with the base branch

  async sync(ctx) {
    this.requireLead(ctx, 'update the round');
    this.assertOpen(ctx.round);
    return this.withLock(ctx.round.id, async () => {
      const round = this.round(ctx.round.id);
      const project = this.project(round.project_id);
      const repo = this.repoFor(project);
      await this.commitRound(round);
      await repo.fetch();
      const result = await repo.mergeInto(round.branch, `refs/remotes/origin/${project.base_branch}`, {
        author: authorOf(ctx.member), message: `Bring in the latest ${project.base_branch}`,
      });
      if (!result.clean) {
        throw new HttpError(409, `The latest ${project.base_branch} changes the same lines as this round (${result.conflicts.join(', ')}). Merge ${round.branch} by hand with your Git tools, or finish this round first.`);
      }
      if (result.upToDate) return { upToDate: true };
      const text = await repo.readFile(`refs/heads/${round.branch}`, round.doc_path);
      const r = this.round(round.id);
      const nb = review.blocksOf(prose(text)).blocks;
      const keys = review.diffBlocks(review.blocksOf(prose(r.base_text)).blocks, nb).flatMap((h) => review.keysOf(nb.slice(h.bStart, h.bEnd)));
      if (keys.length) this.addEvent(round, ctx.member, 'main', { keys });
      this.db.update('rounds', round.id, { base_text: text, prose_version: r.prose_version + 1, version: r.version + 1, committed_version: r.version + 1, updated_at: this.db.now() });
      this.pendingPush.add(project.id);
      return { upToDate: false };
    });
  }

  // ------------------------------------------------------------ history

  async history(ctx) {
    const repo = this.repoFor(ctx.project);
    return repo.log(`refs/heads/${ctx.round.branch}`, ctx.round.doc_path, 200);
  }

  /** What one commit changed in the paper, paragraph by paragraph. */
  async historyDiff(ctx, hash) {
    if (!/^[0-9a-f]{7,40}$/.test(String(hash))) throw new HttpError(400, 'Not a commit');
    const repo = this.repoFor(ctx.project);
    const commit = await repo.resolve(hash);
    const head = await repo.resolve(`refs/heads/${ctx.round.branch}`);
    if (!commit || !(await repo.isAncestor(commit, head))) throw new HttpError(404, 'That version is not part of this round.');
    const after = (await repo.readFile(commit, ctx.round.doc_path)) || '';
    const parent = await repo.resolve(`${commit}^`);
    const before = parent ? ((await repo.readFile(parent, ctx.round.doc_path)) || '') : '';
    const o = review.blocksOf(prose(before)).blocks, n = review.blocksOf(prose(after)).blocks;
    const hunks = review.diffBlocks(o, n);
    const view = await this.views(hunks.flatMap((h) => [...o.slice(h.aStart, h.aEnd), ...n.slice(h.bStart, h.bEnd)]));
    const cb = metaOf(before).comments, ca = metaOf(after).comments;
    const replies = (list) => list.reduce((s, c) => s + c.thread.length, 0);
    return {
      changes: hunks.map((h) => ({ old: o.slice(h.aStart, h.aEnd).map(view), new: n.slice(h.bStart, h.bEnd).map(view) })),
      comments: { before: cb.length, after: ca.length, messagesBefore: replies(cb), messagesAfter: replies(ca) },
    };
  }
}

module.exports = { Quartorium, HttpError };
