// Comments are anchored by quoting the text (plus a little context before and
// after), like web annotations. Nothing is inserted into the paper itself.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const ATOM = '￼';

/** Plain text of the document with a map from text offsets to positions. */
export function textIndex(doc) {
  let text = '';
  const map = []; // map[i] = document position of character i (or -1 for block separators)
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (text.length) { text += '\n'; map.push(-1); }
      node.forEach((child, offset) => {
        const start = pos + 1 + offset;
        if (child.isText) {
          for (let k = 0; k < child.text.length; k++) map.push(start + k);
          text += child.text;
        } else {
          map.push(start);
          text += ATOM;
        }
      });
      return false;
    }
    return true;
  });
  return { text, map };
}

const CONTEXT = 32;

/** Build an anchor from a selection. Returns null for an empty selection. */
export function anchorFromSelection(state) {
  const { from, to, empty } = state.selection;
  if (empty) return null;
  const { text, map } = textIndex(state.doc);
  const a = map.findIndex((p) => p >= from);
  let b = map.length;
  for (let i = map.length - 1; i >= 0; i--) { if (map[i] !== -1 && map[i] < to) { b = i + 1; break; } }
  if (a === -1 || b <= a) return null;
  return { quote: text.slice(a, b), prefix: text.slice(Math.max(0, a - CONTEXT), a), suffix: text.slice(b, b + CONTEXT) };
}

/** Anchor on the words just before a position (for notes about a spot, not a selection). */
export function anchorBefore(state, pos) {
  const { text, map } = textIndex(state.doc);
  let i = map.findIndex((p) => p >= pos);
  if (i === -1) i = text.length;
  let start = text.lastIndexOf('\n', i - 1) + 1;
  start = Math.max(start, i - 40, text.lastIndexOf(ATOM, i - 1) + 1); // plain words only, no chips
  const quote = text.slice(start, i).replace(/^\S*\s/, '').trimEnd();
  if (!quote) return { quote: '', prefix: '', suffix: '' };
  const qStart = text.lastIndexOf(quote, i);
  return { quote, prefix: text.slice(Math.max(0, qStart - CONTEXT), qStart), suffix: text.slice(qStart + quote.length, qStart + quote.length + CONTEXT) };
}

function commonSuffix(a, b) { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; }
function commonPrefix(a, b) { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; }

/** Find an anchor in the document: { from, to } or null when the text is gone. */
export function locateAnchor(index, anchor) {
  if (!anchor?.quote) return null;
  const { text, map } = index;
  let best = null;
  for (let i = text.indexOf(anchor.quote); i !== -1; i = text.indexOf(anchor.quote, i + 1)) {
    const score = commonSuffix(text.slice(Math.max(0, i - CONTEXT), i), anchor.prefix || '') + commonPrefix(text.slice(i + anchor.quote.length), anchor.suffix || '');
    if (!best || score > best.score) best = { i, score };
  }
  if (!best) return null;
  const startPos = map[best.i];
  let endIdx = best.i + anchor.quote.length - 1;
  while (endIdx > best.i && map[endIdx] === -1) endIdx--;
  return { from: startPos, to: map[endIdx] + 1 };
}

export const highlightKey = new PluginKey('highlights');

/**
 * Highlights comments and marks paragraphs that have suggested changes.
 * Feed it with: tr.setMeta(highlightKey, { comments, activeComment, changeKeys, activeChange })
 */
export const Highlights = Extension.create({
  name: 'highlights',
  addOptions: () => ({ onCommentClick: () => {}, onChangeClick: () => {} }),
  addProseMirrorPlugins() {
    const options = this.options;
    const build = (doc, data) => {
      const decos = [];
      const located = {};
      const index = textIndex(doc);
      for (const c of data.comments || []) {
        if (c.resolved && c.id !== data.activeComment) continue;
        const r = locateAnchor(index, c.anchor);
        located[c.id] = Boolean(r);
        if (r && r.to > r.from) {
          decos.push(Decoration.inline(r.from, r.to, { class: `comment-mark${c.id === data.activeComment ? ' active' : ''}`, 'data-comment': c.id }));
        }
      }
      const counts = data.changeKeys || {};
      doc.forEach((node, pos) => {
        const key = node.type.name === 'locked' ? node.attrs.key : node.attrs.seg;
        const entry = key && counts[key];
        if (entry) {
          decos.push(Decoration.node(pos, pos + node.nodeSize, {
            class: `has-change${entry.ids.includes(data.activeChange) ? ' active' : ''}`,
            'data-change-count': String(entry.ids.length),
            'data-change-ids': entry.ids.join(','),
          }));
        }
      });
      return { set: DecorationSet.create(doc, decos), located };
    };
    return [new Plugin({
      key: highlightKey,
      state: {
        init: (_, state) => ({ data: {}, ...build(state.doc, {}) }),
        apply(tr, value, _old, state) {
          const data = tr.getMeta(highlightKey);
          if (data) return { data, ...build(state.doc, data) };
          if (tr.docChanged) return { data: value.data, ...build(state.doc, value.data) };
          return value;
        },
      },
      props: {
        decorations: (state) => highlightKey.getState(state).set,
        handleClick: (view, pos, event) => {
          const el = event.target.closest?.('[data-comment]');
          if (el) options.onCommentClick(el.getAttribute('data-comment'));
          return false;
        },
        handleDOMEvents: {
          mousedown: (view, event) => {
            const block = event.target.closest?.('.has-change');
            if (!block) return false;
            const rect = block.getBoundingClientRect();
            if (event.clientX < rect.left) { // click on the margin marker
              options.onChangeClick(block.getAttribute('data-change-ids').split(',')[0]);
              event.preventDefault();
              return true;
            }
            return false;
          },
        },
      },
    })];
  },
});
