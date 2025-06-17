import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import QuartoBlock from '../components/editor/QuartoBlock';

function EditorPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [docContent, setDocContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const editor = useEditor({
    extensions: [
      StarterKit,
      QuartoBlock, // Add our custom node
    ],
    content: docContent,
    editable: false, // This is a read-only view
  });

  useEffect(() => {
    // Update TipTap content when our state changes
    if (docContent && editor) {
      editor.commands.setContent(docContent);
    }
  }, [docContent, editor]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const repoId = params.get('repoId');
    const filepath = params.get('filepath');

    if (!repoId || !filepath) {
      setError('Missing repository or file information.');
      setLoading(false);
      return;
    }

    fetch(`/api/docs/view?repoId=${repoId}&filepath=${filepath}`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : Promise.reject(res))
      .then(data => {
        setDocContent(data);
      })
      .catch(async err => {
        const errData = await err.json();
        setError(errData.error || 'Failed to load document.');
      })
      .finally(() => setLoading(false));
  }, [location.search]);

  if (loading) return <div>Loading document...</div>;
  if (error) return <div style={{ color: 'red' }}>Error: {error}</div>;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
      <button onClick={() => navigate('/dashboard')}>← Back to Dashboard</button>
      <h1>Editor</h1>
      <EditorContent editor={editor} />
    </div>
  );
}

export default EditorPage;