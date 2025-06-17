import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function DashboardPage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [repos, setRepos] = useState([]);
  const [newRepoUrl, setNewRepoUrl] = useState('');
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [qmdFiles, setQmdFiles] = useState([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // Fetch user data on load
  useEffect(() => {
    fetch('/api/me')
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => {
        setUser(data);
        fetchRepos();
      })
      .catch(() => navigate('/login'))
      .finally(() => setLoading(false));
  }, [navigate]);
  
  const fetchRepos = () => {
    fetch('/api/repos')
      .then(res => res.json())
      .then(setRepos);
  };

  const handleAddRepo = (e) => {
    e.preventDefault();
    setError('');
    fetch('/api/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: newRepoUrl }),
    })
      .then(res => res.ok ? res.json() : Promise.reject(res))
      .then(() => {
        setNewRepoUrl('');
        fetchRepos(); // Refresh the list
      })
      .catch(async (res) => {
        const err = await res.json();
        setError(err.error || 'Failed to add repository.');
      });
  };

  const handleSelectRepo = (repo) => {
    setSelectedRepo(repo);
    setQmdFiles([]); // Clear old files
    fetch(`/api/repos/${repo.id}/qmd-files`)
      .then(res => res.json())
      .then(setQmdFiles);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <img src={user.avatar_url} alt="User avatar" width="50" style={{ borderRadius: '50%' }} />
        <h1>Welcome, {user.username}!</h1>
      </div>

      <h2>My Repositories</h2>
      <form onSubmit={handleAddRepo}>
        <input
          type="text"
          value={newRepoUrl}
          onChange={(e) => setNewRepoUrl(e.target.value)}
          placeholder="https://github.com/username/my-paper"
          style={{ width: '300px', marginRight: '10px' }}
        />
        <button type="submit">Add Repository</button>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </form>

      <div style={{ marginTop: '2rem' }}>
        {repos.map((repo) => (
          <div key={repo.id} onClick={() => handleSelectRepo(repo)} style={{ cursor: 'pointer', padding: '10px', border: selectedRepo?.id === repo.id ? '2px solid blue' : '1px solid #ccc', marginBottom: '5px' }}>
            <strong>{repo.full_name}</strong>
          </div>
        ))}
      </div>

      {selectedRepo && (
        <div style={{ marginTop: '2rem' }}>
          <h3>Quarto Files in {selectedRepo.name}</h3>
          {qmdFiles.length > 0 ? (
            <ul>
              {qmdFiles.map((file) => (
                <li key={file}>{file.replace(/\\/g, '/')}</li> // Normalize path separators
              ))}
            </ul>
          ) : (
            <p>No .qmd files found or still loading...</p>
          )}
        </div>
      )}
    </div>
  );
}

export default DashboardPage;