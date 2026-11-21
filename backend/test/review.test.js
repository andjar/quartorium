'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { merge3, changesOf, applyChange, rebaseCopy, blocksOf, keysOf } = require('../src/review');

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
