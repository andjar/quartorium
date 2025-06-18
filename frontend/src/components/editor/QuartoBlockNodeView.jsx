import React from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import './QuartoBlockNodeView.css';

const QuartoBlockNodeView = ({ node }) => {
  const { code, htmlOutput, figId, figCaption, figLabel } = node.attrs;

  // Determine if this block represents a figure.
  // We check for htmlOutput that contains an <img> tag and a figCaption.
  const isFigure = htmlOutput && htmlOutput.includes('<img') && figCaption;

  return (
    <NodeViewWrapper className="quarto-block">
      <div className="quarto-block-header">
        {/* We can improve how code/options are displayed later */}
        <span>{code ? `{r}` : '{figure}'}</span>
      </div>
      <div className="quarto-block-content-wrapper">
        {isFigure ? (
          <figure id={figId} className="quarto-figure">
            <div
              className="quarto-block-output"
              dangerouslySetInnerHTML={{ __html: htmlOutput }}
            />
            <figcaption>
              <span className="figure-label">{figLabel}:</span> {figCaption}
            </figcaption>
          </figure>
        ) : (
          <div
            className="quarto-block-output"
            dangerouslySetInnerHTML={{ __html: htmlOutput }}
          />
        )}
         {code && (
          <div className="quarto-block-code">
            <pre><code>{code}</code></pre>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
};

export default QuartoBlockNodeView;