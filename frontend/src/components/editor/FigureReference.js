// src/components/editor/FigureReference.js
import { Node, mergeAttributes } from '@tiptap/core';

export default Node.create({
  name: 'figureReference', // This MUST match the "type" we'll generate in the parser

  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      rid: {
        default: null,
        parseHTML: element => element.getAttribute('data-rid'),
        renderHTML: attributes => ({ 'data-rid': attributes.rid }),
      },
      label: {
        default: '',
        parseHTML: element => element.textContent,
        renderHTML: () => ({}), // Label is rendered as the node's content
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="figure-reference"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'figure-reference' }), node.attrs.label];
  },

  selectable: true,
  draggable: true,
});