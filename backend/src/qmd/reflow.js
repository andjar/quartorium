'use strict';
// Keep the author's line breaks in an edited paragraph.
//
// Pandoc writes an edited paragraph on one line. If the original wrapped its
// lines by hand (e.g. one sentence per line), we put the line breaks back
// wherever the words around them are unchanged, so Git diffs only show the
// lines that were really edited.

const { diffArrays } = require('diff');

function tokenize(s) {
  const tokens = [];
  const re = /(\S+)(\s*)/g;
  let m;
  while ((m = re.exec(s))) tokens.push({ word: m[1], space: m[2] });
  return tokens;
}

// A word that would turn into markup at the start of a line.
const UNSAFE_LINE_START = /^([-+*>#|:=~]|\d+[.)]|[a-zA-Z][.)]|\(\w+\)|`{3,}|:{3,}|\$\$|\{\{)/;

function reflow(original, written) {
  if (!original.includes('\n') || written.includes('\n')) return written;
  const a = tokenize(original);
  const b = tokenize(written);
  const changes = diffArrays(a.map((t) => t.word), b.map((t) => t.word));
  // Map each written token to its original token when unchanged.
  const match = new Array(b.length).fill(-1);
  let ia = 0, ib = 0;
  for (const c of changes) {
    if (c.added) { ib += c.count; continue; }
    if (c.removed) { ia += c.count; continue; }
    for (let k = 0; k < c.count; k++) match[ib + k] = ia + k;
    ia += c.count; ib += c.count;
  }
  let out = '';
  b.forEach((t, i) => {
    let space = t.space;
    const ai = match[i];
    const next = b[i + 1];
    if (ai !== -1 && next && a[ai].space.includes('\n') && !/\n\s*\n/.test(a[ai].space) && !UNSAFE_LINE_START.test(next.word)) {
      space = '\n';
    }
    out += t.word + space;
  });
  return out;
}

module.exports = { reflow };
