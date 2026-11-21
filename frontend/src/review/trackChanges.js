// Inline change marking, computed in the browser from word-level differences.
//
//  - "own":     a reviewer's own edits against the round (live while typing):
//               inserted words highlighted, removed words shown struck through.
//  - "preview": one selected suggestion shown in place (the paper holds the
//               old text; removed words struck, new words as ghost text).
//  - "since":   paragraphs that changed since the last visit (the paper holds
//               the new text), highlighted; the selected one shows its diff.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { diffWordsWithSpace } from 'diff';
import { chipChar, readable, viewText } from './nodesText.js';

export const trackKey = new PluginKey('trackChanges');

/** Top-level nodes grouped by the source block (`seg`) they came from. */
function runsOf(doc) {
  const runs = [];
  doc.forEach((node, pos) => {
    const locked = node.type.name === 'locked';
    const seg = locked ? node.attrs.key : node.attrs.seg;
    const last = runs[runs.length - 1];
    if (!locked && seg && last && !last.locked && last.seg === seg) { last.end = pos + node.nodeSize; last.nodes.push(node); }
    else runs.push({ seg, locked, start: pos, end: pos + node.nodeSize, nodes: [node] });
  });
  return runs;
}

/** Text of a document range with a map from each character to its position (-1 = block break). */
function rangeText(doc, from, to) {
  let text = '';
  const map = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (text.length || map.length) { text += '\n'; map.push(-1); }
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) { for (let k = 0; k < child.text.length; k++) map.push(start + k); text += child.text; }
      else { map.push(start); text += child.type.name === 'opaque' ? chipChar(child.attrs) : ' '; }
    });
    return false;
  });
  return { text, map };
}

const span = (cls, text, title) => {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = readable(text).replace(/\n/g, ' ¶ ');
  if (title) el.title = title;
  return el;
};

const blockWidget = (cls, texts, title) => () => {
  const el = document.createElement('div');
  el.className = cls;
  if (title) el.title = title;
  for (const t of texts) {
    const p = document.createElement('p');
    p.textContent = readable(t);
    el.appendChild(p);
  }
  return el;
};

/**
 * Decorations for the difference between the document range and `other`.
 * docIsNew: the document holds the newer text (own edits, since-last-visit).
 */
function diffDecorations({ text, map }, other, docIsNew, cls, title) {
  const decos = [];
  // Whitespace-exact, so the pieces add up to the texts and positions stay right.
  const parts = docIsNew ? diffWordsWithSpace(other, text) : diffWordsWithSpace(text, other);
  const posAt = (i) => {
    for (let j = i; j < map.length; j++) if (map[j] !== -1) return map[j];
    for (let j = map.length - 1; j >= 0; j--) if (map[j] !== -1) return map[j] + 1;
    return null;
  };
  let i = 0;
  for (const p of parts) {
    const ghost = docIsNew ? p.removed : p.added; // not in the document: drawn as a widget
    const marked = docIsNew ? p.added : p.removed; // in the document and changed
    if (ghost) {
      const at = posAt(i);
      if (at != null && p.value.trim()) decos.push(Decoration.widget(at, () => span(cls.ghost, p.value, title), { side: -1, key: `${cls.ghost}-${at}-${p.value}` }));
      continue;
    }
    if (marked && p.value.trim()) {
      // Mark the characters, split wherever positions are not contiguous (block breaks).
      const push = (a, b) => decos.push(Decoration.inline(a, b, { class: cls.marked, title: title || '' }));
      let from = null, last = null;
      for (let k = i; k < i + p.value.length; k++) {
        const pos = map[k];
        if (pos === -1) { if (from !== null) push(from, last + 1); from = null; continue; }
        if (from !== null && pos === last + 1) { last = pos; continue; }
        if (from !== null) push(from, last + 1);
        from = pos; last = pos;
      }
      if (from !== null) push(from, last + 1);
    }
    i += p.value.length;
  }
  return decos;
}

