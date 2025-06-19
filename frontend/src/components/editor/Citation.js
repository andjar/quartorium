// src/components/editor/Citation.js
import { Node, mergeAttributes } from '@tiptap/core';

export default Node.create({
  name: 'citation', // This MUST match the "type" in your JSON

  group: 'inline', // It's an inline element

  inline: true, // It behaves like a single character

  atom: true, // It should be treated as a single, indivisible unit

  // Define the attributes that match your JSON
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
        renderHTML: attributes => ({}), // The label is the content
      },
    };
  },

  // How to parse this node from HTML
  parseHTML() {
    return [
      {
        tag: 'span[data-type="citation"]',
      },
    ];
  },

  // How to render this node to HTML
  renderHTML({ HTMLAttributes, node }) {
    // We render the label text inside the span
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'citation' }), node.attrs.label];
  },

  // Make it so you can't type inside the citation
  // It's an atom, so this is just for extra safety
  selectable: true,
  draggable: true,
});