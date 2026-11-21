'use strict';
// Review rounds: the whole collaboration flow.
//
//   project  = a Git remote (any host) + base branch
//   round    = one .qmd under review, on branch quartorium/<name>
//   member   = a person with a link: one lead, any number of reviewers
//
// The lead edits the round's text directly and accepts or rejects changes.
// Reviewers edit private copies (each committed to its own branch); their
// edits show up for everyone as changes to the round's text. Comments are
// shared and stored invisibly in the .qmd. Every comment, accept and reject is
// a commit on the round branch with the person as Git author.

const crypto = require('crypto');
const path = require('path');
const config = require('./config');
const { Repo } = require('./git');
const { Renderer } = require('./render');
const { splitQmd } = require('./qmd/blocks');
const { parseQmd, serializeQmd, withMeta, plainTexts, yamlSummary } = require('./qmd/document');
const { emptyMeta } = require('./qmd/meta');
const review = require('./review');

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
      if (!baseBranch) {
        const def = await repo.defaultBranch();
        this.db.update('projects', project.id, { base_branch: def });
      }
      if (!(await repo.resolve(`refs/remotes/origin/${this.project(project.id).base_branch}`))) {
        throw new Error(`Branch "${this.project(project.id).base_branch}" was not found in the repository.`);
      }
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
    const baseRef = `refs/remotes/origin/${project.base_branch}`;
    const text = await repo.readFile(baseRef, docPath);
    if (text == null) throw new HttpError(404, `${docPath} not found on ${project.base_branch}`);
    const date = new Date().toISOString().slice(0, 10);
    const branch = `quartorium/${slug(path.basename(docPath, '.qmd'))}-${date}-${crypto.randomBytes(2).toString('hex')}`;
    await repo.createBranch(branch, baseRef);
    const meta = splitQmd(text).meta;
    const res = this.db.run('INSERT INTO rounds (project_id, doc_path, title, branch, base_text) VALUES (?, ?, ?, ?, ?)',
      project.id, docPath, title || docTitle(text) || docPath, branch, text);
    const round = this.round(Number(res.lastInsertRowid));
    // Migrated legacy comments are written in the new format right away.
    if (meta && !/<!--[ \t]*quartorium/.test(text)) {
      this.db.update('rounds', round.id, { base_text: withMeta(text, meta), version: 2 });
    }
    const lead = await this.addMember(round, { name: leadName, email: leadEmail, role: 'lead' });
    this.pendingPush.add(project.id);
    this.renderInfo(this.round(round.id)).catch(() => {});
    return { round: this.round(round.id), lead };
  }

  async addMember(round, { name, email, role = 'reviewer' }) {
    name = String(name || '').trim();
    if (!name) throw new HttpError(400, 'A name is required.');
    if (!['lead', 'reviewer'].includes(role)) throw new HttpError(400, 'Unknown role.');
    const project = this.project(round.project_id);
    const repo = this.repoFor(project);
    const res = this.db.run('INSERT INTO members (round_id, name, email, role, token, branch, copy_base) VALUES (?, ?, ?, ?, ?, ?, ?)',
      round.id, name, email || null, role, token(), 'pending', prose(round.base_text));
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
    if (m.role === 'lead' && this.members(round.id).filter((x) => x.role === 'lead').length === 1) throw new HttpError(400, 'A round needs at least one lead.');
    await this.withLock(round.id, async () => {
      await this.commitMember(m);
      this.db.update('members', m.id, { active: 0 });
    });
  }

  peopleView(round, viewer) {
    return this.members(round.id).map((m) => ({
      id: m.id, name: m.name, role: m.role, lastSeen: m.last_seen,
      ...(viewer.role === 'lead' ? { token: m.token, email: m.email } : {}),
    }));
  }

  adminRound(roundId) {
    const round = this.round(roundId);
    if (!round) throw new HttpError(404, 'Round not found');
    return {
      id: round.id, title: round.title, docPath: round.doc_path, branch: round.branch, status: round.status,
      people: this.members(round.id).map((m) => ({ id: m.id, name: m.name, role: m.role, token: m.token, lastSeen: m.last_seen })),
    };
  }

  // ------------------------------------------------------------ committing

  /** Commit the round's text if it has uncommitted (lead) edits. Returns the head commit. */
  async commitRound(round, { author, message } = {}) {
    round = this.round(round.id);
    const repo = this.repoFor(this.project(round.project_id));
    if (round.version > round.committed_version || author) {
      const lead = round.dirty_author_id ? this.member(round.dirty_author_id) : null;
      const commit = await repo.commitFile({
        branch: round.branch, filepath: round.doc_path, content: round.base_text,
        author: author || (lead ? authorOf(lead) : null),
        message: message || `Edits by ${lead ? lead.name : 'the lead author'}`,
        allowEmpty: Boolean(author),
      });
      this.db.update('rounds', round.id, { committed_version: round.version, dirty_author_id: null });
      this.pendingPush.add(round.project_id);
      return commit;
    }
    return repo.resolve(`refs/heads/${round.branch}`);
  }

  /** Commit a reviewer's copy to their branch if it changed since the last commit. */
  async commitMember(member) {
    member = this.member(member.id);
    if (member.role !== 'reviewer' || member.copy_rev <= member.committed_rev) return;
    const round = this.round(member.round_id);
    const repo = this.repoFor(this.project(round.project_id));
    await repo.commitFile({
      branch: member.branch, filepath: round.doc_path, content: member.copy_text ?? member.copy_base,
      author: authorOf(member), message: `Changes by ${member.name}`,
      extraParents: member.rebased_onto ? [member.rebased_onto] : [],
    });
    this.db.update('members', member.id, { committed_rev: member.copy_rev, rebased_onto: null });
    this.pendingPush.add(round.project_id);
  }

  /** Commit idle drafts and push. Called periodically and on shutdown. */
  async flush({ force = false } = {}) {
    const cutoff = new Date(Date.now() - config.commitIdleSeconds * 1000).toISOString();
    for (const round of this.db.all('SELECT * FROM rounds WHERE version > committed_version')) {
      if (force || round.updated_at < cutoff) await this.withLock(round.id, () => this.commitRound(round));
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

  // ------------------------------------------------------------ rendering

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
    if (cached) return { key, status: cached.status, error: cached.error || null, outputs: cached.outputs };
    this.renderer.ensure({ repo, ref, docPath: round.doc_path, text: round.base_text, key, force }).catch(() => {});
    return { key, status: 'rendering', error: null, outputs: {} };
  }

  // ------------------------------------------------------------ changes

  /** All reviewers' changes against the round's current text, with plain-text views. */
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
    const all = new Map();
    for (const c of raw) for (const b of [...c.old, ...c.new]) all.set(b.key, b);
    const views = new Map((await plainTexts([...all.values()])).map((v) => [v.key, v]));
    const view = (b) => { const v = views.get(b.key); return { kind: v.kind, locked: v.locked, text: v.text }; };
    return raw.map((c) => {
      let anchor = null;
      if (c.status === 'open') {
        if (c.old.length) anchor = { key: baseBlocks[c.pos].key, after: false };
        else if (c.pos > 0) anchor = { key: baseBlocks[c.pos - 1].key, after: true };
        else if (baseBlocks[0]) anchor = { key: baseBlocks[0].key, after: false };
      }
      return {
        id: c.id, authorId: c.member.id, author: c.member.name, status: c.status, anchor,
        old: c.old.map(view), new: c.new.map(view), raw: c,
      };
    });
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

  async accept(ctx, changeId) {
    if (ctx.member.role !== 'lead') throw new HttpError(403, 'Only the lead can accept changes.');
    return this.withLock(ctx.round.id, async () => {
      const round = this.round(ctx.round.id);
      const c = await this.findChange(round, changeId);
      if (c.status !== 'open') throw new HttpError(409, 'This change is outdated: the text it was based on has changed. Copy what you need by hand, or reject it.');
      await this.commitMember(c.raw.member);
      await this.commitRound(round);
      const meta = metaOf(round.base_text);
      const newText = withMeta(review.applyChange(prose(round.base_text), c.raw), meta);
      const desc = snippet(c.new.map((b) => b.text).join(' ') || c.old.map((b) => b.text).join(' '));
      this.db.update('rounds', round.id, { base_text: newText, prose_version: round.prose_version + 1, version: round.version + 1, updated_at: this.db.now() });
      await this.commitRound(round, {
        author: authorOf(c.raw.member),
        message: `Accept change by ${c.raw.member.name}: “${desc}”\n\nAccepted by ${ctx.member.name} in Quartorium.`,
      });
      const m = this.member(c.raw.member.id);
      this.db.update('members', m.id, { resolved: [...m.resolved, { old: review.keysOf(c.raw.old), new: review.keysOf(c.raw.new), outcome: 'accepted' }] });
      this.addNotice(m.id, { type: 'accepted', by: ctx.member.name, text: desc });
    });
  }

  async reject(ctx, changeId) {
    return this.withLock(ctx.round.id, async () => {
      const round = this.round(ctx.round.id);
      const c = await this.findChange(round, changeId);
      const own = c.raw.member.id === ctx.member.id;
      if (ctx.member.role !== 'lead' && !own) throw new HttpError(403, 'Only the lead (or the person who made it) can reject a change.');
      await this.commitMember(c.raw.member);
      const m = this.member(c.raw.member.id);
      const oldKeys = review.keysOf(c.raw.old), newKeys = review.keysOf(c.raw.new);
      const isOrphan = m.orphans.some((o) => JSON.stringify(review.keysOf(o.old)) === JSON.stringify(oldKeys) && JSON.stringify(review.keysOf(o.new)) === JSON.stringify(newKeys));
      if (isOrphan) {
        this.db.update('members', m.id, { orphans: m.orphans.filter((o) => !(JSON.stringify(review.keysOf(o.old)) === JSON.stringify(oldKeys) && JSON.stringify(review.keysOf(o.new)) === JSON.stringify(newKeys))) });
      } else {
        this.db.update('members', m.id, { resolved: [...m.resolved, { old: oldKeys, new: newKeys, outcome: 'rejected' }] });
      }
      const desc = snippet(c.new.map((b) => b.text).join(' ') || c.old.map((b) => b.text).join(' '));
      await this.commitRound(round);
      await this.commitRound(round, {
        author: authorOf(ctx.member),
        message: own ? `${m.name} withdrew a change: “${desc}”` : `Reject change by ${m.name}: “${desc}”\n\nRejected by ${ctx.member.name} in Quartorium.`,
      });
      if (!own) this.addNotice(m.id, { type: 'rejected', by: ctx.member.name, text: desc });
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

  async load(ctx) {
    return this.withLock(ctx.round.id, async () => {
      if (ctx.member.role === 'reviewer') await this.rebase(ctx.member, ctx.round);
      const { member, round, project } = this.refresh(ctx);
      const text = member.role === 'lead' ? round.base_text : (member.copy_text ?? member.copy_base);
      const parsed = await this.parse(text);
      this.db.update('members', member.id, { last_seen: this.db.now(), notices: [] });
      return {
        me: { id: member.id, name: member.name, role: member.role },
        round: { id: round.id, title: round.title, docPath: round.doc_path, branch: round.branch, project: project.name, baseBranch: project.base_branch, status: round.status },
        doc: parsed.doc,
        rev: member.copy_rev,
        proseVersion: round.prose_version,
        version: round.version,
        comments: metaOf(round.base_text).comments,
        changes: await this.changesView(round),
        people: this.peopleView(round, member),
        render: await this.renderInfo(round),
        notices: member.notices,
        pushError: member.role === 'lead' ? project.push_error : null,
      };
    });
  }

  async activity(ctx, { renderKey } = {}) {
    const { member, round, project } = this.refresh(ctx);
    this.db.update('members', member.id, { last_seen: this.db.now() });
    const render = await this.renderInfo(round);
    if (render.key === renderKey) delete render.outputs;
    return {
      proseVersion: round.prose_version,
      version: round.version,
      comments: metaOf(round.base_text).comments,
      changes: await this.changesView(round),
      people: this.peopleView(round, member),
      render,
      pushError: member.role === 'lead' ? project.push_error : null,
    };
  }

  async save(ctx, { doc, rev, proseVersion }) {
    return this.withLock(ctx.round.id, async () => {
      const { member, round } = this.refresh(ctx);
      if (member.role === 'lead') {
        if (proseVersion !== round.prose_version) throw new HttpError(409, 'The document changed in the meantime.', { reload: true });
        const parsed = await this.parse(round.base_text);
        const text = await serializeQmd(doc, [parsed]);
        if (text !== round.base_text) {
          this.db.update('rounds', round.id, { base_text: text, prose_version: round.prose_version + 1, version: round.version + 1, dirty_author_id: member.id, updated_at: this.db.now() });
        }
        return { proseVersion: this.round(round.id).prose_version };
      }
      if (rev !== member.copy_rev) throw new HttpError(409, 'Your copy was updated in another window.', { reload: true });
      const ref = member.copy_text ?? member.copy_base;
      const contexts = [await this.parse(ref)];
      if (member.copy_text != null) contexts.push(await this.parse(member.copy_base));
      const text = await serializeQmd(doc, contexts, { meta: null });
      const copy = text === member.copy_base ? null : text;
      if (copy !== member.copy_text) {
        this.db.update('members', member.id, { copy_text: copy, copy_rev: member.copy_rev + 1, updated_at: this.db.now() });
      }
      return { rev: this.member(member.id).copy_rev };
    });
  }

  // ------------------------------------------------------------ comments

  async editComments(ctx, fn, message) {
    return this.withLock(ctx.round.id, async () => {
      const round = this.round(ctx.round.id);
      await this.commitRound(round);
      const meta = metaOf(round.base_text);
      const result = fn(meta);
      this.db.update('rounds', round.id, { base_text: withMeta(round.base_text, meta), version: round.version + 1, updated_at: this.db.now() });
      await this.commitRound(round, { author: authorOf(ctx.member), message: typeof message === 'function' ? message(result) : message });
      return result;
    });
  }

  findComment(meta, id) {
    const c = meta.comments.find((x) => x.id === id);
    if (!c) throw new HttpError(404, 'Comment not found');
    return c;
  }

  addComment(ctx, { anchor, text }) {
    text = String(text || '').trim();
    if (!text) throw new HttpError(400, 'Write something first.');
    if (text.length > 20000) throw new HttpError(400, 'That comment is too long.');
    const a = anchor || {};
    const clean = { quote: String(a.quote || '').slice(0, 2000), prefix: String(a.prefix || '').slice(0, 64), suffix: String(a.suffix || '').slice(0, 64) };
    const now = this.db.now();
    const comment = { id: 'c' + crypto.randomBytes(5).toString('hex'), anchor: clean, author: ctx.member.name, created: now, resolved: false, thread: [{ author: ctx.member.name, created: now, text }], agree: [] };
    return this.editComments(ctx, (meta) => { meta.comments.push(comment); return comment; },
      `Comment by ${ctx.member.name}${clean.quote ? ` on “${snippet(clean.quote, 40)}”` : ''}: ${snippet(text)}`);
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

  agree(ctx, id) {
    return this.editComments(ctx, (meta) => {
      const c = this.findComment(meta, id);
      const i = c.agree.indexOf(ctx.member.name);
      if (i === -1) c.agree.push(ctx.member.name); else c.agree.splice(i, 1);
      return c;
    }, (c) => `${ctx.member.name} ${c.agree.includes(ctx.member.name) ? 'agrees with' : 'no longer agrees with'} a comment`);
  }

  // ------------------------------------------------------------ syncing with the base branch

  async sync(ctx) {
    if (ctx.member.role !== 'lead') throw new HttpError(403, 'Only the lead can update the round.');
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
      this.db.update('rounds', round.id, { base_text: text, prose_version: r.prose_version + 1, version: r.version + 1, committed_version: r.version + 1, updated_at: this.db.now() });
      this.pendingPush.add(project.id);
      return { upToDate: false };
    });
  }

  async history(ctx) {
    const repo = this.repoFor(ctx.project);
    return repo.log(`refs/heads/${ctx.round.branch}`, ctx.round.doc_path, 100);
  }
}

module.exports = { Quartorium, HttpError };
