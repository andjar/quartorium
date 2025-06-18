import React, { useState } from 'react';
import './ShareModal.css';

function ShareModal({ repoId, filepath, onClose }) {
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [newLink, setNewLink] = useState(null);

  const handleCreateLink = (e) => {
    e.preventDefault();
    setError('');
    setNewLink(null);

    fetch('/api/docs/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ repoId, filepath, label }),
    })
    .then(res => res.ok ? res.json() : Promise.reject(res))
    .then(data => {
        const fullUrl = `${window.location.origin}/collab/${data.share_token}`;
        setNewLink(fullUrl);
        setLabel(''); // Reset form
    })
    .catch(async (res) => {
        const err = await res.json();
        setError(err.error || 'Failed to create link.');
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h2>Share "{filepath}"</h2>
        <p>Create a new shareable link for a collaborator.</p>
        
        {/* TODO: Add list of existing links here */}

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