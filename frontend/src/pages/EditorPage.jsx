import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import debounce from 'lodash.debounce';
import CommentMark from '../components/editor/CommentMark';
import CommentSidebar from '../components/editor/CommentSidebar';
import QuartoBlock from '../components/editor/QuartoBlock';
import './EditorPage.css';

function EditorPage() {
  const navigate = useNavigate();
  const { repoId, '*': filepath } = useParams(); // From main

  // Combined state from both branches
  const [status, setStatus] = useState('Loading...');
  const [baseCommitHash, setBaseCommitHash] = useState(null);
  const [editorContent, setEditorContent] = useState(null);
  const [comments, setComments] = useState([]);
  const [activeCommentId, setActiveCommentId] = useState(null);

  // Debounced save function from main
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

      // TODO: When backend supports it, send comments along with the document.
      setStatus('Saving JSON...');
      try {
        const response = await fetch('/api/docs/save-json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo_id: parseInt(repoId),
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
      } catch (error) {
        console.error('Failed to save JSON document:', error);
        setStatus(`JSON Save Failed: ${error.message}`);
      }
    }, 2000),
    [repoId, filepath, baseCommitHash]
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      QuartoBlock,
      // Add CommentMark extension from feature/commenting
      CommentMark.configure({
        HTMLAttributes: { class: 'comment-mark' },
        onCommentClick: (commentId) => setActiveCommentId(commentId),
      }),
    ],
    content: editorContent, // Use editorContent state from main
    editable: true,
    onUpdate: ({ editor: currentEditor }) => {
      setStatus('Unsaved JSON changes');
      saveJsonDocument(currentEditor.getJSON());
    },
  }, [editorContent]); // Re-initialize editor when editorContent changes

  // Fetch document content from API (logic from main)
  useEffect(() => {
    if (!repoId || !filepath) {
      setStatus('Error: Missing repository ID or filepath in URL.');
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
          // TODO: When backend supports it, load comments here.
          // if (data.comments) setComments(data.comments);
        } else {
          throw new Error('Invalid data structure from backend.');
        }
      })
      .catch(error => {
        console.error('Failed to load document:', error);
        setStatus(`Error loading document: ${error.message}`);
      });
  }, [repoId, filepath]);

  // Update editor content when it's fetched (from main)
  useEffect(() => {
    if (editor && editorContent && !editor.isDestroyed) {
        if (JSON.stringify(editor.getJSON()) !== JSON.stringify(editorContent)) {
            editor.commands.setContent(editorContent);
        }
    }
  }, [editorContent, editor]);

  // Commit handler from main
  const handleCommit = async () => {
    if (!editor || !baseCommitHash) {
      setStatus('Error: Editor not ready or no base commit hash.');
      return;
    }
    if (!repoId || !filepath) {
        setStatus('Error: Repository ID or filepath not available for commit.');
        return;
    }

    const currentJson = editor.getJSON();
    setStatus('Committing...');
    try {
      // TODO: When backend supports it, send comments along with commit.
      const response = await fetch('/api/docs/commit-qmd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_id: parseInt(repoId),
          filepath: filepath,
          prosemirror_json: JSON.stringify(currentJson),
          base_commit_hash: baseCommitHash,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      setStatus('Committed');
      if (result.newCommitHash) {
        setBaseCommitHash(result.newCommitHash);
        console.log('Successfully committed. New base commit hash:', result.newCommitHash);
      }
    } catch (error) {
      console.error('Failed to commit document:', error);
      setStatus(`Commit Failed: ${error.message}`);
    }
  };

  // Add comment handler from feature/commenting
  const addComment = () => {
    if (!editor || !editor.state.selection.from || editor.state.selection.empty) {
      alert('Please select text to comment on.');
      return;
    }
    const commentText = prompt('Enter your comment:');
    if (commentText) {
      const newCommentId = `comment-${Date.now()}`;
      setComments([...comments, { id: newCommentId, text: commentText }]);
      editor.chain().focus().setComment(newCommentId).run();
      setActiveCommentId(newCommentId);
    }
  };

  if (!editor) {
    return <div>Loading Editor... Current Status: {status}</div>;
  }

  return (
    <div className="editor-page-container">
      <header className="editor-header">
        <button onClick={() => navigate('/dashboard')}>← Back to Dashboard</button>
        <button onClick={addComment} style={{ marginLeft: '1rem' }}>Add Comment</button>
        <div>
          <span>Status: {status} (Commit: {baseCommitHash ? baseCommitHash.substring(0, 7) : 'N/A'})</span>
          <button onClick={handleCommit} style={{ marginLeft: '1rem' }} disabled={status.includes('Saving') || status.includes('Committing...')}>
            Commit
          </button>
        </div>
      </header>

      <div className="editor-main-area">
        <main className="editor-content-area">
          <EditorContent editor={editor} />
        </main>
        <CommentSidebar
          comments={comments}
          activeCommentId={activeCommentId}
          onCommentSelect={setActiveCommentId}
        />
      </div>
    </div>
  );
}

export default EditorPage;