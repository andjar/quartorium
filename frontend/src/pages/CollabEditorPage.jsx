import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import debounce from 'lodash.debounce';
import QuartoBlock from '../components/editor/QuartoBlock';
import './EditorPage.css';

function CollabEditorPage() {
  const { shareToken } = useParams();
  const [status, setStatus] = useState('Loading...');
  const [error, setError] = useState('');

  // --- Auto-save logic ---
  const saveDocument = useCallback(
    debounce((doc) => {
      setStatus('Saving...');
      fetch(`/api/collab/${shareToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      })
      .then(res => {
        if (!res.ok) throw new Error('Save failed');
        setStatus('Saved');
      })
      .catch(() => setStatus('Save failed'));
    }, 2000), // Debounce time: 2 seconds
    [shareToken]
  );

  const editor = useEditor({
    extensions: [
      StarterKit, // You can keep StarterKit
      Link.configure({
        openOnClick: false, // Disable clicking on links
        autolink: false,    // Disable automatic link creation
        editable: false,    // Make links non-editable
        // You might want to ensure that links from StarterKit are disabled if you add Link separately
        // Or configure StarterKit: StarterKit.configure({ link: { /* options */ }})
      }),
      QuartoBlock
    ],
    content: '',
    editable: true,
    onUpdate: ({ editor }) => {
      setStatus('Unsaved');
      saveDocument(editor.getJSON());
    },
  });

  useEffect(() => {
    if (!editor || !shareToken) return;

    fetch(`/api/collab/${shareToken}`)
      .then(res => res.ok ? res.json() : Promise.reject(res))
      .then(data => {
        editor.commands.setContent(data);
        setStatus('Loaded');
      })
      .catch(async () => {
        setError('This share link is invalid or has expired.');
        editor.commands.setContent('<p style="color:red;">Could not load document.</p>');
      });
  }, [editor, shareToken]);

  return (
    <div className="editor-page-container">
      <header className="editor-header">
        <h3>Quartorium Collaborative Editor</h3>
        <div>
          <span>Status: {status}</span>
        </div>
      </header>
      <main className="editor-content-area">
        {error ? <p style={{color: 'red'}}>{error}</p> : <EditorContent editor={editor} />}
      </main>
    </div>
  );
}

export default CollabEditorPage;