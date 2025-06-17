import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import QuartoBlock from '../components/editor/QuartoBlock';
import { dummyProseMirrorDoc } from '../dummy-data/dummyDoc';
import './EditorPage.css'; // Import our updated CSS

function EditorPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('Saved');

  const editor = useEditor({
    extensions: [StarterKit, QuartoBlock],
    content: dummyProseMirrorDoc,
    editable: true,
    onUpdate: () => {
      setStatus('Unsaved');
    },
  });

  const handleSave = () => {
    const currentJson = editor.getJSON();
    console.log("Saving Document:", JSON.stringify(currentJson, null, 2));
    setStatus('Saved!');
    setTimeout(() => setStatus('Saved'), 2000);
  };

  return (
    <div className="editor-page-container">
      <header className="editor-header">
        <button onClick={() => navigate('/dashboard')}>← Back to Dashboard</button>
        <div>
          <span>Status: {status}</span>
          <button onClick={handleSave} style={{ marginLeft: '1rem' }}>Save</button>
        </div>
      </header>

      <main className="editor-content-area">
        <EditorContent editor={editor} />
      </main>
    </div>
  );
}

export default EditorPage;