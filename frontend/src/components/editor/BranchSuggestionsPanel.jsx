import React, { useState, useEffect, useCallback } from 'react';
import './BranchSuggestionsPanel.css';

const BRANCH_COLORS = ['#8b5cf6', '#06b6d4', '#f97316', '#ec4899'];

function BranchSuggestionsPanel({ shareToken, collaboratorLabel, onParagraphChanges, editor }) {
  const [otherBranches, setOtherBranches] = useState([]);
  const [visibleBranches, setVisibleBranches] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [selectedChange, setSelectedChange] = useState(null);

  // Fetch other branches' changes
  const fetchOtherBranches = useCallback(async () => {
    if (!shareToken) return;
    
    try {
      const response = await fetch(`/api/collab/${shareToken}/other-branches`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setOtherBranches(data.otherBranches || []);
      
      // Extract paragraph changes from all branches
      const allChanges = [];
      (data.otherBranches || []).forEach((branch, branchIndex) => {
        if (branch.paragraphChanges) {
          branch.paragraphChanges.forEach(change => {
            allChanges.push({
              ...change,
              branchLabel: branch.collaboratorLabel,
              branchToken: branch.shareToken,
              branchIndex: branchIndex
            });
          });
        }
      });
      
      // Notify parent of paragraph changes if callback provided
      if (onParagraphChanges) {
        onParagraphChanges(allChanges);
      }
      
      // Initialize visibility - all visible by default
      const initialVisibility = {};
      (data.otherBranches || []).forEach(branch => {
        if (visibleBranches[branch.shareToken] === undefined) {
          initialVisibility[branch.shareToken] = true;
        } else {
          initialVisibility[branch.shareToken] = visibleBranches[branch.shareToken];
        }
      });
      setVisibleBranches(initialVisibility);
      
      setError(null);
    } catch (err) {
      console.error('Failed to fetch other branches:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [shareToken, onParagraphChanges]);

  useEffect(() => {
    fetchOtherBranches();
    const interval = setInterval(fetchOtherBranches, 30000);
    return () => clearInterval(interval);
  }, [fetchOtherBranches]);

  // Toggle branch visibility
  const toggleBranchVisibility = (branchShareToken) => {
    setVisibleBranches(prev => ({
      ...prev,
      [branchShareToken]: !prev[branchShareToken]
    }));
  };

  // Get branch color
  const getBranchColor = (index) => BRANCH_COLORS[index % BRANCH_COLORS.length];

  // Calculate totals
  const totalChanges = otherBranches.reduce((sum, branch) => 
    sum + (branch.paragraphChanges?.length || 0), 0);

  // Get visible changes
  const visibleChanges = otherBranches
    .filter(branch => visibleBranches[branch.shareToken])
    .flatMap((branch, branchIndex) => 
      (branch.paragraphChanges || []).map(change => ({
        ...change,
        branchLabel: branch.collaboratorLabel,
        branchIndex
      }))
    );

  // Close diff popup
  const closeDiffPopup = () => setSelectedChange(null);

  if (loading) {
    return (
      <div className="branch-suggestions-panel">
        <div className="panel-header">
          <h4>Collaborators</h4>
        </div>
        <div className="panel-content">
          <p className="loading-text">Loading...</p>
        </div>
      </div>
    );
  }

  if (otherBranches.length === 0) {
    return (
      <div className="branch-suggestions-panel">
        <div className="panel-header">
          <h4>Collaborators</h4>
        </div>
        <div className="panel-content">
          <p className="empty-text">No other collaborators yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`branch-suggestions-panel ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="panel-header" onClick={() => setIsCollapsed(!isCollapsed)}>
        <h4>
          Collaborators
          {totalChanges > 0 && (
            <span className="change-badge">{totalChanges} changes</span>
          )}
        </h4>
        <span className="collapse-icon">{isCollapsed ? '›' : '‹'}</span>
      </div>
      
      {!isCollapsed && (
        <div className="panel-content">
          {/* Branch visibility toggles */}
          <div className="branch-toggles">
            <p className="toggle-label">Show changes from</p>
            {otherBranches.map((branch, index) => (
              <label key={branch.shareToken} className={`branch-toggle`}>
                <input
                  type="checkbox"
                  checked={visibleBranches[branch.shareToken] || false}
                  onChange={() => toggleBranchVisibility(branch.shareToken)}
                />
                <span 
                  className="branch-color-dot"
                  style={{ backgroundColor: getBranchColor(index) }}
                />
                <span className="collaborator-name">{branch.collaboratorLabel}</span>
                {(branch.paragraphChanges?.length || 0) > 0 && (
                  <span className="change-count">{branch.paragraphChanges.length}</span>
                )}
                {branch.source === 'live' && (
                  <span className="live-dot" title="Has unsaved changes">●</span>
                )}
              </label>
            ))}
          </div>

          {/* List of visible changes */}
          {visibleChanges.length > 0 && (
            <div className="changes-list">
              <p className="section-label">Text Changes</p>
              {visibleChanges.map((change, idx) => {
                const changeType = change.changeType || change.type; // Support both old and new format
                const nodeType = change.nodeType || 'paragraph';
                const nodeLabel = nodeType === 'heading' ? 'Heading' : 
                                 nodeType.startsWith('heading') ? `H${nodeType.slice(-1)}` : 
                                 'Paragraph';
                return (
                  <div 
                    key={`${change.branchLabel}-${change.index}-${idx}`}
                    className={`change-item change-${changeType}`}
                    onClick={() => setSelectedChange(change)}
                  >
                    <span 
                      className="change-color-bar"
                      style={{ backgroundColor: getBranchColor(change.branchIndex) }}
                    />
                    <div className="change-info">
                      <div className="change-header">
                        <span className="change-author">{change.branchLabel}</span>
                        <span className="node-type-label">{nodeLabel}</span>
                        <span className={`change-type-badge ${changeType}`}>{changeType}</span>
                      </div>
                      <p className="change-preview">{change.preview}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Refresh button */}
          <button className="refresh-btn" onClick={fetchOtherBranches}>
            ↻ Refresh
          </button>

          {error && <p className="error-text">{error}</p>}
        </div>
      )}

      {/* Diff Popup */}
      {selectedChange && (() => {
        const changeType = selectedChange.changeType || selectedChange.type;
        const nodeType = selectedChange.nodeType || 'paragraph';
        const nodeLabel = nodeType === 'heading' ? 'Heading' : 
                         nodeType.startsWith('heading') ? `Heading ${nodeType.slice(-1)}` : 
                         'Paragraph';
        return (
          <div className="diff-popup-overlay" onClick={closeDiffPopup}>
            <div className="diff-popup" onClick={e => e.stopPropagation()}>
              <div className="diff-popup-header">
                <h5>Change by {selectedChange.branchLabel}</h5>
                <button className="close-btn" onClick={closeDiffPopup}>×</button>
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
                  <p>{selectedChange.preview}</p>
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
    </div>
  );
}

export default BranchSuggestionsPanel;
