import React from 'react';
import './SaveStatus.css';

function SaveStatus({ status, baseCommitHash }) {
  const getStatusIcon = () => {
    if (status.includes('Saving')) return '💾';
    if (status.includes('Saved')) return '✅';
    if (status.includes('Unsaved')) return '⚠️';
    if (status.includes('Error')) return '❌';
    if (status.includes('Committing')) return '🔄';
    if (status.includes('Committed')) return '✅';
    return '📄';
  };

  const getStatusColor = () => {
    if (status.includes('Saving') || status.includes('Committing')) return 'saving';
    if (status.includes('Saved') || status.includes('Committed')) return 'saved';
    if (status.includes('Unsaved')) return 'unsaved';
    if (status.includes('Error')) return 'error';
    return 'default';
  };

  return (
    <div className={`save-status ${getStatusColor()}`}>
      <div className="save-status-header">
        <span className="save-icon">{getStatusIcon()}</span>
        <span className="save-title">Document Status</span>
      </div>
      
      <div className="save-status-content">
        <div className="status-text">{status}</div>
        {baseCommitHash && (
          <div className="commit-hash">
            Commit: {baseCommitHash.substring(0, 7)}
          </div>
        )}
      </div>
    </div>
  );
}

export default SaveStatus; 