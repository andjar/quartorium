'use strict';
// Plain Git, no forge APIs: works with Codeberg/Forgejo, GitLab, GitHub, a
// university server or a bare repo on disk.
//
// Each project is a bare clone. Files are read straight from refs and commits
// are written with Git's plumbing commands (hash-object / write-tree /
// commit-tree / update-ref) using a throw-away index. There is no working
// directory, so concurrent requests can never see each other's checkouts.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

class GitError extends Error {
  constructor(args, code, stderr) {
    super(`git ${args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '--git-dir' && args[i - 1] !== '-c') || ''} failed (${code}): ${stderr.trim()}`);
    this.code = code;
    this.stderr = stderr;
  }
}

const BASE_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes',
  GIT_CONFIG_NOSYSTEM: '1',
  LANG: 'C',
};

function exec(args, { cwd, input, env, allowCodes = [0], binary = false, timeout = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('git', args, { cwd, env: { ...process.env, ...BASE_ENV, ...env } });
    const timer = setTimeout(() => p.kill('SIGKILL'), timeout);
    const out = [], err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out);
      const stderr = Buffer.concat(err).toString('utf8');
      if (!allowCodes.includes(code)) return reject(new GitError(args, code, stderr));
      resolve({ code, stdout: binary ? stdout : stdout.toString('utf8'), stderr });
    });
    if (input !== undefined) p.stdin.end(input);
    else p.stdin.end();
  });
}

/** Strip credentials from a URL for display/logging. */
function redactUrl(url) {
  return String(url).replace(/\/\/[^@/]+@/, '//***@');
}

class Repo {
  /**
   * @param {string} dir path of the bare repository
   * @param {{remoteUrl: string, username?: string, token?: string}} remote
   */
  constructor(dir, remote = {}) {
    this.dir = dir;
    this.remote = remote;
    this.queue = Promise.resolve();
  }

  /** Run fn with exclusive access to this repository. */
  locked(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  authArgs() {
    const { token, username } = this.remote;
    if (!token) return [];
    const basic = Buffer.from(`${username || 'oauth2'}:${token}`).toString('base64');
    return ['-c', `http.extraHeader=Authorization: Basic ${basic}`];
  }

  git(args, opts = {}) {
    return exec(['--git-dir', this.dir, ...args], opts);
  }

  async out(args, opts) {
    return (await this.git(args, opts)).stdout.replace(/\n$/, '');
  }

  async clone() {
    fs.mkdirSync(path.dirname(this.dir), { recursive: true });
    await exec([...this.authArgs(), 'clone', '--bare', '--quiet', this.remote.remoteUrl, this.dir]);
    await this.git(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
    await this.fetch();
  }

  exists() {
    return fs.existsSync(path.join(this.dir, 'HEAD'));
  }

  async fetch() {
    await this.git([...this.authArgs(), 'fetch', '--quiet', '--prune', 'origin']);
  }

  async push(refspecs) {
    if (!config.push || refspecs.length === 0) return;
    await this.git([...this.authArgs(), 'push', '--quiet', '--porcelain', 'origin', ...refspecs]);
  }

  async resolve(ref) {
    const r = await this.git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowCodes: [0, 1, 128] });
    return r.code === 0 ? r.stdout.trim() : null;
  }

  async defaultBranch() {
    const r = await this.git(['symbolic-ref', '--short', 'HEAD'], { allowCodes: [0, 1, 128] });
    return r.code === 0 ? r.stdout.trim() : 'main';
  }

  async readFile(ref, filepath) {
    const r = await this.git(['cat-file', 'blob', `${ref}:${filepath}`], { allowCodes: [0, 128], binary: true });
    return r.code === 0 ? r.stdout.toString('utf8') : null;
  }

  async listFiles(ref) {
    const r = await this.git(['ls-tree', '-r', '-z', '--name-only', ref]);
    return r.stdout.split('\0').filter(Boolean);
  }

  /** Hash of the tree at ref, ignoring one path (used as a render cache key). */
  async treeKeyWithout(ref, ignorePath) {
    const r = await this.git(['ls-tree', '-r', ref]);
    const lines = r.stdout.split('\n').filter((l) => l && !l.endsWith(`\t${ignorePath}`));
    return crypto.createHash('sha1').update(lines.join('\n')).digest('hex');
  }

  async createBranch(branch, fromRef) {
    const commit = await this.resolve(fromRef);
    if (!commit) throw new Error(`Unknown ref ${fromRef}`);
    if (await this.resolve(`refs/heads/${branch}`)) return commit;
    await this.git(['update-ref', `refs/heads/${branch}`, commit, '']);
    return commit;
  }

