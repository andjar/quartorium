import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import debounce from 'lodash.debounce';
import QuartoBlock from '../components/editor/QuartoBlock';
import Citation from '../components/editor/Citation';
import FigureReference from '../components/editor/FigureReference';
import TableReference from '../components/editor/TableReference.jsx';
import EquationReference from '../components/editor/EquationReference.jsx';
import CommentMark, { commentHighlightPluginKey } from '../components/editor/CommentMark';
import CommentSidebar from '../components/editor/CommentSidebar';
import FloatingCommentButton from '../components/editor/FloatingCommentButton';
import SaveStatus from '../components/editor/SaveStatus';
import SuggestionsViewer from '../components/SuggestionsViewer';
import './EditorPage.css';

function EditorPage() {
  const navigate = useNavigate();
  const { repoId, '*': filepath } = useParams();

  // State management
  const [status, setStatus] = useState('Loading...');
  const [error, setError] = useState('');
  const [baseCommitHash, setBaseCommitHash] = useState(null);
  const [editorContent, setEditorContent] = useState(null);
  const [comments, setComments] = useState([]);
  const [activeCommentId, setActiveCommentId] = useState(null);
  const [docId, setDocId] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const commentsRef = useRef(comments);
  const [isEditorEnabled, setIsEditorEnabled] = useState(true);

  // Update ref whenever comments change
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  // Current user context
  const currentUser = { 
    id: 'author', 
    name: 'Author' 
  };

  // Debounced save function
  const saveJsonDocument = useCallback(
    debounce(async (currentJsonContent) => {
      if (!baseCommitHash) {
        setStatus('Error: Base commit hash not available. JSON not saved.');
        console.warn('Cannot save: no base commit hash available');
        return;
      }
      if (!repoId || !filepath) {
        setStatus('Error: Repository ID or filepath not available. JSON not saved.');
        console.error("repoId or filepath is missing", {repoId, filepath});
        return;
      }

      console.log('Saving document...', { repoId, filepath, baseCommitHash });
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
        console.log('Document saved successfully');
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
      StarterKit.configure({
        link: false,
        bold: true,
        italic: true,
        strike: true,
        heading: true,
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        editable: false,
      }),
      QuartoBlock,
      Citation,
      FigureReference,
      TableReference,
      EquationReference,
      CommentMark.configure({
        onCommentClick: (id) => {
          setActiveCommentId(id);
        },
      }),
    ],
    content: {
      type: 'doc',
      content: []
    },
    editable: true,
    onUpdate: ({ editor }) => {
      console.log('Editor update triggered');
      setStatus('Unsaved');
      saveJsonDocument(editor.getJSON());

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

      console.log('Comment IDs found in document:', Array.from(docCommentIds));
      console.log('Current comments state before filtering:', comments);
      
      setComments(prevComments => {
        const filteredComments = prevComments.filter(comment => docCommentIds.has(comment.id));
        console.log('Comments after filtering:', filteredComments);
        return filteredComments;
      });
      
      if (activeCommentId && !docCommentIds.has(activeCommentId)) {
        setActiveCommentId(null);
      }
    },
    onCreate: ({ editor }) => {
      console.log('Editor created successfully');
      console.log('Editor instance:', editor);
      console.log('Editor is editable:', editor.isEditable);
      console.log('Editor content:', editor.getJSON());
    },
  }, []);

  // Comment highlight effect
  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      console.log('Editor not ready or destroyed, skipping transaction');
      return;
    }

    console.log('Dispatching comment highlight transaction for activeId:', activeCommentId);
    
    const transaction = editor.state.tr.setMeta(commentHighlightPluginKey, {
      activeId: activeCommentId,
    });
    
    console.log('Transaction created, checking meta:', transaction.getMeta(commentHighlightPluginKey));
    editor.view.dispatch(transaction);
    
    console.log('Transaction dispatched successfully');

  }, [activeCommentId, editor]);

  // Save when comments change
  useEffect(() => {
    if (editor && comments.length > 0) {
      console.log('Comments changed, triggering save...');
      const timeoutId = setTimeout(() => {
        saveJsonDocument(editor.getJSON());
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [comments, editor]);

  // Debug logging for editor state
  useEffect(() => {
    console.log('Editor state:', {
      editor: !!editor,
      editorContent: !!editorContent,
      baseCommitHash,
      status
    });
  }, [editor, editorContent, baseCommitHash, status]);

  // Fetch document content from API
  useEffect(() => {
    if (!editor || !repoId || !filepath) return;
    
    setStatus('Loading document...');
    console.log('Loading document for repoId:', repoId, 'filepath:', filepath);

    fetch(`/api/docs/view?repoId=${repoId}&filepath=${filepath}`)
      .then(res => {
        console.log('API response status:', res.status);
        if (!res.ok) {
          return res.json().then(errData => Promise.reject(errData.error || `HTTP error! status: ${res.status}`))
                           .catch(() => Promise.reject(`HTTP error! status: ${res.status}`));
        }
        return res.json();
      })
      .then(data => {
        console.log('API response data:', data);
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
          console.log('Setting editor content:', contentToLoad);
          editor.commands.setContent(contentToLoad);
          setBaseCommitHash(data.currentCommitHash);
          
          // Load comments if provided by the backend
          if (data.comments) {
            setComments(Array.isArray(data.comments) ? data.comments : []);
          } else {
            setComments([]);
          }
          setStatus('Loaded');
        } else {
          console.error('Invalid data structure:', data);
          throw new Error('Invalid data structure from backend. Missing prosemirrorJson or currentCommitHash.');
        }
      })
      .catch(errMsg => {
        console.error('Failed to load document:', errMsg);
        setError(typeof errMsg === 'string' ? errMsg : 'Failed to load document.');
        console.log('Setting fallback content');
        editor.commands.setContent({
          type: 'doc',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Could not load document.' }]
          }]
        });
      });
  }, [editor, repoId, filepath]);

  // Fetch document ID for suggestions
  useEffect(() => {
    if (!repoId || !filepath) return;

    const fetchDocId = async () => {
      try {
        const response = await fetch(`/api/docs/document-id?repoId=${repoId}&filepath=${filepath}`, { credentials: 'include' });
        if (response.ok) {
          const data = await response.json();
          setDocId(data.docId);
        } else if (response.status === 404) {
          console.log('Document not found in database yet, will be created when needed');
        } else {
          console.warn('Failed to fetch document ID:', response.status, response.statusText);
        }
      } catch (error) {
        console.warn('Failed to fetch document ID:', error);
      }
    };

    fetchDocId();
  }, [repoId, filepath]);

  // Commit handler
  const handleCommit = async () => {
    if (!editor) {
      setStatus('Error: Editor not ready.');
      return;
    }
    if (!baseCommitHash) {
      setStatus('Error: No base commit hash available. Please save the document first.');
      return;
    }
    if (!repoId || !filepath) {
        setStatus('Error: Repository ID or filepath not available for commit.');
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

  // Add comment handler
  const addComment = (commentText) => {
    if (!editor || !editor.state.selection.from || editor.state.selection.empty) {
      alert('Please select text to comment on.');
      return;
    }

    if (!commentText || !commentText.trim()) {
      alert('Please enter comment text.');
      return;
    }

    const newCommentId = `c-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const newComment = {
      id: newCommentId,
      author: currentUser.id,
      timestamp: new Date().toISOString(),
      status: "open",
      thread: [
        {
          text: commentText.trim(),
          author: currentUser.id,
          timestamp: new Date().toISOString()
        }
      ]
    };
    console.log('Adding new comment:', newComment);
    setComments(prevComments => {
      const updatedComments = [...prevComments, newComment];
      console.log('Updated comments state:', updatedComments);
      return updatedComments;
    });
    editor.chain().focus().setComment(newCommentId).run();
    setActiveCommentId(newCommentId);
  };

  const createEmptyComment = () => {
    if (!editor || !editor.state.selection.from || editor.state.selection.empty) {
      alert('Please select text to comment on.');
      return;
    }

    const newCommentId = `c-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const newComment = {
      id: newCommentId,
      author: currentUser.id,
      timestamp: new Date().toISOString(),
      status: "open",
      thread: [],
      isNew: true
    };
    console.log('Creating empty comment:', newComment);
    setComments(prevComments => {
      const updatedComments = [...prevComments, newComment];
      console.log('Updated comments state:', updatedComments);
      return updatedComments;
    });
    editor.chain().focus().setComment(newCommentId).run();
    setActiveCommentId(newCommentId);
  };

  if (!editor) {
    return <div>Loading Editor... Current Status: {status}</div>;
  }

  return (
    <div className="editor-page-container">
      <header className="editor-header">
        <h3>Quartorium</h3>
        <button onClick={() => navigate('/dashboard')}>← Back to Dashboard</button>
        <div>
          <button 
            onClick={createEmptyComment} 
            style={{ margin: '1rem' }}
            disabled={!isEditorEnabled}
          >
            Add Comment
          </button>
          {docId && (
            <button 
              onClick={() => setShowSuggestions(true)} 
              style={{ marginLeft: '1rem', backgroundColor: '#3b82f6', color: 'white' }}
            >
              View Collaborator Suggestions
            </button>
          )}
          <button
            onClick={handleCommit}
            style={{ marginLeft: '1rem' }}
            disabled={!baseCommitHash || status.includes('Saving') || status.includes('Committing...') || !isEditorEnabled}
          >
            Commit
          </button>
        </div>
      </header>
      
      <div className="editor-main-area">
        {/* Left Sidebar for Author Tools */}
        <div className="collaboration-sidebar">
          {/* Save Status */}
          <SaveStatus 
            status={status}
            baseCommitHash={baseCommitHash}
          />
          
          <div className="author-info">
            <h4>Author Tools</h4>
            <p>You are editing as the document author.</p>
            {docId && (
              <button 
                onClick={() => setShowSuggestions(true)} 
                style={{ 
                  width: '100%', 
                  padding: '8px', 
                  backgroundColor: '#3b82f6', 
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                View All Collaborator Suggestions
              </button>
            )}
          </div>
        </div>

        <main className="editor-content-area">
          {error ? <p style={{color: 'red'}}>{error}</p> : <EditorContent editor={editor} />}
          {isEditorEnabled && (
            <FloatingCommentButton 
              editor={editor} 
              onAddComment={createEmptyComment}
            />
          )}
        </main>
        
        <CommentSidebar
          comments={comments}
          setComments={setComments}
          activeCommentId={activeCommentId}
          onCommentSelect={setActiveCommentId}
          currentUser={currentUser}
          onAddComment={addComment}
        />
      </div>

      {showSuggestions && docId && (
        <SuggestionsViewer 
          docId={docId} 
          onClose={() => setShowSuggestions(false)} 
        />
      )}
    </div>
  );
}

export default EditorPage;