'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Repo } = require('../src/git');
const { tmpdir, makeRemote, authorPush, sh } = require('./helpers');

test('clone, branch, commit without checkout, push, merge from main', async () => {
  const r = makeRemote({ 'paper.qmd': 'Hello\n', 'data/x.csv': 'a,b\n' });
  const repo = new Repo(path.join(tmpdir(), 'p.git'), { remoteUrl: r.remote });
  await repo.clone();

  assert.equal(await repo.readFile('refs/remotes/origin/main', 'paper.qmd'), 'Hello\n');
  assert.deepEqual((await repo.listFiles('refs/remotes/origin/main')).sort(), ['data/x.csv', 'paper.qmd']);

  await repo.createBranch('quartorium/round-1', 'refs/remotes/origin/main');
  const c1 = await repo.commitFile({
    branch: 'quartorium/round-1', filepath: 'paper.qmd', content: 'Hello world\n',
    author: { name: 'Anna', email: 'anna@example.org' }, message: 'Edit by Anna',
  });
  // Committing identical content is a no-op.
  const c2 = await repo.commitFile({ branch: 'quartorium/round-1', filepath: 'paper.qmd', content: 'Hello world\n', message: 'noop' });
  assert.equal(c1, c2);

  await repo.push(['refs/heads/quartorium/*:refs/heads/quartorium/*']);
  assert.equal(sh(r.root, '--git-dir', r.remote, 'show', 'quartorium/round-1:paper.qmd'), 'Hello world');
  assert.equal(sh(r.root, '--git-dir', r.remote, 'log', '-1', '--format=%an|%cn', 'quartorium/round-1'), 'Anna|Quartorium');

  // The author keeps working on main; the round can merge it in.
  authorPush(r, { 'data/x.csv': 'a,b\n1,2\n' });
  await repo.fetch();
  const m = await repo.mergeInto('quartorium/round-1', 'refs/remotes/origin/main', { message: 'Merge main' });
  assert.equal(m.clean, true);
  assert.equal(await repo.readFile('refs/heads/quartorium/round-1', 'data/x.csv'), 'a,b\n1,2\n');
  assert.equal(await repo.readFile('refs/heads/quartorium/round-1', 'paper.qmd'), 'Hello world\n');

  // A conflicting change on main is reported, not forced.
  authorPush(r, { 'paper.qmd': 'Hi there\n' });
  await repo.fetch();
  const m2 = await repo.mergeInto('quartorium/round-1', 'refs/remotes/origin/main', { message: 'Merge main' });
  assert.equal(m2.clean, false);
  assert.deepEqual(m2.conflicts, ['paper.qmd']);

  const dest = tmpdir();
  await repo.archiveTo('refs/heads/quartorium/round-1', dest);
  assert.equal(fs.readFileSync(path.join(dest, 'data/x.csv'), 'utf8'), 'a,b\n1,2\n');

  const log = await repo.log('refs/heads/quartorium/round-1', 'paper.qmd');
  assert.equal(log[0].subject, 'Merge main', 'newest first, even within the same second');
  assert.equal(log[1].author, 'Anna');
});
