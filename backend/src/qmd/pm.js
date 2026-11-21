'use strict';
// Pandoc AST <-> ProseMirror JSON for the prose the editor can change.
//
// Supported blocks: paragraphs, headings, bullet/ordered lists, block quotes,
// horizontal rules. Supported formatting: bold, italic, strikethrough,
// underline, super/subscript, small caps, links, spans with attributes, hard
// line breaks. Anything else inline (citations, cross-references, math, inline
// code, raw markup, images) becomes an "opaque" chip that carries its Pandoc
// AST and is written back unchanged. A prose block containing an unsupported
// block type (table, code block, div, ...) is locked as a whole.

class Unsupported extends Error {}

const EMPTY_ATTR = ['', [], []];
const isEmptyAttr = (a) => !a || (a[0] === '' && a[1].length === 0 && a[2].length === 0);

const SIMPLE_MARKS = {
  Emph: 'italic', Strong: 'bold', Strikeout: 'strike', Underline: 'underline',
  Superscript: 'superscript', Subscript: 'subscript', SmallCaps: 'smallcaps',
};
const MARK_TO_AST = Object.fromEntries(Object.entries(SIMPLE_MARKS).map(([k, v]) => [v, k]));
// Fixed order used when several marks start at the same place.
const MARK_RANK = ['link', 'span', 'bold', 'italic', 'underline', 'strike', 'smallcaps', 'superscript', 'subscript'];

// ---------------------------------------------------------------- AST -> PM

function stringify(inlines) {
  let s = '';
  for (const n of inlines || []) {
    switch (n.t) {
      case 'Str': s += n.c; break;
      case 'Space': case 'SoftBreak': case 'LineBreak': s += ' '; break;
      case 'Code': case 'Math': case 'RawInline': s += n.c[1]; break;
      case 'Quoted': s += (n.c[0].t === 'SingleQuote' ? '‘' : '“') + stringify(n.c[1]) + (n.c[0].t === 'SingleQuote' ? '’' : '”'); break;
      case 'Cite': s += stringify(n.c[1]); break;
      case 'Link': case 'Span': s += stringify(n.c[1]); break;
      case 'Image': s += stringify(n.c[1]); break;
      case 'Note': break;
      default: if (Array.isArray(n.c)) s += stringify(n.c.find(Array.isArray) || []);
    }
  }
  return s;
}

function opaqueLabel(node) {
  switch (node.t) {
    case 'Cite': {
      const ids = node.c[0].map((c) => '@' + c.citationId);
      const inText = node.c[0].length === 1 && node.c[0][0].citationMode.t === 'AuthorInText';
      return inText ? ids[0] : `[${ids.join('; ')}]`;
    }
    case 'Math': return node.c[1];
    case 'Code': return node.c[1];
    case 'RawInline': return node.c[1];
    case 'Image': return stringify(node.c[1]) || node.c[2][0];
    case 'Note': return '*';
    default: return node.t;
  }
}

function text(t, marks) {
  const n = { type: 'text', text: t };
  if (marks.length) n.marks = marks;
  return n;
}

function inlinesToPm(inlines, marks = [], out = []) {
  for (const n of inlines) {
    switch (n.t) {
      case 'Str': out.push(text(n.c, marks)); break;
      case 'Space': case 'SoftBreak': out.push(text(' ', marks)); break;
      case 'LineBreak': out.push({ type: 'hardBreak' }); break;
      case 'Emph': case 'Strong': case 'Strikeout': case 'Underline':
      case 'Superscript': case 'Subscript': case 'SmallCaps':
        inlinesToPm(n.c, [...marks, { type: SIMPLE_MARKS[n.t] }], out); break;
      case 'Span':
        inlinesToPm(n.c[1], isEmptyAttr(n.c[0]) ? marks : [...marks, { type: 'span', attrs: { attr: n.c[0] } }], out); break;
      case 'Link': {
        const attrs = { href: n.c[2][0], title: n.c[2][1] || null };
        if (!isEmptyAttr(n.c[0])) attrs.attr = n.c[0];
        inlinesToPm(n.c[1], [...marks, { type: 'link', attrs }], out); break;
      }
      case 'Quoted': {
        const single = n.c[0].t === 'SingleQuote';
        out.push(text(single ? '‘' : '“', marks));
        inlinesToPm(n.c[1], marks, out);
        out.push(text(single ? '’' : '”', marks));
        break;
      }
      case 'Note':
        throw new Unsupported('Note');
      default: {
        const node = { type: 'opaque', attrs: { kind: n.t, label: opaqueLabel(n), ast: n } };
        if (marks.length) node.marks = marks;
        out.push(node);
      }
    }
  }
  return mergeTexts(out);
}

