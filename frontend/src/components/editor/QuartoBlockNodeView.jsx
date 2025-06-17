import React from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import './QuartoBlockNodeView.css';

const QuartoBlockNodeView = ({ node }) => {
  const { code, chunkOptions, htmlOutput } = node.attrs;

  return (
    <NodeViewWrapper className="quarto-block">
      <div className="quarto-block-header">
        <span>{`{${chunkOptions}}`}</span>
      </div>
      <div
        className="quarto-block-output"
        dangerouslySetInnerHTML={{ __html: htmlOutput }}
      />
    </NodeViewWrapper>
  );
};

export default QuartoBlockNodeView;