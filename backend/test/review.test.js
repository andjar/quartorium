'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { merge3, mergeQmd, changesOf, applyChange, rebaseCopy, blocksOf, keysOf } = require('../src/review');
const { extractMeta, injectMeta } = require('../src/qmd/meta');

const doc = (...paras) => paras.join('\n\n') + '\n';
const B = (text) => blocksOf(text).blocks;
const texts = (items) => items.map((b) => b.source);

test('merge3 applies non-overlapping edits from both sides, adjacent ones too', () => {
  const o = B(doc('p1', 'p2', 'p3', 'p4'));
  const a = B(doc('p1', 'p2', 'p3 mine', 'p4'));
  const b = B(doc('p1', 'p2 theirs', 'p3', 'p4', 'p5'));
  const { items, conflicts } = merge3(o, a, b);
  assert.deepEqual(texts(items), ['p1', 'p2 theirs', 'p3 mine', 'p4', 'p5']);
  assert.deepEqual(conflicts, []);
});

test('merge3 lets the base win on overlap and reports the conflict', () => {
  const o = B(doc('p1', 'p2', 'p3'));
  const a = B(doc('p1', 'p2 mine', 'p3'));
  const b = B(doc('p1', 'p2 theirs', 'p3'));
  const { items, conflicts } = merge3(o, a, b);
  assert.deepEqual(texts(items), ['p1', 'p2 theirs', 'p3']);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(texts(conflicts[0].new), ['p2 mine']);
});

test('merge3 identical edits on both sides are not a conflict', () => {
  const o = B(doc('p1', 'p2'));
  const a = B(doc('p1', 'same'));
  const { items, conflicts } = merge3(o, a, a);
  assert.deepEqual(texts(items), ['p1', 'same']);
  assert.deepEqual(conflicts, []);
});

test('changes are located in a base that moved on, and can be applied', () => {
  const copyBase = doc('Intro', 'Methods old', 'Results', 'End');
  const copy = doc('Intro', 'Methods new', 'Results', 'Inserted', 'End');
  const base = doc('Preface', 'Intro', 'Methods old', 'Results', 'End'); // lead added a block on top
  const changes = changesOf({ memberId: 1, copyBase, copy, base });
  assert.equal(changes.length, 2);
  assert.deepEqual(changes.map((c) => c.status), ['open', 'open']);
  assert.deepEqual(changes.map((c) => c.pos), [2, 4]);
  const after = applyChange(applyChange(base, changes[1]), changes[0]);
  assert.equal(after, doc('Preface', 'Intro', 'Methods new', 'Results', 'Inserted', 'End'));
});

test('a change whose paragraph was rewritten meanwhile is outdated', () => {
  const copyBase = doc('A', 'B', 'C');
  const copy = doc('A', 'B by Anna', 'C');
  const base = doc('A', 'B by Bob', 'C');
  const [c] = changesOf({ memberId: 1, copyBase, copy, base });
  assert.equal(c.status, 'outdated');
});

test('resolved changes are hidden; rebasing reverts rejected ones and keeps the rest', () => {
  const copyBase = doc('A', 'B', 'C', 'D');
  const copy = doc('A', 'B2', 'C', 'D2');
  const base = doc('A', 'B', 'C', 'D');
  const changes = changesOf({ memberId: 7, copyBase, copy, base });
  const rejected = { old: keysOf(changes[0].old), new: keysOf(changes[0].new), outcome: 'rejected' };
  assert.equal(changesOf({ memberId: 7, copyBase, copy, base, resolved: [rejected] }).length, 1);

  // Meanwhile the lead accepted D2 and edited A.
  const newBase = doc('A edited', 'B', 'C', 'D2');
  const { copy: rebased, conflicts } = rebaseCopy({ copyBase, copy, base: newBase, rejected: [rejected] });
  assert.equal(rebased, doc('A edited', 'B', 'C', 'D2'));
  assert.deepEqual(conflicts, []);
});

// ---------------------------------------------------------------- merging main and a round

const comment = (id, text, extra = {}) => ({ id, anchor: { quote: 'p', prefix: '', suffix: '' }, author: 'A', created: `2026-01-0${id.slice(-1)}T00:00:00.000Z`, resolved: false, thread: [{ author: 'A', created: `2026-01-0${id.slice(-1)}T00:00:00.000Z`, text }], agree: [], ...extra });
const withComments = (text, comments) => injectMeta(text, { comments });
const commentsOf = (text) => (extractMeta(text).meta || { comments: [] }).comments;

test('mergeQmd: the last paragraph edited on main and a new comment in the round merge cleanly', () => {
  const base = doc('# Title', 'p1', 'Closing.');
  const round = withComments(doc('# Title', 'p1 accepted', 'Closing.'), [comment('c1', 'a remark')]);
  const main = doc('# Title', 'p1', 'Closing, extended in RStudio.', 'A new last paragraph.');
  const { text, conflicts } = mergeQmd(base, round, main);
  assert.deepEqual(conflicts, []);
  assert.match(text, /^# Title\n\np1 accepted\n\nClosing, extended in RStudio\.\n\nA new last paragraph\.\n\n<!-- quartorium\n/);
  assert.deepEqual(commentsOf(text).map((c) => c.id), ['c1']);
});

test('mergeQmd: the same paragraph changed on both sides keeps main and reports the other version', () => {
  const base = doc('p1', 'p2', 'p3');
  const { text, conflicts } = mergeQmd(base, doc('p1', 'p2 round', 'p3'), doc('p1', 'p2 main', 'p3'));
  assert.equal(text, doc('p1', 'p2 main', 'p3'));
  assert.equal(conflicts.length, 1);
  assert.deepEqual(texts(conflicts[0].new), ['p2 round']);
  assert.deepEqual(texts(conflicts[0].theirs), ['p2 main']);
});

test('mergeQmd: paragraphs added at the same place on both sides are both kept', () => {
  const { text, conflicts } = mergeQmd(doc('p1', 'p2'), doc('p1', 'from round', 'p2'), doc('p1', 'from main', 'p2'));
  assert.equal(text, doc('p1', 'from main', 'from round', 'p2'));
  assert.deepEqual(conflicts, []);
});

test('mergeQmd: comment threads are merged by id', () => {
  const c1 = comment('c1', 'first');
  const base = withComments(doc('p1'), [c1, comment('c2', 'will be cleaned up')]);
  const round = withComments(doc('p1'), [
    { ...c1, thread: [...c1.thread, { author: 'B', created: '2026-01-05T00:00:00.000Z', text: 'reply in round' }] },
    comment('c2', 'will be cleaned up'),
    comment('c3', 'new in round'),
  ]);
  const main = withComments(doc('p1 edited'), [{ ...c1, agree: ['C'] }, comment('c4', 'new on main')]);
  const { text } = mergeQmd(base, round, main);
  const merged = commentsOf(text);
  assert.deepEqual(merged.map((c) => c.id), ['c1', 'c3', 'c4']);
  assert.deepEqual(merged[0].thread.map((m) => m.text), ['first', 'reply in round']);
  assert.deepEqual(merged[0].agree, ['C']);
  assert.match(text, /^p1 edited\n/);
});

test('mergeQmd keeps Windows line endings', () => {
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  const { text } = mergeQmd(crlf(doc('p1', 'p2')), crlf(doc('p1 round', 'p2')), crlf(doc('p1', 'p2 main')));
  assert.equal(text, crlf(doc('p1 round', 'p2 main')));
});
