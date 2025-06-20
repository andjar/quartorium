import React, { useState, useEffect } from 'react';
import './ChangeIndicator.css';

function ChangeIndicator({ shareToken, collaboratorLabel }) {
  const [recentChanges, setRecentChanges] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchRecentChanges = async () => {
    if (!shareToken) return;
    
    try {
      setIsLoading(true);
      const response = await fetch(`/api/collab/${shareToken}/recent-changes`);
      if (response.ok) {
        const data = await response.json();
        
        // Combine live changes and recent commits
        const allChanges = [];
        
        // Add live changes
        if (data.liveChanges) {
          data.liveChanges.forEach(change => {
            allChanges.push({
              id: `live-${change.collaboratorLabel}`,
              author: change.collaboratorLabel,
              timestamp: change.updatedAt,
              type: 'live',
              description: 'Has unsaved changes'
            });
          });
        }
        
        // Add recent commits
        if (data.recentCommits) {
          data.recentCommits.forEach(commit => {
            allChanges.push({
              id: `commit-${commit.hash}`,
              author: commit.collaboratorLabel || commit.author,
              timestamp: commit.timestamp,
              type: 'commit',
              description: commit.message.includes('Quartorium Collab') ? 'Committed changes' : 'Updated document'
            });
          });
        }
        
        // Sort by timestamp (most recent first)
        allChanges.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        setRecentChanges(allChanges);
      } else {
        console.warn('Failed to fetch recent changes:', response.status);
        setRecentChanges([]);
      }
    } catch (error) {
      console.warn('Error fetching recent changes:', error);
      setRecentChanges([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecentChanges();
    // Poll for recent changes every 30 seconds
    const interval = setInterval(fetchRecentChanges, 30000);
    return () => clearInterval(interval);
  }, [shareToken]);

  const formatTimeAgo = (timestamp) => {
    const now = new Date();
    const changeTime = new Date(timestamp);
    const diffInMinutes = Math.floor((now - changeTime) / 1000 / 60);
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}d ago`;
  };

  if (isLoading) {
    return (
      <div className="change-indicator">
        <div className="change-indicator-header">
          <span className="change-icon">📝</span>
          <span>Recent Changes</span>
        </div>
        <div className="change-list">
          <div className="change-item loading">Loading...</div>
        </div>
      </div>
    );
  }

  if (recentChanges.length === 0) {
    return (
      <div className="change-indicator">
        <div className="change-indicator-header">
          <span className="change-icon">📝</span>
          <span>Recent Changes</span>
        </div>
        <div className="change-list">
          <div className="change-item empty">No recent changes</div>
        </div>
      </div>
    );
  }

  return (
    <div className="change-indicator">
      <div className="change-indicator-header">
        <span className="change-icon">📝</span>
        <span>Recent Changes</span>
      </div>
      <div className="change-list">
        {recentChanges.slice(0, 5).map(change => (
          <div key={change.id} className={`change-item ${change.type}`}>
            <span className="change-author">{change.author}</span>
            <span className="change-description">{change.description}</span>
            <span className="change-time">
              {formatTimeAgo(change.timestamp)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ChangeIndicator; 