import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './ShareModal.css';

function ShareModal({ userId, docId, docFilepath, repoId, onClose }) { // Added userId prop
  const [label, setLabel] = useState('');
  const [existingLinks, setExistingLinks] = useState([]);
  const [error, setError] = useState('');
  const [newLink, setNewLink] = useState(null);
  // Simplified state variables
  const [selectedBranch, setSelectedBranch] = useState('new-branch');
  const [collaborationBranches, setCollaborationBranches] = useState([]);

  // Fetch collaboration branches from the repository
  const fetchCollaborationBranches = async (currentRepoId) => {
    if (!currentRepoId) return;
    
    try {
      const response = await fetch(`/api/repos/${currentRepoId}/branches`, { credentials: 'include' });
      if (response.ok) {
        const branches = await response.json();
        setCollaborationBranches(branches);
        // Set "new-branch" as default
        setSelectedBranch('new-branch');
      } else {
        console.error('Failed to fetch collaboration branches');
        setCollaborationBranches([]);
      }
    } catch (error) {
      console.error('Error fetching collaboration branches:', error);
      setCollaborationBranches([]);
    }
  };

  useEffect(() => {
    if (!docId) return;
    // Fetch existing links when the modal opens
    fetch(`/api/docs/${docId}/shares`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(setExistingLinks);

    fetchCollaborationBranches(repoId);
  }, [docId, repoId]);

  // Generate branch name from label
  const generateBranchName = (label) => {
    if (!label) return '';
    const formattedLabel = label
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
      .trim();
    
    const date = new Date();
    const formattedDate = date.toISOString().split('T')[0]; // Get YYYY-MM-DD format

    return `${formattedDate}-${formattedLabel}`;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!label.trim()) {
      setError('Please enter a label for the collaborator.');
      return;
    }

    setError('');
    const branchToUse = selectedBranch === 'new-branch' ? generateBranchName(label) : selectedBranch;

    // Include userId, selectedBranch/newBranchName in the request
    fetch('/api/docs/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        repoId,
        filepath: docFilepath,
        label,
        userId,
        branchName: branchToUse,
        collaborationMode: 'individual', // Default to individual mode
      }),
    })
    .then(res => res.ok ? res.json() : Promise.reject(res))
    .then(data => {
        const fullUrl = `${window.location.origin}/collab/${data.share_token}`;
        setNewLink(fullUrl);
        setLabel('');
        setSelectedBranch('new-branch');
        // Refresh the list of links
        fetch(`/api/docs/${docId}/shares`, { credentials: 'include' }).then(res => res.json()).then(setExistingLinks);
        // Always refresh branches to ensure dropdown is current
        fetchCollaborationBranches(repoId);
    })
    .catch(async (res) => {
        const errText = res.json ? await res.json().catch(() => ({})) : {};
        setError(errText.error || 'Failed to create link.');
    });
  };

  const copyLink = (shareToken) => {
    const fullUrl = `${window.location.origin}/collab/${shareToken}`;
    navigator.clipboard.writeText(fullUrl);
  };

  return (
    <div className="share-modal-overlay">
      <div className="share-modal">
        <div className="share-modal-header">
          <h2>Share Document</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="label">Collaborator Label</label>
            <input
              type="text"
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g., Review by Prof. Smith"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="existingBranch">Select Branch</label>
            <select
              id="existingBranch"
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
            >
              <option value="new-branch">New Branch (auto-generated from label)</option>
              {collaborationBranches.map(branch => (
                <option key={branch.id || branch.name} value={branch.name}>{branch.name}</option>
              ))}
            </select>
            {selectedBranch === 'new-branch' && label && (
              <p className="branch-preview">
                Branch name will be: <code>{generateBranchName(label)}</code>
              </p>
            )}
          </div>

          <button type="submit" style={{ 
            width: '100%', 
            padding: '12px', 
            backgroundColor: '#3b82f6', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px', 
            fontSize: '14px', 
            fontWeight: '500', 
            cursor: 'pointer',
            marginTop: '1rem'
          }}>Create Link</button>
        </form>

        {error && <p className="error-text">{error}</p>}

        {newLink && (
          <div className="new-link-display">
            <p><strong>New link created!</strong></p>
            <input type="text" readOnly value={newLink} />
            <button onClick={() => navigator.clipboard.writeText(newLink)}>Copy</button>
          </div>
        )}

        {/* Existing Share Links */}
        {existingLinks.length > 0 && (
          <div className="existing-links">
            <h4>Existing Share Links</h4>
            <ul>
              {existingLinks.map((link) => (
                <li key={link.id}>
                  <div className="link-info">
                    <div className="link-label">{link.collaborator_label || 'Unnamed Collaboration'}</div>
                    <div className="branch-name">Branch: {link.collab_branch_name || 'Unknown'}</div>
                  </div>
                  <div>
                    <button onClick={() => copyLink(link.share_token)}>Copy Link</button>
                    <Link to={`/review/${link.share_token}`}>
                      <button>Review Changes</button>
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default ShareModal;