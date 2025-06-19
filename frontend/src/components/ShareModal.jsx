import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './ShareModal.css';

function ShareModal({ userId, docId, docFilepath, repoId, onClose }) { // Added userId prop
  const [label, setLabel] = useState('');
  const [existingLinks, setExistingLinks] = useState([]);
  const [error, setError] = useState('');
  const [newLink, setNewLink] = useState(null);
  // New state variables
  const [selectedBranch, setSelectedBranch] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [collaborationBranches, setCollaborationBranches] = useState([]);

  // Placeholder function to fetch collaboration branches
  const fetchCollaborationBranches = async (currentDocId) => {
    if (!currentDocId) return;
    // This is a placeholder. In the future, this would fetch branches for the document.
    // For example:
    // try {
    //   const response = await fetch(`/api/docs/${currentDocId}/branches`, { credentials: 'include' });
    //   if (response.ok) {
    //     const branches = await response.json();
    //     setCollaborationBranches(branches);
    //     if (branches.length > 0) {
    //       setSelectedBranch(branches[0].name); // Default to the first branch
    //     }
    //   } else {
    //     console.error('Failed to fetch collaboration branches');
    //     setCollaborationBranches([]);
    //   }
    // } catch (error) {
    //   console.error('Error fetching collaboration branches:', error);
    //   setCollaborationBranches([]);
    // }
    console.log(`Placeholder: Fetching branches for docId ${currentDocId}`);
    // Mock data for now:
    const mockBranches = [
      { id: '1', name: 'feat/existing-branch-1' },
      { id: '2', name: 'collab/userA-changes' },
    ];
    setCollaborationBranches(mockBranches);
    if (mockBranches.length > 0) {
      setSelectedBranch(mockBranches[0].name);
    }
  };

  useEffect(() => {
    if (!docId) return;
    // Fetch existing links when the modal opens
    fetch(`/api/docs/${docId}/shares`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(setExistingLinks);

    fetchCollaborationBranches(docId);
  }, [docId]);

  const handleCreateLink = (e) => {
    e.preventDefault();
    setError('');
    setNewLink(null);

    const branchToUse = newBranchName || selectedBranch;
    if (!branchToUse) {
      setError('Please select an existing branch or enter a new branch name.');
      return;
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
        setNewBranchName(''); // Reset new branch name input
        // Refresh the list of links
        fetch(`/api/docs/${docId}/shares`, { credentials: 'include' }).then(res => res.json()).then(setExistingLinks);
        // Potentially refresh branches if a new one was created, though the current placeholder won't show it
        fetchCollaborationBranches(docId);
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
                  <span>{link.collaborator_label || 'Unnamed Link'}</span> {/* Added fallback for label */}
                  <div>
                    <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/collab/${link.share_token}`)}>Copy Link</button>
                    {/* Assuming review link might use share_token or a specific ID */}
                    <Link to={`/review/${link.share_token || link.id}`}>
                      <button>Review</button>
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p>No share links created yet.</p>}
        </div>

        <form onSubmit={handleCreateLink}>
          <div className="form-group">
            <label htmlFor="linkLabel">Label (optional)</label>
            <input
              id="linkLabel"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="E.g., Prof. Smith's Review"
            />
          </div>

          <div className="form-group">
            <label htmlFor="existingBranch">Select Existing Branch</label>
            <select
              id="existingBranch"
              value={selectedBranch}
              onChange={(e) => { setSelectedBranch(e.target.value); setNewBranchName(''); }} // Clear new branch name if existing is selected
              disabled={collaborationBranches.length === 0 || !!newBranchName}
            >
              <option value="">-- Select a branch --</option>
              {collaborationBranches.map(branch => (
                <option key={branch.id || branch.name} value={branch.name}>{branch.name}</option>
              ))}
            </select>
          </div>

          <p className="or-divider">OR</p>

          <div className="form-group">
            <label htmlFor="newBranchName">Create New Branch</label>
            <input
              id="newBranchName"
              type="text"
              value={newBranchName}
              onChange={(e) => { setNewBranchName(e.target.value); setSelectedBranch(''); }} // Clear selected branch if new one is typed
              placeholder="E.g., review-feature-xyz"
            />
          </div>

          {/* userId would be passed in props or from context, not typically a hidden input here unless no other way */}

          <button type="submit">Create Link</button>
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