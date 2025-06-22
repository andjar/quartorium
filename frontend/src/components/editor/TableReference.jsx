import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React from 'react';

const TableReferenceComponent = (props) => {
  const { node } = props;
  const { rid, label, originalKey } = node.attrs;

  return (
    <NodeViewWrapper
      as="span"
      className="table-reference"
      data-rid={rid}
      data-original-key={originalKey}
      style={{
        color: '#28a745', // Green color for tables
        backgroundColor: '#eaf6ec',
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
  name: 'tableReference',
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
    return [{ tag: 'span.table-reference' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'table-reference' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableReferenceComponent);
  },
}); 