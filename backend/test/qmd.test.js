'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { splitQmd, joinBlocks } = require('../src/qmd/blocks');
const { parseQmd, serializeQmd, withMeta } = require('../src/qmd/document');
const { protect } = require('../src/qmd/protect');

const paper = fs.readFileSync(path.join(__dirname, 'fixtures/paper.qmd'), 'utf8');
const rejoin = (s) => s.lead + s.blocks.map((b) => b.source + b.sep).join('');

// Helpers to simulate what the browser sends back.
const clone = (x) => JSON.parse(JSON.stringify(x));
function findNode(doc, pred) {
  let found = null;
  (function walk(nodes) { for (const n of nodes || []) { if (!found && pred(n)) found = n; walk(n.content); } })(doc.content);
  return found;
}
const textOf = (n) => (n.content || []).map((c) => c.text || (c.content ? textOf(c) : '')).join('');

test('splitting is lossless', () => {
  for (const s of [paper, '', '\n\n', 'one line', 'a\n\n\nb\n', paper.replace(/\n/g, '\r\n')]) {
    const split = splitQmd(s);
    const back = rejoin(split);
    assert.equal(split.eol === '\r\n' ? back.replace(/\n/g, '\r\n') : back, s);
  }
});

test('blocks are classified', () => {
  const kinds = splitQmd(paper).blocks.map((b) => b.kind);
  assert.equal(kinds[0], 'yaml');
  for (const k of ['chunk', 'table', 'math', 'div', 'comment', 'shortcode', 'code', 'def']) assert.ok(kinds.includes(k), k);
  const chunk = splitQmd(paper).blocks.find((b) => b.kind === 'chunk');
  assert.equal(chunk.label, 'fig-mpg');
  assert.equal(chunk.lang, 'python');
  const table = splitQmd(paper).blocks.find((b) => b.kind === 'table');
  assert.match(table.source, /\{#tbl-cars\}$/, 'caption belongs to the table');
});

test('opening and saving without edits gives an identical file', async () => {
  const parsed = await parseQmd(paper);
  const out = await serializeQmd(clone(parsed.doc), [parsed]);
  assert.equal(out, paper);
});

test('round trip with browser-style default attributes still identical', async () => {
  const parsed = await parseQmd(paper);
  const doc = clone(parsed.doc);
  // TipTap adds default attributes everywhere.
  (function walk(nodes) {
    for (const n of nodes || []) {
      if (n.type === 'paragraph') n.attrs = { plain: false, ...(n.attrs || {}) };
      if (n.type === 'heading') n.attrs = { attr: null, ...n.attrs };
      for (const m of n.marks || []) if (m.type === 'link') m.attrs = { target: '_blank', rel: 'noopener', class: null, ...m.attrs };
      walk(n.content);
    }
  })(doc.content);
  assert.equal(await serializeQmd(doc, [parsed]), paper);
});

test('editing one paragraph rewrites only that paragraph', async () => {
  const parsed = await parseQmd(paper);
  const doc = clone(parsed.doc);
  const p = findNode(doc, (n) => n.type === 'paragraph' && textOf(n).startsWith('Cars are'));
  p.content[0].text = 'Automobiles are ';
  const out = await serializeQmd(doc, [parsed]);
  const before = paper.split('\n'), after = out.split('\n');
  assert.ok(out.includes('Automobiles are *everywhere*, and **fuel efficiency** matters (a lot).'));
  assert.ok(out.includes('(a lot)'), 'parentheses survive');
  assert.ok(out.includes('[@smith2020, p. 3; @doe2019]'), 'citation survives');
  assert.ok(out.includes('`r nrow(mtcars)`'), 'inline code survives');
  assert.ok(out.includes('$E = mc^2$'), 'inline math survives');
  // Everything outside the edited paragraph is untouched.
  const untouchedStart = paper.indexOf('A second paragraph');
  assert.equal(out.slice(out.indexOf('A second paragraph')), paper.slice(untouchedStart));
  assert.ok(after.length <= before.length);
});

test('an edit keeps the author\'s line breaks, so the diff is one line', async () => {
  const parsed = await parseQmd(paper);
  const doc = clone(parsed.doc);
  const p = findNode(doc, (n) => n.type === 'paragraph' && textOf(n).startsWith('Cars are'));
  const t = p.content.find((c) => c.type === 'text' && c.text.includes('wraps lines by hand'));
  t.text = t.text.replace('wraps lines by hand', 'wraps lines manually');
  const out = await serializeQmd(doc, [parsed]);
  const a = paper.split('\n'), b = out.split('\n');
  assert.equal(a.length, b.length);
  const changed = a.map((l, i) => (l === b[i] ? null : [l, b[i]])).filter(Boolean);
  assert.deepEqual(changed, [['and wraps lines by hand -- like many authors do.', 'and wraps lines manually -- like many authors do.']]);
});

test('protected inline syntax survives an edit', async () => {
  const parsed = await parseQmd(paper);
  const doc = clone(parsed.doc);
  const p = findNode(doc, (n) => n.type === 'paragraph' && textOf(n).startsWith('A second'));
  p.content[0].text = 'An edited paragraph with a footnote';
  const out = await serializeQmd(doc, [parsed]);
  for (const s of ['[^long]', '^[Inline notes are handy.]', '{{< meta title >}}', '[reference link][quarto]', '~~deleted~~', 'H~2~O', 'x^2^', '[small caps]{.smallcaps}', 'data-x="1"', '<https://quarto.org>']) {
    assert.ok(out.includes(s), `missing ${s} in:\n${out.slice(0, 1500)}`);
  }
});

test('locked blocks cannot be removed or injected', async () => {
  const parsed = await parseQmd(paper);
  const doc = clone(parsed.doc);
  doc.content = doc.content.filter((n) => !(n.type === 'locked' && n.attrs.kind === 'chunk'));
  await assert.rejects(serializeQmd(doc, [parsed]), /Locked blocks/);

  // Changing a locked block's source in the browser has no effect.
  const doc2 = clone(parsed.doc);
  const chunk = doc2.content.find((n) => n.type === 'locked' && n.attrs.kind === 'chunk');
  chunk.attrs.source = '```{python}\nimport os; os.system("rm -rf /")\n```';
  const out = await serializeQmd(doc2, [parsed]);
  assert.equal(out, paper);
});

test('typed markdown and fake chips are neutralised', async () => {
  const parsed = await parseQmd(paper);
  const doc = clone(parsed.doc);
  const p = findNode(doc, (n) => n.type === 'paragraph' && textOf(n).startsWith('Cars are'));
  p.content = [
    { type: 'text', text: '```{r} system("x") {{< include secret.qmd >}} `r 1+1` ' },
    { type: 'opaque', attrs: { kind: 'Code', label: 'r Sys.time()', ast: { t: 'Code', c: [['', [], []], 'r system("whoami")'] } } },
  ];
  const out = await serializeQmd(doc, [parsed]);
  assert.ok(!out.includes('`r system'), 'injected inline code is not executable');
  assert.ok(!out.includes('{{< include secret'), 'typed shortcode is escaped');
  assert.ok(!/^```\{r\}/m.test(out.split('## Introduction')[1].split('```{python}')[0]), 'typed chunk is escaped');
});

test('new paragraphs, splits and formatting', async () => {
  const parsed = await parseQmd(paper);
  const doc = clone(parsed.doc);
  const idx = doc.content.findIndex((n) => n.type === 'heading');
  doc.content.splice(idx + 1, 0, {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'New ' },
      { type: 'text', text: 'bold ', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'and link', marks: [{ type: 'link', attrs: { href: 'https://example.org' } }] },
      { type: 'text', text: '.' },
    ],
  });
  const out = await serializeQmd(doc, [parsed]);
  assert.ok(out.includes('## Introduction {#sec-intro}\n\nNew **bold** [and link](https://example.org).\n\nCars are'), out.slice(0, 800));
});

test('comments block is invisible markup and round-trips', async () => {
  const meta = { comments: [{ id: 'c1', anchor: { quote: 'fuel efficiency', prefix: '', suffix: '' }, author: 'Anna', created: '2026-01-01T00:00:00Z', resolved: false, thread: [{ author: 'Anna', created: '2026-01-01T00:00:00Z', text: 'Is this --> safe? <!-- yes' }], agree: [] }] };
  const text = withMeta(paper, meta);
  assert.ok(text.startsWith(paper.trimEnd()));
  assert.ok(/<!-- quartorium\n[\s\S]*\n-->\n$/.test(text));
  assert.equal(text.match(/-->/g).length, paper.match(/-->/g).length + 1, 'payload cannot close the comment');
  const parsed = await parseQmd(text);
  assert.deepEqual(parsed.meta.comments[0].thread[0].text, 'Is this --> safe? <!-- yes');
  assert.equal(await serializeQmd(clone(parsed.doc), [parsed]), text);
  assert.equal(withMeta(text, null), paper);
});

test('legacy comment appendix is migrated', async () => {
  const legacy = 'Some [commented text]{.comment ref="c-1"} here.\n\n<!-- Comments Appendix -->\n<div id="quartorium-comments" style="display:none;">\n```json\n{"comments":[{"id":"c-1","author":"Bob","timestamp":"2025-01-01","status":"open","thread":[{"text":"Hm?","author":"Bob","timestamp":"2025-01-01"}]}]}\n```\n</div>\n';
  const parsed = await parseQmd(legacy);
  assert.equal(parsed.meta.comments[0].anchor.quote, 'commented text');
  const out = await serializeQmd(clone(parsed.doc), [parsed]);
  assert.ok(out.startsWith('Some commented text here.\n\n<!-- quartorium'));
});

test('protect skips inline code', () => {
  assert.equal(protect('`{{< x >}}` and {{< y >}}'), '`{{< x >}}` and `{{< y >}}`{=markdown}');
});

test('joinBlocks keeps a blank line when neighbours change', () => {
  const s = splitQmd('$$\nx\n$$\nwhere x is\n\n# H\n');
  assert.equal(s.blocks[0].sep, '\n');
  const items = [s.blocks[0], s.blocks[2]];
  assert.equal(joinBlocks(s.lead, items), '$$\nx\n$$\n\n# H\n');
});

test('spans without attributes and links without targets do not leave brackets', async () => {
  const parsed = await parseQmd('Hello world.\n');
  const doc = clone(parsed.doc);
  doc.content[0].content = [
    { type: 'text', text: 'Hello ', marks: [{ type: 'span', attrs: { attr: null } }] },
    { type: 'text', text: 'world', marks: [{ type: 'link', attrs: { href: '' } }] },
    { type: 'text', text: ' again.' },
  ];
  assert.equal(await serializeQmd(doc, [parsed]), 'Hello world again.\n');
});

test('new citations are accepted for known keys only, with locators and modes', async () => {
  const parsed = await parseQmd('See the data.\n');
  const cite = (id, mode = 'NormalCitation', suffix = []) => ({
    type: 'opaque',
    attrs: { kind: 'Cite', label: id, ast: { t: 'Cite', c: [[{ citationId: id, citationPrefix: [], citationSuffix: suffix, citationMode: { t: mode }, citationNoteNum: 0, citationHash: 0 }], [{ t: 'Str', c: 'x' }]] } },
  });
  const doc = clone(parsed.doc);
  doc.content[0].content = [
    { type: 'text', text: 'See ' },
    cite('smith2020', 'NormalCitation', [{ t: 'Str', c: ',' }, { t: 'Space' }, { t: 'Str', c: 'p.' }, { t: 'Space' }, { t: 'Str', c: '3' }]),
    { type: 'text', text: ', ' },
    cite('doe2019', 'AuthorInText'),
    { type: 'text', text: ', ' },
    cite('fig-mpg', 'AuthorInText'),
    { type: 'text', text: ' and ' },
    cite('unknown2000'),
    { type: 'text', text: '.' },
  ];
  const out = await serializeQmd(doc, [parsed], { citeIds: new Set(['smith2020', 'doe2019', 'fig-mpg']) });
  assert.equal(out, 'See [@smith2020, p. 3], @doe2019, @fig-mpg and unknown2000.\n');
  // Without a list of known keys, nothing new gets in.
  const out2 = await serializeQmd(doc, [parsed]);
  assert.ok(!out2.includes('[@smith2020'));
});
