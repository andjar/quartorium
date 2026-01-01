import React, { useState, useEffect, useCallback } from 'react';
import './ParagraphChangeIndicators.css';

const BRANCH_COLORS = ['#8b5cf6', '#06b6d4', '#f97316', '#ec4899'];

function ParagraphChangeIndicators({ changes, editorRef, editor }) {
  const [dotPositions, setDotPositions] = useState([]);
  const [selectedChange, setSelectedChange] = useState(null);

  // Calculate dot positions based on editor paragraph positions
  const calculatePositions = useCallback(() => {
    if (!changes || changes.length === 0 || !editor || !editorRef?.current) {
      setDotPositions([]);
      return;
    }

    const proseMirrorEl = editorRef.current.querySelector('.ProseMirror');
    if (!proseMirrorEl) {
      setDotPositions([]);
      return;
    }

    const positions = [];
    
    // Get all block-level elements in the editor
    const blocks = proseMirrorEl.querySelectorAll(':scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > pre, :scope > blockquote');
    
    // Group changes by paragraph index
    const changesByIndex = {};
    changes.forEach(change => {
      if (!changesByIndex[change.index]) {
        changesByIndex[change.index] = [];
      }
      changesByIndex[change.index].push(change);
    });

    // Get the ProseMirror element's scroll position
    const scrollTop = proseMirrorEl.scrollTop;
    const proseMirrorRect = proseMirrorEl.getBoundingClientRect();

    // Calculate position for each paragraph with changes
    Object.entries(changesByIndex).forEach(([index, paragraphChanges]) => {
      const paraIndex = parseInt(index);
      const block = blocks[paraIndex];
      
      if (block) {
        const blockRect = block.getBoundingClientRect();
        // Calculate top relative to ProseMirror, accounting for scroll
        const topRelative = blockRect.top - proseMirrorRect.top + scrollTop;
        
        positions.push({
          index: paraIndex,
          top: topRelative,
          changes: paragraphChanges
        });
      }
    });

    setDotPositions(positions);
  }, [changes, editor, editorRef]);

  useEffect(() => {
    // Calculate initially
    calculatePositions();
    
    // Set up observers for recalculation
    const proseMirrorEl = editorRef?.current?.querySelector('.ProseMirror');
    if (proseMirrorEl) {
      proseMirrorEl.addEventListener('scroll', calculatePositions);
      window.addEventListener('resize', calculatePositions);
      
      // Recalculate when content changes
      const observer = new MutationObserver(calculatePositions);
      observer.observe(proseMirrorEl, { childList: true, subtree: true, characterData: true });
      
      return () => {
        proseMirrorEl.removeEventListener('scroll', calculatePositions);
        window.removeEventListener('resize', calculatePositions);
        observer.disconnect();
      };
    }
  }, [calculatePositions, editorRef]);

  const getBranchColor = (branchIndex) => {
    return BRANCH_COLORS[(branchIndex || 0) % BRANCH_COLORS.length];
  };

  if (dotPositions.length === 0) {
    return null;
  }

  return (
    <>
      {/* Indicator container - overlays the ProseMirror left padding */}
      <div className="paragraph-change-indicators">
        {dotPositions.map((position, idx) => (
          <div 
            key={`pos-${position.index}-${idx}`}
            className="change-indicator-row"
            style={{ top: `${position.top + 4}px` }}
          >
            {position.changes.map((change, changeIdx) => {
              const changeType = change.changeType || change.type;
              return (
                <div
                  key={`${change.branchLabel}-${changeIdx}`}
                  className={`change-dot change-${changeType}`}
                  style={{ 
                    backgroundColor: getBranchColor(change.branchIndex),
                    marginLeft: changeIdx > 0 ? '4px' : '0'
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedChange(change);
                  }}
                  title={`${change.branchLabel}: ${changeType}`}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Diff Popup */}
      {selectedChange && (() => {
        const changeType = selectedChange.changeType || selectedChange.type;
        const nodeType = selectedChange.nodeType || 'paragraph';
        const nodeLabel = nodeType === 'heading' ? 'Heading' : 
                         nodeType.startsWith('heading') ? `Heading ${nodeType.slice(-1)}` : 
                         'Paragraph';
        return (
          <div className="diff-popup-overlay" onClick={() => setSelectedChange(null)}>
            <div className="diff-popup" onClick={e => e.stopPropagation()}>
              <div className="diff-popup-header">
                <h5>Change by {selectedChange.branchLabel}</h5>
                <button className="close-btn" onClick={() => setSelectedChange(null)}>×</button>
              </div>
              <div className="diff-popup-content">
                <div className="diff-type">
                  <span className={`diff-type-badge ${changeType}`}>
                    {changeType === 'added' && '+ Added'}
                    {changeType === 'removed' && '− Removed'}
                    {changeType === 'modified' && '~ Modified'}
                  </span>
                  <span className="diff-location">{nodeLabel} {selectedChange.index + 1}</span>
                </div>
                <div className="diff-preview">
                  <p>{selectedChange.preview || 'No preview available'}</p>
                </div>
                <p className="diff-hint">
                  {changeType === 'modified' && `This ${nodeLabel.toLowerCase()} has different content in ${selectedChange.branchLabel}'s version.`}
                  {changeType === 'added' && `${selectedChange.branchLabel} added this ${nodeLabel.toLowerCase()}.`}
                  {changeType === 'removed' && `${selectedChange.branchLabel} removed this ${nodeLabel.toLowerCase()}.`}
                </p>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

export default ParagraphChangeIndicators;
