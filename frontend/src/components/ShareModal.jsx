import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './ShareModal.css';

function ShareModal({ docId, docFilepath, repoId, onClose }) { // Now receives docId, filepath, and repoId
  const [label, setLabel] = useState('');
  const [existingLinks, setExistingLinks] = useState([]);
  const [error, setError] = useState('');
  const [newLink, setNewLink] = useState(null);

  useEffect(() => {
    if (!docId) return;
    // Fetch existing links when the modal opens
    fetch(`/api/docs/${docId}/shares`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(setExistingLinks);
  }, [docId]);

  const handleCreateLink = (e) => {
    e.preventDefault();
    setError('');
    setNewLink(null);

    // Send repoId, filepath, and label as expected by the backend
    fetch('/api/docs/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ repoId, filepath: docFilepath, label }),
    })
    .then(res => res.ok ? res.json() : Promise.reject(res))
    .then(data => {
        const fullUrl = `${window.location.origin}/collab/${data.share_token}`;
        setNewLink(fullUrl);
        setLabel(''); // Reset form
        // Refresh the list of links
        fetch(`/api/docs/${docId}/shares`, { credentials: 'include' }).then(res => res.json()).then(setExistingLinks);
    })
    .catch(async (res) => {
        const err = await res.json();
        setError(err.error || 'Failed to create link.');
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
                  <span>{link.collaborator_label}</span>
                  <div>
                    <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/collab/${link.share_token}`)}>Copy Link</button>
                    <Link to={`/review/${link.id}`}>
                      <button>Review</button>
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p>No share links created yet.</p>}
        </div>

        <form onSubmit={handleCreateLink}>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g., Prof. Smith's Review)"
            required
          />
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