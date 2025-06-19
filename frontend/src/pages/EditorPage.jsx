import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CommentMark from '../components/editor/CommentMark'; // Import CommentMark
import CommentSidebar from '../components/editor/CommentSidebar'; // Import CommentSidebar

import QuartoBlock from '../components/editor/QuartoBlock';
import { dummyProseMirrorDoc } from '../dummy-data/dummyDoc';
import './EditorPage.css'; // Import our updated CSS

function EditorPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('Saved');
  const [comments, setComments] = useState([]);
  const [activeCommentId, setActiveCommentId] = useState(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      QuartoBlock,
      CommentMark.configure({
        HTMLAttributes: { class: 'comment-mark' },
        onCommentClick: (commentId) => setActiveCommentId(commentId),
      }),
    ],
        // content will be set by useEffect after checking localStorage
    editable: true,
    onUpdate: () => {
      setStatus('Unsaved');
    },
  });

      useEffect(() => {
        const savedDocument = localStorage.getItem('editorDocument');
        const savedComments = localStorage.getItem('editorComments');

        if (savedDocument && editor) {
          editor.commands.setContent(JSON.parse(savedDocument));
        } else if (editor) {
          // Set initial content if nothing is saved - matches existing behavior
          editor.commands.setContent(dummyProseMirrorDoc);
        }
        if (savedComments) {
          setComments(JSON.parse(savedComments));
        }
      }, [editor]); // Depend on editor to ensure it's initialized

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

  const handleSave = () => {
    const currentJson = editor.getJSON();
    console.log("Saving Document:", JSON.stringify(currentJson, null, 2));
    localStorage.setItem('editorDocument', JSON.stringify(currentJson));
    localStorage.setItem('editorComments', JSON.stringify(comments));
    setStatus('Saved!');
    setTimeout(() => setStatus('Saved'), 2000);
  };

  return (
    <div className="editor-page-container">
      <header className="editor-header">
        <button onClick={() => navigate('/dashboard')}>← Back to Dashboard</button>
        <button onClick={addComment} style={{ marginLeft: '1rem' }}>Add Comment</button>
        <div>
          <span>Status: {status}</span>
          <button onClick={handleSave} style={{ marginLeft: '1rem' }}>Save</button>
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