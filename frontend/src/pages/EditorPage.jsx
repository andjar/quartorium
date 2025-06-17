import React, { useState } from 'react'; // Add useState
import { useNavigate } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import QuartoBlock from '../components/editor/QuartoBlock';
import { dummyProseMirrorDoc } from '../dummy-data/dummyDoc';

function EditorPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('Unsaved'); // To show save status

  const editor = useEditor({
    extensions: [StarterKit, QuartoBlock],
    content: dummyProseMirrorDoc,
    editable: true,
    // Add an event handler that fires on every change
    onUpdate: ({ editor }) => {
      setStatus('Unsaved');
    },
  });

  const handleSave = () => {
    // Get the latest document state as JSON
    const currentJson = editor.getJSON();
    
    // In a real app, we would POST this JSON to our backend
    console.log("--- Saving Document ---");
    console.log(JSON.stringify(currentJson, null, 2)); // Pretty-print the JSON
    console.log("-----------------------");

    setStatus('Saved!');
    setTimeout(() => setStatus(''), 2000); // Clear status after 2 seconds
  };
  
  const documentTitle = editor?.getHTML().includes('<h1>') 
    ? editor.state.doc.firstChild.textContent 
    : 'Untitled Document';

  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => navigate('/dashboard')}>← Back to Dashboard</button>
        <div>
          <span>Status: {status}</span>
          <button onClick={handleSave} style={{ marginLeft: '1rem' }}>Save</button>
        </div>
      </div>
      <h1 style={{ marginTop: '1rem', borderBottom: '1px solid #ccc', paddingBottom: '0.5rem' }}>
        {documentTitle}
      </h1>
      <EditorContent editor={editor} />
    </div>
  );
}

export default EditorPage;