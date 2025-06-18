import React, { useState, useEffect } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import './QuartoBlockNodeView.css';

const QuartoBlockNodeView = ({ node, updateAttributes }) => {
  const { code, chunkOptions, htmlOutput } = node.attrs;

  const [beforeLegendHtml, setBeforeLegendHtml] = useState('');
  const [legendTextState, setLegendTextState] = useState('');
  const [afterLegendHtml, setAfterLegendHtml] = useState('');
  const [hasEditableLegend, setHasEditableLegend] = useState(false);
  const [legendTagName, setLegendTagName] = useState('');

  useEffect(() => {
    const figcaptionRegex = /<figcaption>(.*?)<\/figcaption>/s;
    const captionRegex = /<caption>(.*?)<\/caption>/s;
    
    let match;
    let tagName = '';

    if (htmlOutput) {
      match = htmlOutput.match(figcaptionRegex);
      if (match) {
        tagName = 'figcaption';
      } else {
        match = htmlOutput.match(captionRegex);
        if (match) {
          tagName = 'caption';
        }
      }
    }

    if (match && tagName) {
      setLegendTextState(match[1]);
      const parts = htmlOutput.split(match[0]);
      setBeforeLegendHtml(parts[0]);
      setAfterLegendHtml(parts[1] || '');
      setLegendTagName(tagName);
      setHasEditableLegend(true);
    } else {
      setHasEditableLegend(false);
      setBeforeLegendHtml('');
      setLegendTextState('');
      setAfterLegendHtml('');
      setLegendTagName('');
    }
  }, [htmlOutput]);

  const handleLegendBlur = (event) => {
    const newLegendText = event.target.innerText;
    setLegendTextState(newLegendText); // Local state update for responsiveness

    if (!legendTagName) return; // Should not happen if blurring an editable legend

    const newHtmlOutputString = `${beforeLegendHtml}<${legendTagName}>${newLegendText}</${legendTagName}>${afterLegendHtml}`;
    updateAttributes({ htmlOutput: newHtmlOutputString });
  };

  return (
    <NodeViewWrapper className="quarto-block">
      <div className="quarto-block-header">
        <span>{`{${chunkOptions}}`}</span>
      </div>
      <div className="quarto-block-content-wrapper">
        {hasEditableLegend ? (
          <div className="quarto-block-output">
            {beforeLegendHtml && (
              <div dangerouslySetInnerHTML={{ __html: beforeLegendHtml }} />
            )}
            <div
              className="editable-caption" // Keeping class name for now, can be changed to editable-legend
              contentEditable={true}
              onBlur={handleLegendBlur}
              suppressContentEditableWarning={true}
              key={legendTextState} 
            >
              {legendTextState}
            </div>
            {afterLegendHtml && (
              <div dangerouslySetInnerHTML={{ __html: afterLegendHtml }} />
            )}
          </div>
        ) : (
          <div
            className="quarto-block-output"
            dangerouslySetInnerHTML={{ __html: htmlOutput }}
          />
        )}
      </div>
    </NodeViewWrapper>
  );
};

export default QuartoBlockNodeView;