function sameMarks(a, b) {
  return JSON.stringify(a.marks || []) === JSON.stringify(b.marks || []);
}

function mergeTexts(nodes) {
  const out = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text' && n.type === 'text' && sameMarks(prev, n)) prev.text += n.text;
    else out.push({ ...n });
  }
  return out;
}

function blocksToPm(blocks) {
  return blocks.map((b) => {
    switch (b.t) {
      case 'Para': return { type: 'paragraph', content: inlinesToPm(b.c) };
      case 'Plain': return { type: 'paragraph', attrs: { plain: true }, content: inlinesToPm(b.c) };
      case 'Header': {
        const attrs = { level: b.c[0] };
        if (!isEmptyAttr(b.c[1])) attrs.attr = b.c[1];
        return { type: 'heading', attrs, content: inlinesToPm(b.c[2]) };
      }
      case 'BulletList':
        return { type: 'bulletList', attrs: { tight: isTight(b.c) }, content: b.c.map(listItemToPm) };
      case 'OrderedList': {
        const [[start, style, delim], items] = b.c;
        return { type: 'orderedList', attrs: { start, style: style.t, delim: delim.t, tight: isTight(items) }, content: items.map(listItemToPm) };
      }
      case 'BlockQuote': return { type: 'blockquote', content: blocksToPm(b.c) };
      case 'HorizontalRule': return { type: 'horizontalRule' };
      default: throw new Unsupported(b.t);
    }
  }).map(stripEmptyContent);
}

function stripEmptyContent(node) {
  if (Array.isArray(node.content) && node.content.length === 0) delete node.content;
  return node;
}

function isTight(items) {
  return !items.some((item) => item.some((b) => b.t === 'Para'));
}

function listItemToPm(blocks) {
  const content = blocksToPm(blocks.length ? blocks : [{ t: 'Plain', c: [] }]).map((n) => {
    if (n.type === 'paragraph' && n.attrs) delete n.attrs; // tightness lives on the list
    return n;
  });
  if (content[0].type !== 'paragraph') throw new Unsupported('list item not starting with text');
  return { type: 'listItem', content };
}

// ---------------------------------------------------------------- PM -> AST

function textToAst(t) {
  const out = [];
  for (const part of t.replace(/[\n\r\t]/g, ' ').split(/( +)/)) {
    if (part === '') continue;
    out.push(part.trim() === '' ? { t: 'Space' } : { t: 'Str', c: part });
  }
  return out;
}

const markKey = (m) => JSON.stringify([m.type, m.attrs && (m.type === 'link' ? [m.attrs.href, m.attrs.title || '', m.attrs.attr || null] : m.attrs.attr || null)]);

function wrapperFor(mark, children) {
  if (MARK_TO_AST[mark.type]) return { t: MARK_TO_AST[mark.type], c: children };
  if (mark.type === 'span') return { t: 'Span', c: [mark.attrs?.attr || EMPTY_ATTR, children] };
  if (mark.type === 'link') return { t: 'Link', c: [mark.attrs?.attr || EMPTY_ATTR, children, [mark.attrs?.href || '', mark.attrs?.title || '']] };
  return null;
}

function nodeToAst(n) {
  if (n.type === 'text') return textToAst(n.text || '');
  if (n.type === 'hardBreak') return [{ t: 'LineBreak' }];
  if (n.type === 'opaque' && n.attrs && n.attrs.ast && typeof n.attrs.ast.t === 'string') return [n.attrs.ast];
  return [];
}

function knownMarks(n) {
  return (n.marks || []).filter((m) => m.type === 'link' || m.type === 'span' || MARK_TO_AST[m.type]);
}

