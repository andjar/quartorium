import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import ShareModal from '../components/ShareModal';
import './DashboardPage.css';

function DashboardPage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [repos, setRepos] = useState([]);
  const [newRepoUrl, setNewRepoUrl] = useState('');
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [qmdFiles, setQmdFiles] = useState([]);
  const [error, setError] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const navigate = useNavigate();

  const [sharingFile, setSharingFile] = useState(null);

  const openShareModal = async (repoId, filepath) => {
    try {
      const res = await fetch('/api/docs/get-or-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ repoId, filepath }),
      });

      if (!res.ok) {
        let errorMsg = 'Failed to get document information.';
        try {
          const errorData = await res.json();
          errorMsg = errorData.error || errorMsg;
        } catch (e) {
          // If parsing error JSON fails, use the default message
          console.error("Could not parse error response from /api/docs/get-or-create:", e);
        }
        console.error("Error response from /api/docs/get-or-create:", res.status, errorMsg);
        alert(`Error preparing share modal: ${errorMsg}`);
        return;
      }

      const doc = await res.json();
      if (!doc || doc.id === undefined) {
          console.error("Invalid document data received from /api/docs/get-or-create:", doc);
          alert("Error preparing share modal: Could not retrieve valid document information.");
          return;
      }
      setSharingFile({ docId: doc.id, filepath, repoId });
    } catch (error) {
      console.error("Network or other error in openShareModal:", error);
      alert(`Error preparing share modal: ${error.message || "An unexpected error occurred."}`);
    }
  };

  const fetchRepos = useCallback(() => {
    fetch('/api/repos', { credentials: 'include' })
      .then(res => res.json())
      .then(setRepos);
  }, []);

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => {
        setUser(data);
        fetchRepos();
      })
      .catch(() => navigate('/login'))
      .finally(() => setLoading(false));
  }, [navigate, fetchRepos]);

  const handleAddRepo = (e) => {
    e.preventDefault();
    setError('');
    setIsAdding(true);
    fetch('/api/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ repo_url: newRepoUrl }),
    })
      .then(res => res.ok ? res.json() : Promise.reject(res))
      .then(() => {
        setNewRepoUrl('');
        fetchRepos();
      })
      .catch(async (res) => {
        try {
          const err = await res.json();
          setError(err.error || 'Failed to add repository.');
        } catch {
          setError('An unexpected error occurred.');
        }
      })
      .finally(() => setIsAdding(false));
  };

  const handleSelectRepo = (repo) => {
    setSelectedRepo(repo);
    setQmdFiles([]);
    setIsLoadingFiles(true);
    fetch(`/api/repos/${repo.id}/qmd-files`, { credentials: 'include' })
      .then(res => res.json())
      .then(setQmdFiles)
      .catch(err => console.error("Failed to fetch qmd files", err))
      .finally(() => setIsLoadingFiles(false));
  };
  
  const handleLogout = () => {
    window.location.href = 'http://localhost:8000/api/auth/logout';
  };

  if (loading) return <div className="dashboard-loading">Loading dashboard...</div>;

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h2>Quartorium</h2>
        {user && (
          <div className="dashboard-user-info">
            <span>Welcome, {user.username}!</span>
            <img src={user.avatar_url} alt="User avatar" width="40" style={{ borderRadius: '50%' }} />
            <button className="dashboard-logout-button" onClick={handleLogout}>Logout</button>
          </div>
        )}
      </header>
      <main className="dashboard-main">
        <h3>Connect a Repository</h3>
        <form className="dashboard-form" onSubmit={handleAddRepo}>
          <input
            type="text"
            value={newRepoUrl}
            onChange={(e) => setNewRepoUrl(e.target.value)}
            placeholder="https://github.com/username/my-paper"
            disabled={isAdding}
          />
          <button type="submit" disabled={isAdding}>
            {isAdding ? 'Adding...' : 'Add Repository'}
          </button>
        </form>
        {error && <p className="dashboard-error">{error}</p>}

        <div className="dashboard-content">
          <div className="dashboard-repos-section">
            <h4 className="dashboard-section-title">My Repositories</h4>
            {repos.map((repo) => (
              <div 
                key={repo.id} 
                onClick={() => handleSelectRepo(repo)} 
                className={`dashboard-repo-item ${selectedRepo?.id === repo.id ? 'selected' : ''}`}
              >
                <strong>{repo.full_name}</strong>
              </div>
            ))}
          </div>
          <div className="dashboard-files-section">
            <h4 className="dashboard-section-title">Quarto Files</h4>
            {selectedRepo && (
              <>
                {isLoadingFiles ? (
                  <p className="dashboard-loading">Loading files from {selectedRepo.name}...</p>
                ) : qmdFiles.length > 0 ? (
                  <ul className="dashboard-file-list">
                    {qmdFiles.map((file) => (
                      <li key={file} className="dashboard-file-item">
                        <Link 
                          to={`/editor/${selectedRepo.id}/${encodeURIComponent(file)}`}
                          className="dashboard-file-link"
                        >
                          {file}
                        </Link>
                        <button 
                          className="dashboard-share-button"
                          onClick={() => openShareModal(selectedRepo.id, file)}
                        >
                            Share
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="dashboard-empty-state">No .qmd files found in this repository.</p>
                )}
              </>
            )}
            {!selectedRepo && <p className="dashboard-empty-state">Select a repository to see its files.</p>}
          </div>
        </div>
      </main>
      {sharingFile && (
          <ShareModal 
            userId={user.id}
            docId={sharingFile.docId} 
            docFilepath={sharingFile.filepath} 
            repoId={sharingFile.repoId} 
            onClose={() => setSharingFile(null)} 
          />
      )}
    </div>
  );
}

export default DashboardPage;