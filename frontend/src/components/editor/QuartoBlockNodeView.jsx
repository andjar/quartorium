import React, { useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import './QuartoBlockNodeView.css';

// Helper to format a single author
const formatAuthor = (author) => {
  if (author.name) return author.name; // For metadata authors
  if (author.given && author.surname) return `${author.surname}, ${author.given}`;
  return 'Unknown Author';
};

// Helper to format a single reference
const formatReference = (ref) => {
  const authorNames = ref.authors.map(formatAuthor).join('; ');
  let text = `${authorNames} (${ref.year || 'n.d.'}). ${ref.title}.`;
  if (ref.source) {
    text += ` *${ref.source}*`;
  }
  if (ref.volume) {
    text += `, ${ref.volume}`;
  }
  if (ref.issue) {
    text += `(${ref.issue})`;
  }
  if (ref.fpage) {
    text += `, ${ref.fpage}`;
    if (ref.lpage) {
      text += `-${ref.lpage}`;
    }
  }
  text += '.';
  return text;
};

const QuartoBlockNodeView = ({ node }) => {
  // Destructure all potential attributes
  const { code, language, htmlOutput, figId, figCaption, figLabel, metadata, bibliography } = node.attrs;
  const [isCodeVisible, setIsCodeVisible] = useState(false);

  // If metadata is present, render the metadata view.
  if (metadata) {
    const { title, authors } = metadata;
    return (
      <NodeViewWrapper className="quarto-block-wrapper metadata-block">
        <div className="quarto-block">
          <div className="quarto-block-header">
            <span>{`{metadata}`}</span>
          </div>
          <div className="quarto-block-output">
            {title && <h1>{title}</h1>}
            {authors && authors.length > 0 && (
              <div className="authors">
                {authors.map((author, index) => (
                  <div key={index} className="author">
                    <span className="author-name">{formatAuthor(author)}</span>
                    {author.isCorresponding && <sup title="Corresponding Author">*</sup>}
                    {author.affiliations && author.affiliations.length > 0 && (
                       <span className="author-affiliations">
                         ({author.affiliations.map(aff => aff.text).join(', ')})
                       </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </NodeViewWrapper>
    );
  }

  // If bibliography is present, render the bibliography view.
  if (bibliography) {
    // Convert the bibliography object to an array and remove duplicates
    const uniqueRefs = Object.values(bibliography).reduce((acc, current) => {
      if (!acc.find(item => item.id === current.id)) {
        acc.push(current);
      }
      return acc;
    }, []);

    return (
      <NodeViewWrapper className="quarto-block-wrapper bibliography-block">
        <div className="quarto-block">
          <div className="quarto-block-header">
            <span>{`{bibliography}`}</span>
          </div>
          <div className="quarto-block-output">
            <h2>References</h2>
            <ul>
              {uniqueRefs.map(ref => (
                <li key={ref.id}>
                  {formatReference(ref)}
                  {ref.doi && <a href={`https://doi.org/${ref.doi}`} target="_blank" rel="noopener noreferrer"> DOI: {ref.doi}</a>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }

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