import React, { useState, useEffect } from 'react';
import './SuggestionsViewer.css';

function SuggestionsViewer({ docId, onClose }) {
  const [suggestions, setSuggestions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedBranch, setSelectedBranch] = useState('all');

  useEffect(() => {
    if (!docId) return;

    const fetchSuggestions = async () => {
      try {
        setLoading(true);
        
        // First, test authentication
        const authTest = await fetch('/api/auth/test', { credentials: 'include' });
        console.log('Auth test result:', await authTest.json());
        
        const response = await fetch(`/api/docs/${docId}/suggestions`, { credentials: 'include' });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        setSuggestions(data);
      } catch (err) {
        console.error('Failed to fetch suggestions:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSuggestions();
  }, [docId]);

  if (loading) {
    return (
      <div className="suggestions-viewer-overlay">
        <div className="suggestions-viewer">
          <div className="suggestions-header">
            <h2>Loading Suggestions...</h2>
            <button onClick={onClose} className="close-button">×</button>
          </div>
          <div className="suggestions-content">
            <p>Fetching suggestions from all collaborators...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="suggestions-viewer-overlay">
        <div className="suggestions-viewer">
          <div className="suggestions-header">
            <h2>Error Loading Suggestions</h2>
            <button onClick={onClose} className="close-button">×</button>
          </div>
          <div className="suggestions-content">
            <p className="error-message">Error: {error}</p>
            <button onClick={() => window.location.reload()}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  if (!suggestions || suggestions.branches.length === 0) {
    return (
      <div className="suggestions-viewer-overlay">
        <div className="suggestions-viewer">
          <div className="suggestions-header">
            <h2>No Suggestions Found</h2>
            <button onClick={onClose} className="close-button">×</button>
          </div>
          <div className="suggestions-content">
            <p>No suggestions have been made by collaborators yet.</p>
          </div>
        </div>
      </div>
    );
  }

  const filteredBranches = selectedBranch === 'all' 
    ? suggestions.branches 
    : suggestions.branches.filter(branch => branch.branch === selectedBranch);

  return (
    <div className="suggestions-viewer-overlay">
      <div className="suggestions-viewer">
        <div className="suggestions-header">
          <h2>Collaborator Suggestions ({suggestions.totalSuggestions})</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>
        
        <div className="suggestions-filters">
          <select 
            value={selectedBranch} 
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="branch-filter"
          >
            <option value="all">All Branches</option>
            {suggestions.branches.map(branch => (
              <option key={branch.shareToken} value={branch.branch}>
                {branch.collaborator} ({branch.suggestions.length} suggestions)
              </option>
            ))}
          </select>
        </div>

        <div className="suggestions-content">
          {filteredBranches.map(branch => (
            <div key={branch.shareToken} className="branch-suggestions">
              <div className="branch-header">
                <h3>{branch.collaborator}</h3>
                <span className="branch-info">
                  Branch: {branch.branch} 
                  {branch.commitHash !== 'UNSAVED' && (
                    <span className="commit-hash"> (commit: {branch.commitHash})</span>
                  )}
                  {branch.commitHash === 'UNSAVED' && (
                    <span className="unsaved-badge">Unsaved Changes</span>
                  )}
                </span>
              </div>
              
              {branch.suggestions.map(suggestion => (
                <div key={suggestion.id} className="suggestion-item">
                  <div className="suggestion-meta">
                    <span className="suggestion-author">{suggestion.author}</span>
                    <span className="suggestion-time">
                      {new Date(suggestion.timestamp).toLocaleString()}
                    </span>
                    <span className={`suggestion-status status-${suggestion.status}`}>
                      {suggestion.status}
                    </span>
                  </div>
                  
                  <div className="suggestion-thread">
                    {suggestion.thread.map((message, index) => (
                      <div key={index} className="thread-message">
                        <div className="message-author">{message.author}</div>
                        <div className="message-text">{message.text}</div>
                        <div className="message-time">
                          {new Date(message.timestamp).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SuggestionsViewer; 