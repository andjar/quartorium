import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactDiffViewer from 'react-diff-viewer';

function ReviewPage() {
  const { shareToken } = useParams();
  const navigate = useNavigate();
  const [diffData, setDiffData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/docs/diff/${shareToken}`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : Promise.reject(res))
      .then(data => setDiffData(data))
      .catch(() => setError('Could not load diff.'))
      .finally(() => setLoading(false));
  }, [shareToken]);

  const handleMerge = () => {
    if (!window.confirm('Are you sure you want to merge these changes? This action cannot be undone.')) {
        return;
    }
    fetch(`/api/docs/merge/${shareToken}`, { method: 'POST', credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('Merge failed');
        alert('Merge successful!');
        navigate('/dashboard');
      })
      .catch(err => alert(err.message));
  };

  if (loading) return <div>Loading diff...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;

  return (
    <div style={{ padding: '1rem', textAlign: 'left' }}>
      <button onClick={() => navigate('/dashboard')}>← Back to Dashboard</button>
      <h2>Reviewing Changes from: {diffData?.branchName}</h2>
      <p>Review the changes below. When you are ready, you can merge them into your main branch.</p>
      <button onClick={handleMerge} style={{ backgroundColor: 'green', color: 'white', padding: '10px 20px', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
        Merge All Changes
      </button>
      <hr style={{ margin: '1rem 0' }} />
      <ReactDiffViewer
        oldValue={diffData?.mainContent}
        newValue={diffData?.collabContent}
        splitView={true}
        compareMethod="diffLines"
      />
    </div>
  );
}

export default ReviewPage;