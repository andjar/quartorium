import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import debounce from 'lodash.debounce';

import QuartoBlock from '../components/editor/QuartoBlock';
// import { dummyProseMirrorDoc } from '../dummy-data/dummyDoc'; // Will be replaced by fetched content
import './EditorPage.css';

function EditorPage() {
  const navigate = useNavigate();
  const { repoId, '*': filepath } = useParams(); // Get repoId and filepath from URL

  const [status, setStatus] = useState('Loading...');
  const [baseCommitHash, setBaseCommitHash] = useState(null);
  const [editorContent, setEditorContent] = useState(null); // To store fetched content

  // Debounced save function for Prosemirror JSON
  const saveJsonDocument = useCallback(
    debounce(async (currentJsonContent) => {
      if (!baseCommitHash) {
        setStatus('Error: Base commit hash not available. JSON not saved.');
        return;
      }
      if (!repoId || !filepath) {
        setStatus('Error: Repository ID or filepath not available. JSON not saved.');
        console.error("repoId or filepath is missing", {repoId, filepath});
        return;
      }

      setStatus('Saving JSON...');
      try {
        const response = await fetch('/api/docs/save-json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo_id: parseInt(repoId), // Ensure repoId is an integer
            filepath: filepath,
            prosemirror_json: JSON.stringify(currentJsonContent),
            base_commit_hash: baseCommitHash,
          }),
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        setStatus('JSON Saved');
        // Optionally, update baseCommitHash if the backend returns a new one after this save,
        // but typically this specific endpoint might not return a new commit hash.
      } catch (error) {
        console.error('Failed to save JSON document:', error);
        setStatus(`JSON Save Failed: ${error.message}`);
      }
    }, 2000), // Debounce time: 2 seconds
    [repoId, filepath, baseCommitHash] // Dependencies for useCallback
  );

  const editor = useEditor({
    extensions: [StarterKit, QuartoBlock],
    content: editorContent, // Initial content will be null, then updated by fetch
    editable: true,
    onUpdate: ({ editor: currentEditor }) => {
      setStatus('Unsaved JSON changes');
      saveJsonDocument(currentEditor.getJSON());
    },
  }, [editorContent]); // Re-initialize editor when editorContent changes

  // Fetch document content on component mount
  useEffect(() => {
    if (!repoId || !filepath) {
      setStatus('Error: Missing repository ID or filepath in URL.');
      console.error("Missing repoId or filepath for fetching document.");
      return;
    }
    setStatus('Loading document...');
    fetch(`/api/docs/view?repoId=${repoId}&filepath=${filepath}`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        if (data.prosemirrorJson && data.currentCommitHash) {
          // The backend returns prosemirrorJson which is already an object.
          // It might be a string if it was stringified twice, ensure it's an object for the editor.
          let contentToLoad = data.prosemirrorJson;
          if (typeof data.prosemirrorJson === 'string') {
            try {
              contentToLoad = JSON.parse(data.prosemirrorJson);
            } catch (e) {
              console.error("Failed to parse prosemirrorJson from string:", e);
              throw new Error("Invalid JSON format received from backend.");
            }
          }

          setEditorContent(contentToLoad);
          setBaseCommitHash(data.currentCommitHash);
          setStatus('Loaded');
        } else {
          throw new Error('Invalid data structure from backend. Missing prosemirrorJson or currentCommitHash.');
        }
      })
      .catch(error => {
        console.error('Failed to load document:', error);
        setStatus(`Error loading document: ${error.message}`);
        // setEditorContent(dummyProseMirrorDoc); // Fallback to dummy data or show error
      });
  }, [repoId, filepath]);

  // Update editor content if it changes (e.g. fetched)
  useEffect(() => {
    if (editor && editorContent && !editor.isDestroyed) {
        // Check if the new content is substantially different from current editor content
        // to prevent unnecessary updates or cursor jumps.
        // This simple check might need to be more sophisticated.
        if (JSON.stringify(editor.getJSON()) !== JSON.stringify(editorContent)) {
            editor.commands.setContent(editorContent);
        }
    }
  }, [editorContent, editor]);


  const handleCommit = async () => {
    if (!editor || !baseCommitHash) {
      setStatus('Error: Editor not ready or no base commit hash.');
      return;
    }
    if (!repoId || !filepath) {
        setStatus('Error: Repository ID or filepath not available for commit.');
        console.error("repoId or filepath is missing for commit", {repoId, filepath});
        return;
    }

    const currentJson = editor.getJSON();
    setStatus('Committing...');
    try {
      const response = await fetch('/api/docs/commit-qmd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_id: parseInt(repoId),
          filepath: filepath,
          prosemirror_json: JSON.stringify(currentJson), // Send as string
          base_commit_hash: baseCommitHash,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
      const result = await response.json(); // Assuming backend returns { message: '...', newCommitHash: '...' }
      setStatus('Committed');
      if (result.newCommitHash) {
        setBaseCommitHash(result.newCommitHash); // Update base commit hash
        console.log('Successfully committed. New base commit hash:', result.newCommitHash);
      } else {
        console.log('Successfully committed. No new commit hash returned.');
      }
      // Optionally, trigger a re-fetch or update editor state if needed
    } catch (error) {
      console.error('Failed to commit document:', error);
      setStatus(`Commit Failed: ${error.message}`);
    }
  };

  if (!editor) {
    return <div>Loading Editor... Current Status: {status}</div>;
  }

  return (
    <div className="editor-page-container">
      <header className="editor-header">
        <button onClick={() => navigate('/dashboard')}>← Back to Dashboard</button>
        <div>
          <span>Status: {status} (Commit: {baseCommitHash ? baseCommitHash.substring(0, 7) : 'N/A'})</span>
          <button onClick={handleCommit} style={{ marginLeft: '1rem' }} disabled={status.includes('Saving') || status.includes('Committing...')}>
            Commit
          </button>
        </div>
      </header>

      <main className="editor-content-area">
        <EditorContent editor={editor} />
      </main>
    </div>
  );
}

export default EditorPage;