import React, { useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import './QuartoBlockNodeView.css';

const QuartoBlockNodeView = ({ node }) => {
  // Destructure all potential attributes, including the new 'language'
  const { code, language, htmlOutput, figId, figCaption, figLabel } = node.attrs;
  const [isCodeVisible, setIsCodeVisible] = useState(false); // Default to hidden

  // The presence of a `figLabel` is the most reliable indicator of a figure.
  const isFigure = !!figLabel;

  const toggleCodeVisibility = () => {
    setIsCodeVisible(!isCodeVisible);
  };

  return (
    <NodeViewWrapper className="quarto-block-wrapper">
      <div className="quarto-block">
        
        {/* Render header and toggle button only if there is code */}
        {code && (
          <div className="quarto-block-header">
            <span>{`{${language || 'code'}}`}</span>
            <button onClick={toggleCodeVisibility} className="code-toggle-button">
              {isCodeVisible ? 'Hide Code' : 'Show Code'}
            </button>
          </div>
        )}

        {/* Render code block only if it exists and is set to be visible */}
        {code && isCodeVisible && (
          <div className="quarto-block-code">
            <pre><code>{code}</code></pre>
          </div>
        )}

        {/* Render output area only if there is output OR it's a figure */}
        {(htmlOutput || isFigure) && (
          <div className="quarto-block-output">
            {isFigure ? (
              <figure id={figId}>
                <div dangerouslySetInnerHTML={{ __html: htmlOutput }} />
                <figcaption>
                  <strong>{figLabel}</strong> {figCaption}
                </figcaption>
              </figure>
            ) : (
              // For non-figure output (e.g., text from print statements)
              <div dangerouslySetInnerHTML={{ __html: htmlOutput }} />
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
};

export default QuartoBlockNodeView;