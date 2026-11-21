// The editor schema. It mirrors backend/src/qmd/pm.js: prose nodes and marks
// the server can write back, plus two kinds of locked content:
//  - `locked` blocks (code chunks, tables, equations, YAML, ...)
//  - `opaque` inline chips (citations, cross-references, math, inline code, ...)
import { Extension, Mark, Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Link from '@tiptap/extension-link';
import katex from 'katex';
import LockedBlockView from './LockedBlockView.jsx';

const SmallCaps = Mark.create({
  name: 'smallcaps',
  parseHTML: () => [{ tag: 'span.smallcaps' }],
  renderHTML: () => ['span', { class: 'smallcaps' }, 0],
});

// [text]{.class key=value}: kept with its Pandoc attributes, shown subtly.
const Span = Mark.create({
  name: 'span',
  addAttributes: () => ({ attr: { default: null, rendered: false } }),
  parseHTML: () => [{ tag: 'span.pd-span' }],
  renderHTML: () => ['span', { class: 'pd-span' }, 0],
});

const QLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
      attr: { default: null, rendered: false },
    };
  },
}).configure({ openOnClick: false, autolink: false, linkOnPaste: true });

// Pandoc details the editor does not show but must keep.
const PandocAttributes = Extension.create({
  name: 'pandocAttributes',
  addGlobalAttributes: () => [
    {
      types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule'],
      attributes: { seg: { default: null, rendered: false } },
    },
    { types: ['paragraph'], attributes: { plain: { default: false, rendered: false } } },
    { types: ['heading'], attributes: { attr: { default: null, rendered: false } } },
    {
      types: ['bulletList', 'orderedList'],
      attributes: { tight: { default: true, rendered: false } },
    },
    {
      types: ['orderedList'],
      attributes: { style: { default: null, rendered: false }, delim: { default: null, rendered: false } },
    },
  ],
});

const LockedBlock = Node.create({
  name: 'locked',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes: () => ({
    key: { default: null }, kind: { default: null }, source: { default: '' },
    label: { default: null }, lang: { default: null }, meta: { default: null },
  }),
  parseHTML: () => [], // locked blocks are never created by pasting
  renderHTML: () => ['div', { 'data-locked': '' }],
  addNodeView: () => ReactNodeViewRenderer(LockedBlockView),
});

function renderChip(dom, attrs) {
  const { kind, label } = attrs;
  dom.className = `chip chip-${kind?.toLowerCase()}`;
  dom.textContent = '';
  if (kind === 'Math') {
    const display = attrs.ast?.c?.[0]?.t === 'DisplayMath';
    try { katex.render(label, dom, { displayMode: display, throwOnError: false }); } catch { dom.textContent = label; }
    dom.title = 'Equation (not editable here)';
  } else if (kind === 'Cite') {
    const isRef = /@(fig|tbl|eq|sec|lst|thm|lem)-/.test(label);
    dom.textContent = label.replace(/^\[|\]$/g, '');
    dom.classList.add(isRef ? 'chip-ref' : 'chip-citation');
    dom.title = isRef ? 'Cross-reference' : 'Citation';
  } else if (kind === 'Code') {
    const code = document.createElement('code');
    code.textContent = label;
    dom.appendChild(code);
    dom.title = /^(r |\{\w+\})/.test(label) ? 'Computed value (from code)' : 'Inline code';
  } else if (kind === 'RawInline' && /^\^\[/.test(label)) {
    dom.textContent = '*';
    dom.classList.add('chip-note');
    dom.title = 'Footnote: ' + label.slice(2, -1);
  } else if (kind === 'RawInline' && /^\[\^/.test(label)) {
    dom.textContent = label.slice(2, -1);
    dom.classList.add('chip-note');
    dom.title = 'Footnote reference';
  } else if (kind === 'Image') {
    dom.textContent = '🖼 ' + (label || 'image');
  } else {
    dom.textContent = label;
    dom.title = 'Kept exactly as written';
  }
}

const Opaque = Node.create({
  name: 'opaque',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ kind: { default: null }, label: { default: '' }, ast: { default: null } }),
  parseHTML: () => [{
    tag: 'span[data-opaque]',
    getAttrs: (el) => { try { return JSON.parse(el.getAttribute('data-opaque')); } catch { return false; } },
  }],
  renderHTML: ({ node }) => ['span', { 'data-opaque': JSON.stringify(node.attrs) }, node.attrs.label || ''],
  addNodeView: () => ({ node }) => {
    const dom = document.createElement('span');
    dom.setAttribute('contenteditable', 'false');
    renderChip(dom, node.attrs);
    return { dom };
  },
});

// Code, figures and tables cannot be deleted, added or moved in the browser:
// the server would refuse such a save anyway.
export const protectKey = new PluginKey('protectLocked');
const lockedSequence = (doc) => {
  const keys = [];
  doc.forEach((n) => { if (n.type.name === 'locked') keys.push(n.attrs.key); });
  return keys.join('|');
};
const ProtectLocked = Extension.create({
  name: 'protectLocked',
  addOptions: () => ({ onBlocked: () => {} }),
  addProseMirrorPlugins() {
    const { onBlocked } = this.options;
    return [new Plugin({
      key: protectKey,
      filterTransaction: (tr, state) => {
        if (!tr.docChanged || tr.getMeta('allowLockedChange')) return true;
        if (lockedSequence(tr.doc) === lockedSequence(state.doc)) return true;
        onBlocked();
        return false;
      },
    })];
  },
});

export function buildExtensions({ onBlocked }) {
  return [
    StarterKit.configure({ code: false, codeBlock: false }),
    Underline, Subscript, Superscript, SmallCaps, Span, QLink,
    PandocAttributes, LockedBlock, Opaque,
    ProtectLocked.configure({ onBlocked }),
  ];
}