function build(state, data, loadText) {
  const { doc } = state;
  const decos = [];
  const runs = runsOf(doc);
  const runEnd = (seg) => { const r = runs.filter((x) => x.seg === seg).pop(); return r ? r.end : null; };

  // A reviewer's own edits.
  if (data.own) {
    const hunkOf = new Map();
    for (const h of data.own) for (const k of h.newKeys) hunkOf.set(k, h);
    const present = new Set(runs.map((r) => r.seg));
    let i = 0;
    while (i < runs.length) {
      const r = runs[i];
      if (r.locked) { i++; continue; }
      if (!r.seg) { // a new paragraph written in this session
        decos.push(Decoration.node(r.start, r.end, { class: 'tc-new-block', title: 'Your new text' }));
        i++;
        continue;
      }
      const h = hunkOf.get(r.seg);
      let j = i;
      if (h) while (j + 1 < runs.length && runs[j + 1].seg && hunkOf.get(runs[j + 1].seg) === h) j++;
      const base = h ? h.old.map(viewText).join('\n') : loadText.get(r.seg);
      const cur = rangeText(doc, r.start, runs[j].end);
      if (base !== undefined && cur.text !== base) {
        if (!base) decos.push(Decoration.node(r.start, r.end, { class: 'tc-new-block', title: 'Your new text' }));
        else decos.push(...diffDecorations(cur, base, true, { marked: 'tc-ins', ghost: 'tc-del' }, 'Your edit'));
      }
      i = j + 1;
    }
    // Paragraphs removed (now or earlier in this round).
    for (const h of data.own) {
      if (h.newKeys.length === 0 && h.old.length) {
        const at = h.afterKey ? runEnd(h.afterKey) : 0;
        if (at != null) decos.push(Decoration.widget(at, blockWidget('tc-del-block', h.old.map(viewText), 'You removed this'), { side: 1 }));
      }
    }
    let prevSeg = null;
    for (const [seg, text] of loadText) {
      if (!present.has(seg) && !hunkOf.has(seg) && text) {
        const at = prevSeg ? runEnd(prevSeg) : 0;
        if (at != null) decos.push(Decoration.widget(at, blockWidget('tc-del-block', [text], 'You removed this'), { side: 1 }));
      } else if (present.has(seg)) prevSeg = seg;
    }
  }

  // Paragraphs changed since the last visit.
  for (const c of data.since || []) {
    for (const v of c.new) {
      for (const r of runs.filter((x) => x.seg === v.key)) {
        decos.push(Decoration.node(r.start, r.end, { class: 'tc-since', title: `Changed by ${c.by}` }));
      }
    }
  }

  // One selected change, shown in place.
  const p = data.preview;
  if (p) {
    const inDoc = p.docIsNew ? p.new : p.old;
    const other = p.docIsNew ? p.old : p.new;
    const cls = p.docIsNew ? { marked: 'tc-since-ins', ghost: 'tc-since-del' } : { marked: 'tc-del', ghost: 'tc-ins tc-ghost' };
    const target = runs.filter((r) => inDoc.some((v) => v.key === r.seg));
    if (inDoc.length && target.length) {
      const cur = rangeText(doc, target[0].start, target[target.length - 1].end);
      decos.push(...diffDecorations(cur, other.map(viewText).join('\n'), p.docIsNew, cls, p.title));
      decos.push(Decoration.node(target[0].start, target[0].end, { class: 'tc-preview' }));
    } else if (!inDoc.length && other.length) {
      const at = p.after ? runEnd(p.after) : 0;
      if (at != null) decos.push(Decoration.widget(at, blockWidget(p.docIsNew ? 'tc-del-block' : 'tc-ins-block', other.map(viewText), p.title), { side: 1 }));
    }
  }
  return DecorationSet.create(doc, decos);
}

/**
 * Feed with tr.setMeta(trackKey, { own, since, preview }) (any subset).
 *  own:     [{ newKeys, afterKey, old: [view] }] from the server (reviewers)
 *  since:   [{ by, new: [view], old: [view] }]
 *  preview: { old: [view], new: [view], after, docIsNew, title } | null
 */
export const TrackChanges = Extension.create({
  name: 'trackChanges',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: trackKey,
      state: {
        init: (_, state) => {
          const loadText = new Map();
          for (const r of runsOf(state.doc)) if (r.seg && !r.locked && !loadText.has(r.seg)) loadText.set(r.seg, rangeText(state.doc, r.start, r.end).text);
          return { data: {}, loadText, set: DecorationSet.empty };
        },
        apply(tr, value, _old, state) {
          const meta = tr.getMeta(trackKey);
          if (!meta && !tr.docChanged) return value;
          const data = meta ? { ...value.data, ...meta } : value.data;
          return { ...value, data, set: build(state, data, value.loadText) };
        },
      },
      props: { decorations: (state) => trackKey.getState(state).set },
    })];
  },
});
