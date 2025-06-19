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
import CommentSidebar from '../components/editor/CommentSidebar'; // Import CommentSidebar
import './EditorPage.css';

function CollabEditorPage() {
  const { shareToken } = useParams();
  const [status, setStatus] = useState('Loading...');
  const [error, setError] = useState('');
  const [comments, setComments] = useState([]);
  const [activeCommentId, setActiveCommentId] = useState(null);

  // --- Auto-save logic ---
  const saveDocument = useCallback(
    debounce((doc) => {
      setStatus('Saving...');
      fetch(`/api/collab/${shareToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
        // TODO: When backend supports it, send comments as well:
        // body: JSON.stringify({ document: doc, comments: comments }),
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
      FigureReference,
      CommentMark.configure({
        HTMLAttributes: { class: 'comment-mark' }, // For styling
        onCommentClick: (commentId) => setActiveCommentId(commentId),
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
    },
  });

  useEffect(() => {
    if (!editor || !shareToken) return;

    // Simulate loading comments with the document if they were persisted
    // For now, comments are local and start empty
    // if (data.comments) setComments(data.comments);

    fetch(`/api/collab/${shareToken}`)
      .then(res => res.ok ? res.json() : Promise.reject(res))
      .then(data => {
        // The backend now returns ProseMirror JSON with block keys
        // and includes metadata/bibliography blocks
        // TODO: When backend supports it, load comments as well:
        // if (data.comments) setComments(data.comments);
        editor.commands.setContent(data);
        setStatus('Loaded');
      })
      .catch(async (err) => {
        console.error('Failed to load document:', err);
        setError('This share link is invalid or has expired.');
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

    const commentText = prompt('Enter your comment:');
    if (commentText) {
      const newCommentId = `comment-${Date.now()}`;
      setComments([...comments, { id: newCommentId, text: commentText }]);
      // Important: We need to ensure this doesn't trigger a save if comments are local
      // For now, we'll assume comments are not part of the collaborative doc directly
      editor.chain().focus().setComment(newCommentId).run();
      setActiveCommentId(newCommentId);
    }
  };

  return (
    <div className="editor-page-container">
      <header className="editor-header">
        <h3>Quartorium Collaborative Editor</h3>
        <div>
          <button onClick={addComment} style={{ marginRight: '1rem' }}>Add Comment</button>
          <span>Status: {status}</span>
        </div>
      </header>
      <div className="editor-main-area">
        <main className="editor-content-area">
          {error ? <p style={{color: 'red'}}>{error}</p> : <EditorContent editor={editor} />}
        </main>
        <CommentSidebar
          comments={comments}
          activeCommentId={activeCommentId}
          onCommentSelect={setActiveCommentId} // Allow clicking on sidebar to activate
        />
      </div>
    </div>
  );
}

export default CollabEditorPage;