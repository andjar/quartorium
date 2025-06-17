import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import QuartoBlockNodeView from './QuartoBlockNodeView';

export default Node.create({
  name: 'quartoBlock',
  group: 'block',
  atom: true, // This makes it a single, non-editable unit

  addAttributes() {
    return {
      code: { default: '' },
      chunkOptions: { default: '' },
      htmlOutput: { default: '<div>Loading...</div>' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="quarto-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'quarto-block' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(QuartoBlockNodeView);
  },
});