/** Convert a run of PM inline nodes to nested Pandoc inlines. */
function pmInlinesToAst(nodes) {
  nodes = nodes || [];
  const root = [];
  const stack = [{ key: null, children: root }];
  nodes.forEach((n, idx) => {
    const marks = n.type === 'hardBreak' ? stack.slice(1).map((s) => s.mark) : knownMarks(n);
    const keys = new Set(marks.map(markKey));
    let keep = 1;
    while (keep < stack.length && keys.has(stack[keep].key)) keep++;
    stack.length = keep;
    const open = marks.filter((m) => !stack.some((s) => s.key === markKey(m)));
    const runLength = (m) => {
      let k = idx;
      while (k < nodes.length && knownMarks(nodes[k]).some((x) => markKey(x) === markKey(m))) k++;
      return k - idx;
    };
    open.sort((a, b) => runLength(b) - runLength(a) || MARK_RANK.indexOf(a.type) - MARK_RANK.indexOf(b.type));
    for (const m of open) {
      const children = [];
      const w = wrapperFor(m, children);
      stack[stack.length - 1].children.push(w);
      stack.push({ key: markKey(m), mark: m, children });
    }
    stack[stack.length - 1].children.push(...nodeToAst(n));
  });
  return normalizeInlines(root);
}

const childList = (n) => (n.t === 'Span' || n.t === 'Link' ? n.c[1] : n.c);
const setChildList = (n, list) => { if (n.t === 'Span' || n.t === 'Link') n.c[1] = list; else n.c = list; };
const WRAPPERS = new Set([...Object.keys(SIMPLE_MARKS), 'Span', 'Link']);

/** Move spaces out of formatting, drop empty formatting, merge adjacent strings. */
function normalizeInlines(list) {
  const out = [];
  const push = (n) => {
    const prev = out[out.length - 1];
    if (n.t === 'Str' && prev && prev.t === 'Str') prev.c += n.c;
    else if (n.t === 'Space' && prev && prev.t === 'Space') { /* collapse */ }
    else out.push(n.t === 'Str' ? { ...n } : n);
  };
  for (const n of list) {
    if (!WRAPPERS.has(n.t)) { push(n); continue; }
    let kids = normalizeInlines(childList(n));
    const lead = [], trail = [];
    if (n.t !== 'Link') {
      while (kids.length && kids[0].t === 'Space') lead.push(kids.shift());
      while (kids.length && kids[kids.length - 1].t === 'Space') trail.push(kids.pop());
    }
    lead.forEach(push);
    if (kids.length) { setChildList(n, kids); push(n); }
    trail.forEach(push);
  }
  return out;
}

function pmBlocksToAst(nodes, tight = false) {
  const out = [];
  for (const n of nodes || []) {
    switch (n.type) {
      case 'paragraph': {
        const inl = pmInlinesToAst(n.content);
        out.push({ t: tight || n.attrs?.plain ? 'Plain' : 'Para', c: inl });
        break;
      }
      case 'heading':
        out.push({ t: 'Header', c: [Math.min(6, Math.max(1, Number(n.attrs?.level) || 1)), n.attrs?.attr || EMPTY_ATTR, pmInlinesToAst(n.content)] });
        break;
      case 'bulletList': {
        const t = n.attrs?.tight !== false;
        out.push({ t: 'BulletList', c: (n.content || []).map((li) => pmBlocksToAst(li.content, t)) });
        break;
      }
      case 'orderedList': {
        const t = n.attrs?.tight !== false;
        const la = [Number(n.attrs?.start) || 1, { t: n.attrs?.style || 'DefaultStyle' }, { t: n.attrs?.delim || 'DefaultDelim' }];
        out.push({ t: 'OrderedList', c: [la, (n.content || []).map((li) => pmBlocksToAst(li.content, t))] });
        break;
      }
      case 'blockquote': out.push({ t: 'BlockQuote', c: pmBlocksToAst(n.content) }); break;
      case 'horizontalRule': out.push({ t: 'HorizontalRule' }); break;
      default: break; // unknown nodes are dropped
    }
  }
  return out;
}

/** Plain text of Pandoc blocks, for showing word-level differences. */
function blocksToPlain(blocks) {
  return (blocks || []).map((b) => {
    switch (b.t) {
      case 'Para': case 'Plain': return stringify(b.c);
      case 'Header': return stringify(b.c[2]);
      case 'BulletList': return b.c.map((item) => '• ' + blocksToPlain(item)).join('\n');
      case 'OrderedList': return b.c[1].map((item, i) => `${b.c[0][0] + i}. ` + blocksToPlain(item)).join('\n');
      case 'BlockQuote': return blocksToPlain(b.c);
      case 'Div': return blocksToPlain(b.c[1]);
      default: return '';
    }
  }).filter((s) => s !== '').join('\n');
}

module.exports = { blocksToPm, pmBlocksToAst, pmInlinesToAst, stringify, blocksToPlain, Unsupported };
