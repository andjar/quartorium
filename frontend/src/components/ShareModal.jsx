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

  const handleCreateLink = (e) => {
    e.preventDefault();
    setError('');
    setNewLink(null);

    // Validate that label is provided
    if (!label.trim()) {
      setError('Please provide a label for this share link.');
      return;
    }

    // Determine branch name based on selection
    let branchToUse;
    if (selectedBranch === 'new-branch') {
      branchToUse = generateBranchName(label);
      if (!branchToUse) {
        setError('Please provide a valid label to generate a branch name.');
        return;
      }
    } else {
      branchToUse = selectedBranch;
    }

    // Include userId, selectedBranch/newBranchName in the request
    fetch('/api/docs/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        repoId,
        filepath: docFilepath,
        label,
        userId, // Assuming userId is passed as a prop or available in scope
        branchName: branchToUse, // Send either selected existing or new branch name
      }),
    })
    .then(res => res.ok ? res.json() : Promise.reject(res))
    .then(data => {
        const fullUrl = `${window.location.origin}/collab/${data.share_token}`;
        setNewLink(fullUrl);
        setLabel(''); // Reset form
        setSelectedBranch('new-branch'); // Reset to new branch option
        // Refresh the list of links
        fetch(`/api/docs/${docId}/shares`, { credentials: 'include' }).then(res => res.json()).then(setExistingLinks);
        // Always refresh branches to ensure dropdown is current
        fetchCollaborationBranches(repoId);
    })
    .catch(async (res) => {
        // It's good practice to check if res has a json method before calling it
        const errText = res.json ? await res.json().catch(() => ({})) : {};
        setError(errText.error || 'Failed to create link.');
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h2>Share "{docFilepath}"</h2>
        <p>Create a new shareable link for a collaborator.</p>
        
        <div className="existing-links">
          <h4>Existing Share Links</h4>
          {existingLinks.length > 0 ? (
            <ul>
              {existingLinks.map(link => (
                <li key={link.id}>
                  <div className="link-info">
                    <span className="link-label">{link.collaborator_label || 'Unnamed Link'}</span>
                    {link.collab_branch_name && (
                      <span className="branch-name">Branch: {link.collab_branch_name}</span>
                    )}
                  </div>
                  <div>
                    <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/collab/${link.share_token}`)}>Copy Link</button>
                    <Link to={`/review/${link.share_token || link.id}`}>
                      <button>Review</button>
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p style={{ padding: '16px', margin: 0, color: '#6b7280', fontStyle: 'italic' }}>No share links created yet.</p>}
        </div>

        <form onSubmit={handleCreateLink}>
          <div className="form-group">
            <label htmlFor="linkLabel">Label *</label>
            <input
              id="linkLabel"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="E.g., Prof. Smith's Review"
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
      </div>
    </div>
  );
}

export default ShareModal;