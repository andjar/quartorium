'use strict';
// Test helpers: a throw-away "remote" repository on disk.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function tmpdir(prefix = 'qtm-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'Author', GIT_AUTHOR_EMAIL: 'author@example.org', GIT_COMMITTER_NAME: 'Author', GIT_COMMITTER_EMAIL: 'author@example.org', GIT_CONFIG_NOSYSTEM: '1' };
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();

/** Create a bare "remote" with one commit containing `files` on branch main. */
function makeRemote(files) {
  const root = tmpdir();
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  sh(root, 'init', '--quiet', '--bare', '-b', 'main', remote);
  sh(root, 'clone', '--quiet', remote, work);
  sh(work, 'checkout', '--quiet', '-b', 'main');
  writeFiles(work, files);
  sh(work, 'add', '-A');
  sh(work, 'commit', '--quiet', '-m', 'initial');
  sh(work, 'push', '--quiet', 'origin', 'main');
  return { root, remote, work, sh: (...a) => sh(work, ...a) };
}

function writeFiles(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
}

/** Commit and push changes to the remote's main branch, as the author would from RStudio. */
function authorPush(r, files, message = 'author change') {
  r.sh('pull', '--quiet', 'origin', 'main');
  writeFiles(r.work, files);
  r.sh('add', '-A');
  r.sh('commit', '--quiet', '-m', message);
  r.sh('push', '--quiet', 'origin', 'main');
}

module.exports = { tmpdir, makeRemote, authorPush, sh };
