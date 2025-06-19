import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import debounce from 'lodash.debounce';
import QuartoBlock from '../components/editor/QuartoBlock';
import Citation from '../components/editor/Citation';
import FigureReference from '../components/editor/FigureReference';
import CommentMark from '../components/editor/CommentMark';
import CommentSidebar from '../components/editor/CommentSidebar';
import './EditorPage.css';

function CollabEditorPage() {
  const { shareToken } = useParams();
  const [status, setStatus] = useState('Loading...');
  const [error, setError] = useState('');
  const [baseCommitHash, setBaseCommitHash] = useState(null);
  const [comments, setComments] = useState([]); // Existing state for comments
  const [activeCommentId, setActiveCommentId] = useState(null);

  // Placeholder for current user - replace with actual user context/auth later
  const currentUser = { id: `user-${Math.random().toString(36).substr(2, 9)}`, name: 'Current User' };


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
        body: JSON.stringify({ base_commit_hash: baseCommitHash }),
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

  const saveDocument = useCallback(
    debounce(async (currentJsonContent) => {
      if (!baseCommitHash) {
        setStatus('Error: Base commit hash not available. Live changes not saved.');
        return;
      }
      // TODO: When backend supports it, send comments as well.
      // For now, only the document content is saved collaboratively.
      setStatus('Saving live changes...');
      try {
        const response = await fetch(`/api/collab/${shareToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prosemirror_json: JSON.stringify(currentJsonContent),
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
    }, 2000),
    [shareToken, baseCommitHash]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false, // Keep other StarterKit options as they are
        document: false, // Assuming 'document' is not a standard option here, ensure StarterKit is configured correctly
        // Ensure other relevant StarterKit modules are enabled or disabled as needed.
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        editable: false, // Typically, links are not directly editable text-wise in editor, but through a modal/popup
      }),
      QuartoBlock,
      Citation,
      FigureReference,
      CommentMark.configure({
        HTMLAttributes: { class: 'comment-mark' },
        onCommentClick: (commentId) => setActiveCommentId(commentId),
        activeCommentId: activeCommentId, // Pass activeCommentId here
      }),
    ],
    content: {
      type: 'doc',
      content: []
    },
    editable: true,
    onUpdate: ({ editor }) => {
      setStatus('Unsaved');
      saveDocument(editor.getJSON());

      // Comment deletion synchronization
      const docCommentIds = new Set();
      editor.state.doc.descendants((node) => {
        if (node.marks) {
          node.marks.forEach(mark => {
            if (mark.type.name === 'comment' && mark.attrs.commentId) {
              docCommentIds.add(mark.attrs.commentId);
            }
          });
        }
      });

      setComments(prevComments => prevComments.filter(comment => docCommentIds.has(comment.id)));
      if (activeCommentId && !docCommentIds.has(activeCommentId)) {
        setActiveCommentId(null);
      }
    },
  });

  useEffect(() => {
    if (!editor || !shareToken) return;
    setStatus('Loading document...');

    // Fetching from /api/docs/view as per backend changes in previous subtask for initial load
    // This endpoint should return { prosemirrorJson, comments, currentCommitHash }
    // If /api/collab/${shareToken} is the correct one for *live collab data*, it should also adopt this structure.
    // For now, assuming /api/docs/view for initial load as it was modified to return comments.
    // If this page is *only* for collab links, then /api/collab/${shareToken} needs to be updated in backend
    // to match the { prosemirrorJson, comments, currentCommitHash } structure.
    // Sticking to /api/collab/ for now as per original description of CollabEditorPage
    fetch(`/api/collab/${shareToken}`)
      .then(res => {
        if (!res.ok) {
          return res.json().then(errData => Promise.reject(errData.error || `HTTP error! status: ${res.status}`))
                           .catch(() => Promise.reject(`HTTP error! status: ${res.status}`));
        }
        return res.json();
      })
      .then(data => {
        // Expecting data to have { prosemirrorJson, comments, currentCommitHash }
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
          // Load comments if provided by the backend
          if (data.comments) {
            setComments(Array.isArray(data.comments) ? data.comments : []);
          } else {
            setComments([]); // Initialize as empty if not provided
          }
          setStatus('Loaded');
        } else {
          throw new Error('Invalid data structure from backend. Missing prosemirrorJson or currentCommitHash.');
        }
      })
      .catch(errMsg => {
        console.error('Failed to load document:', errMsg);
        setError(typeof errMsg === 'string' ? errMsg : 'This share link is invalid or has expired.');
        editor.commands.setContent({
          type: 'doc',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Could not load document.' }]
          }]
        });
      });
  }, [editor, shareToken]);

  const addComment = () => {
    if (!editor || !editor.state.selection.from || editor.state.selection.empty) {
      alert('Please select text to comment on.');
      return;
    }

    const commentText = prompt('Enter your comment:'); // Keep prompt for now
    if (commentText) {
      const newCommentId = `c-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const newComment = {
        id: newCommentId,
        author: currentUser.id, // Using placeholder
        timestamp: new Date().toISOString(),
        status: "open",
        thread: [
          {
            text: commentText,
            author: currentUser.id, // Using placeholder
            timestamp: new Date().toISOString()
          }
        ]
      };
      setComments(prevComments => [...prevComments, newComment]);
      editor.chain().focus().setComment(newCommentId).run(); // Use setComment to apply the mark
      setActiveCommentId(newCommentId);
    }
  };

  return (
    <div className="editor-page-container">
      <header className="editor-header">
        <h3>Quartorium Collaborative Editor</h3>
        <div>
          <button onClick={addComment} style={{ marginRight: '1rem' }}>Add Comment</button>
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
      <div className="editor-main-area">
        <main className="editor-content-area">
          {error ? <p style={{color: 'red'}}>{error}</p> : <EditorContent editor={editor} />}
        </main>
        <CommentSidebar
          comments={comments}
          setComments={setComments} // Pass setComments
          activeCommentId={activeCommentId}
          onCommentSelect={setActiveCommentId} // This is for selecting/activating a comment from the sidebar
          currentUser={currentUser} // Pass currentUser
        />
      </div>
    </div>
  );
}

export default CollabEditorPage;