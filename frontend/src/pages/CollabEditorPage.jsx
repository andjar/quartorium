import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import debounce from 'lodash.debounce';
import QuartoBlock from '../components/editor/QuartoBlock';
import Citation from '../components/editor/Citation';
import FigureReference from '../components/editor/FigureReference';
import './EditorPage.css';

function CollabEditorPage() {
  const { shareToken } = useParams();
  const [status, setStatus] = useState('Loading...');
  const [error, setError] = useState('');
  const [baseCommitHash, setBaseCommitHash] = useState(null);

  const handleCollabCommit = async () => {
    if (!baseCommitHash) {
      setStatus('Error: Base commit hash not available for commit.');
      return;
    }
    if (!shareToken) {
        setStatus('Error: Share token not available for commit.');
        return;
    }
    setStatus('Committing collab changes...');
    try {
      const response = await fetch(`/api/collab/${shareToken}/commit-qmd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_commit_hash: baseCommitHash }), // shareToken is in URL
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      setStatus('Collab changes committed');
      if (result.newCommitHash) {
        setBaseCommitHash(result.newCommitHash);
        console.log('Collab commit successful. New base commit hash:', result.newCommitHash);
      } else {
        console.log('Collab commit successful. No new commit hash returned.');
      }
    } catch (commitError) {
      console.error('Failed to commit collab changes:', commitError);
      setStatus(`Collab commit failed: ${commitError.message}`);
    }
  };

  // --- Auto-save logic ---
  const saveDocument = useCallback(
    debounce(async (currentJsonContent) => {
      if (!baseCommitHash) {
        setStatus('Error: Base commit hash not available. Live changes not saved.');
        return;
      }
      setStatus('Saving live changes...');
      try {
        const response = await fetch(`/api/collab/${shareToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prosemirror_json: JSON.stringify(currentJsonContent), // Ensure it's stringified
            base_commit_hash: baseCommitHash,
          }),
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        setStatus('Live changes saved');
      } catch (saveError) {
        console.error('Failed to save live changes:', saveError);
        setStatus(`Live save failed: ${saveError.message}`);
      }
    }, 2000), // Debounce time: 2 seconds
    [shareToken, baseCommitHash] // Added baseCommitHash as a dependency
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable link extension from StarterKit since we're using our own
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        editable: false,
      }),
      QuartoBlock,
      Citation,
      FigureReference
    ],
    content: {
      type: 'doc',
      content: []
    },
    editable: true,
    onUpdate: ({ editor }) => {
      setStatus('Unsaved');
      saveDocument(editor.getJSON());
    },
  });

  useEffect(() => {
    if (!editor || !shareToken) return;
    setStatus('Loading document...');
    fetch(`/api/collab/${shareToken}`)
      .then(res => {
        if (!res.ok) {
          // Try to parse error from backend if available
          return res.json().then(errData => Promise.reject(errData.error || `HTTP error! status: ${res.status}`))
                           .catch(() => Promise.reject(`HTTP error! status: ${res.status}`)); // Fallback if no JSON error body
        }
        return res.json();
      })
      .then(data => {
        if (data.prosemirrorJson && data.currentCommitHash) {
          let contentToLoad = data.prosemirrorJson;
          if (typeof data.prosemirrorJson === 'string') {
            try {
              contentToLoad = JSON.parse(data.prosemirrorJson);
            } catch (e) {
              console.error("Failed to parse prosemirrorJson from string:", e);
              throw new Error("Invalid JSON format received from backend.");
            }
          }
          editor.commands.setContent(contentToLoad);
          setBaseCommitHash(data.currentCommitHash);
          setStatus('Loaded');
        } else {
          throw new Error('Invalid data structure from backend. Missing prosemirrorJson or currentCommitHash.');
        }
      })
      .catch(errMsg => { // Catches errors from fetch chain (network, parsing, or explicit Promise.reject)
        console.error('Failed to load document:', errMsg);
        setError(typeof errMsg === 'string' ? errMsg : 'This share link is invalid or has expired.');
        // Clear editor or show error content
        editor.commands.setContent({
          type: 'doc',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Could not load document.' }]
          }]
        });
      });
  }, [editor, shareToken]);

  return (
    <div className="editor-page-container">
      <header className="editor-header">
        <h3>Quartorium Collaborative Editor</h3>
        <div>
          <span>Status: {status} (Commit: {baseCommitHash ? baseCommitHash.substring(0, 7) : 'N/A'})</span>
          <button
            onClick={handleCollabCommit}
            style={{ marginLeft: '1rem' }}
            disabled={!baseCommitHash || status.includes('Saving') || status.includes('Committing...')}
          >
            Commit to Collaboration Branch
          </button>
        </div>
      </header>
      <main className="editor-content-area">
        {error ? <p style={{color: 'red'}}>{error}</p> : <EditorContent editor={editor} />}
      </main>
    </div>
  );
}

export default CollabEditorPage;