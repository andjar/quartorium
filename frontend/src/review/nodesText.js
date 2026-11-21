// Text versions of editor content for word-level comparison. Each chip
// (citation, math, ...) becomes one private-use character, so it compares as a
// single "word" and is drawn again as its label.
import { citeLabel } from './chipLabels.js';

const chipChars = new Map(); // JSON(ast) -> char
const chipAttrs = new Map(); // char -> attrs
let next = 0xe000;

export function chipChar(attrs) {
  const key = JSON.stringify(attrs?.ast ?? attrs?.label ?? '');
  let ch = chipChars.get(key);
  if (!ch) {
    ch = String.fromCharCode(next++);
    chipChars.set(key, ch);
    chipAttrs.set(ch, attrs);
  }
  return ch;
}

export const isChipChar = (ch) => chipAttrs.has(ch);

export function chipLabel(ch) {
  const attrs = chipAttrs.get(ch);
  if (!attrs) return ch;
  return attrs.kind === 'Cite' ? citeLabel(attrs.ast).text : attrs.label || '';
}

/** Replace chip characters by their labels (for plain display). */
export const readable = (s) => [...s].map((c) => (isChipChar(c) ? chipLabel(c) : c)).join('');

/** Text of ProseMirror JSON nodes (one string; blocks separated by newlines). */
export function nodesText(nodes) {
  const parts = [];
  const walk = (list) => {
    for (const n of list || []) {
      if (n.type === 'text') parts[parts.length - 1] += n.text;
      else if (n.type === 'opaque') parts[parts.length - 1] += chipChar(n.attrs);
      else if (n.type === 'hardBreak') parts[parts.length - 1] += ' ';
      else if (['paragraph', 'heading'].includes(n.type)) { parts.push(''); walk(n.content); }
      else walk(n.content);
    }
  };
  walk(nodes);
  return parts.join('\n');
}

/** Text of a block view from the server: its nodes, or the label of a locked block. */
export const viewText = (v) => (v?.nodes ? nodesText(v.nodes) : v?.text || '');