  /**
   * Commit a single file to a branch without touching any working directory.
   * Returns the new commit id, or the current head when nothing changed.
   */
  async commitFile({ branch, filepath, content, author, message, extraParents = [], allowEmpty = false }) {
    const ref = `refs/heads/${branch}`;
    const parent = await this.resolve(ref);
    if (!parent) throw new Error(`Branch ${branch} does not exist`);
    const blob = (await this.out(['hash-object', '-w', '--stdin'], { input: content }));
    const index = path.join(os.tmpdir(), `quartorium-index-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
    const env = { GIT_INDEX_FILE: index };
    try {
      await this.git(['read-tree', parent], { env });
      const ls = await this.out(['ls-tree', parent, '--', filepath]);
      const mode = ls.split(' ')[0] || '100644';
      await this.git(['update-index', '--add', '--cacheinfo', `${mode},${blob},${filepath}`], { env });
      const tree = await this.out(['write-tree'], { env });
      const parentTree = await this.out(['rev-parse', `${parent}^{tree}`]);
      if (tree === parentTree && extraParents.length === 0 && !allowEmpty) return parent;
      return await this.commitTree({ tree, parents: [parent, ...extraParents], author, message, ref, oldValue: parent });
    } finally {
      fs.rmSync(index, { force: true });
    }
  }

  async commitTree({ tree, parents, author, message, ref, oldValue }) {
    const env = {
      GIT_AUTHOR_NAME: author?.name || config.committerName,
      GIT_AUTHOR_EMAIL: author?.email || config.committerEmail,
      GIT_COMMITTER_NAME: config.committerName,
      GIT_COMMITTER_EMAIL: config.committerEmail,
    };
    const args = ['commit-tree', tree];
    for (const p of parents) args.push('-p', p);
    args.push('-F', '-');
    const commit = await this.out(args, { env, input: message });
    if (ref) await this.git(['update-ref', ref, commit, oldValue]);
    return commit;
  }

  async isAncestor(a, b) {
    return (await this.git(['merge-base', '--is-ancestor', a, b], { allowCodes: [0, 1] })).code === 0;
  }

  /**
   * Merge two commits without a working directory (git >= 2.38) and without
   * moving any branch. Returns { clean, commit } or { clean: false, conflicts }.
   * When one side already contains the other, no merge commit is made.
   */
  async mergeCommits(ours, theirs, { author, message }) {
    if (await this.isAncestor(theirs, ours)) return { clean: true, commit: ours, upToDate: true };
    if (await this.isAncestor(ours, theirs)) return { clean: true, commit: theirs, fastForward: true };
    const r = await this.git(['merge-tree', '--write-tree', '--name-only', ours, theirs], { allowCodes: [0, 1] });
    const lines = r.stdout.split('\n');
    if (r.code === 1) {
      const conflicts = lines.slice(1).filter((l) => l && !l.startsWith('Auto-merging') && !l.startsWith('CONFLICT'));
      return { clean: false, conflicts: [...new Set(conflicts)] };
    }
    const commit = await this.commitTree({ tree: lines[0].trim(), parents: [ours, theirs], author, message });
    return { clean: true, commit };
  }

  /** Merge `theirs` into a local branch. Fast-forwards when possible. */
  async mergeInto(branch, theirs, opts) {
    const ref = `refs/heads/${branch}`;
    const ours = await this.resolve(ref);
    const result = await this.mergeCommits(ours, await this.resolve(theirs), opts);
    if (result.clean && result.commit !== ours) await this.git(['update-ref', ref, result.commit, ours]);
    return result;
  }

  /** Push one commit to a branch on the remote (e.g. a merge into main). */
  async pushCommit(commit, branch) {
    if (!config.push) throw new Error('Pushing is turned off on this server (QUARTORIUM_PUSH=0).');
    await this.git([...this.authArgs(), 'push', '--quiet', '--porcelain', 'origin', `${commit}:refs/heads/${branch}`]);
  }

  async setBranch(branch, commit, oldValue) {
    await this.git(['update-ref', `refs/heads/${branch}`, commit, oldValue]);
  }

  /** Extract the tree of ref into dest (for rendering). */
  async archiveTo(ref, dest) {
    fs.mkdirSync(dest, { recursive: true });
    await new Promise((resolve, reject) => {
      const g = spawn('git', ['--git-dir', this.dir, 'archive', '--format=tar', ref], { env: { ...process.env, ...BASE_ENV } });
      const t = spawn('tar', ['-x', '-C', dest]);
      g.stdout.pipe(t.stdin);
      let err = '';
      g.stderr.on('data', (d) => { err += d; });
      t.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`archive failed: ${err}`))));
      g.on('error', reject);
      t.on('error', reject);
    });
  }

  /**
   * Commits that changed a file, plus Quartorium's own commits (decisions such
   * as rejections or "round finished" change no text but belong to the story).
   */
  async log(ref, filepath, limit = 50) {
    const fmt = '--format=%H%x00%an%x00%aI%x00%s';
    const parse = (out) => out.split('\n').filter(Boolean).map((l) => {
      const [hash, author, date, subject] = l.split('\0');
      return { hash, author, date, subject };
    });
    const touched = await this.git(['log', `-n${limit}`, fmt, ref, '--', filepath], { allowCodes: [0, 128] });
    const ours = await this.git(['log', `-n${limit}`, fmt, `--committer=${config.committerName}`, ref], { allowCodes: [0, 128] });
    const all = new Map([...parse(touched.stdout), ...parse(ours.stdout)].map((c) => [c.hash, c]));
    return [...all.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, limit);
  }
}

module.exports = { Repo, GitError, redactUrl, exec };
