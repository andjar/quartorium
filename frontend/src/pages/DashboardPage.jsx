import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import ShareModal from '../components/ShareModal';

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
  const [sharingFile, setSharingFile] = useState(null); // { repoId, filepath }
  const navigate = useNavigate();

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

  if (loading) return <div>Loading dashboard...</div>;

  return (
    <div>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', borderBottom: '1px solid #eee' }}>
        <h2>Quartorium</h2>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span>Welcome, {user.username}!</span>
            <img src={user.avatar_url} alt="User avatar" width="40" style={{ borderRadius: '50%' }} />
            <button onClick={handleLogout}>Logout</button>
          </div>
        )}
      </header>
      <main style={{ padding: '1rem' }}>
        <h3>Connect a Repository</h3>
        <form onSubmit={handleAddRepo} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="text"
            value={newRepoUrl}
            onChange={(e) => setNewRepoUrl(e.target.value)}
            placeholder="https://github.com/username/my-paper"
            style={{ width: '300px', padding: '8px' }}
            disabled={isAdding}
          />
          <button type="submit" disabled={isAdding}>
            {isAdding ? 'Adding...' : 'Add Repository'}
          </button>
        </form>
        {error && <p style={{ color: 'red', marginTop: '10px' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '2rem', marginTop: '2rem' }}>
          <div style={{ flex: 1 }}>
            <h4>My Repositories</h4>
            {repos.map((repo) => (
              <div key={repo.id} onClick={() => handleSelectRepo(repo)} style={{ cursor: 'pointer', padding: '10px', border: selectedRepo?.id === repo.id ? '2px solid blue' : '1px solid #ccc', marginBottom: '5px', borderRadius: '4px' }}>
                <strong>{repo.full_name}</strong>
              </div>
            ))}
          </div>
          <div style={{ flex: 2, borderLeft: '1px solid #eee', paddingLeft: '2rem' }}>
            <h4>Quarto Files</h4>
            {selectedRepo && (
              <>
                {isLoadingFiles ? (
                  <p>Loading files from {selectedRepo.name}...</p>
                ) : qmdFiles.length > 0 ? (
                  <ul>
                    {qmdFiles.map((file) => (
                      <li key={file} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Link to={`/editor?repoId=${selectedRepo.id}&filepath=${encodeURIComponent(file)}`}>
                          {file}
                        </Link>
                        <button onClick={() => setSharingFile({ repoId: selectedRepo.id, filepath: file })}>
                          Share
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No .qmd files found in this repository.</p>
                )}
              </>
            )}
            {!selectedRepo && <p>Select a repository to see its files.</p>}
          </div>
        </div>
      </main>
      {sharingFile && (
        <ShareModal 
          repoId={sharingFile.repoId} 
          filepath={sharingFile.filepath} 
          onClose={() => setSharingFile(null)} 
        />
      )}
    </div>
  );
}

export default DashboardPage;