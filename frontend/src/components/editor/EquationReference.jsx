import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React from 'react';

const EquationReferenceComponent = (props) => {
  const { node } = props;
  const { rid, label, originalKey } = node.attrs;

  return (
    <NodeViewWrapper
      as="span"
      className="equation-reference"
      data-rid={rid}
      data-original-key={originalKey}
      style={{
        color: '#dc3545', // Red color for equations
        backgroundColor: '#f8d7da',
        padding: '1px 4px',
        borderRadius: '4px',
        cursor: 'pointer',
        whiteSpace: 'nowrap'
      }}
    >
      {label || rid}
    </NodeViewWrapper>
  );
};

export default Node.create({
  name: 'equationReference',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      rid: {
        default: null,
      },
      label: {
        default: null,
      },
      originalKey: {
        default: null
      }
    };
  },

  parseHTML() {
    return [{ tag: 'span.equation-reference' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'equation-reference' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EquationReferenceComponent);
  },
}); 