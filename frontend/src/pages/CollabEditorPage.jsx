import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import debounce from 'lodash.debounce';
import QuartoBlock from '../components/editor/QuartoBlock';
import Citation from '../components/editor/Citation';
import FigureReference from '../components/editor/FigureReference';
import CommentMark, { commentHighlightPluginKey } from '../components/editor/CommentMark';
import CommentSidebar from '../components/editor/CommentSidebar';
import FloatingCommentButton from '../components/editor/FloatingCommentButton';
import BranchLockStatus from '../components/editor/BranchLockStatus';
import ChangeIndicator from '../components/editor/ChangeIndicator';
import SaveStatus from '../components/editor/SaveStatus';
import './EditorPage.css';

function CollabEditorPage() {
  const { shareToken } = useParams();
  const [status, setStatus] = useState('Loading...');
  const [error, setError] = useState('');
  const [baseCommitHash, setBaseCommitHash] = useState(null);
  const [comments, setComments] = useState([]);
  const [activeCommentId, setActiveCommentId] = useState(null);
  const [collaboratorLabel, setCollaboratorLabel] = useState(null);
  const [lockStatus, setLockStatus] = useState(null);
  const [isEditorEnabled, setIsEditorEnabled] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const commentsRef = useRef(comments);

  // Update ref whenever comments change
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  // Fetch share link info to get collaborator label
  useEffect(() => {
    if (!shareToken) return;
    
    console.log('Fetching share link info for shareToken:', shareToken);
    fetch(`/api/collab/${shareToken}/info`)
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        console.log('Share link info received:', data);
        if (data.collaboratorLabel) {
          console.log('Setting collaborator label from share link info:', data.collaboratorLabel);
          setCollaboratorLabel(data.collaboratorLabel);
        } else {
          console.log('No collaborator label in share link info');
        }
      })
      .catch(error => {
        console.error('Failed to fetch share link info:', error);
      });
  }, [shareToken]);

  // Handle lock status changes
  const handleLockChange = (newLockStatus) => {
    console.log('Lock status changed:', newLockStatus);
    console.log('Collaborator label:', collaboratorLabel);
    console.log('isLockedByMe:', newLockStatus.isLockedByMe);
    console.log('isLocked:', newLockStatus.isLocked);
    
    setLockStatus(newLockStatus);
    const hasLock = newLockStatus.isLockedByMe || !newLockStatus.isLocked;
    console.log('hasLock calculated as:', hasLock);
    setIsEditorEnabled(hasLock);
    
    if (!hasLock && newLockStatus.isLocked) {
      setStatus('Document is being edited by another collaborator');
    } else if (newLockStatus.isLockedByMe) {
      setStatus('You are editing - changes will be saved automatically');
    } else {
      setStatus('Document is available for editing');
    }
  };

  // Placeholder for current user - replace with actual user context/auth later
  const currentUser = { 
    id: collaboratorLabel || `user-${Math.random().toString(36).substr(2, 9)}`, 
    name: collaboratorLabel || 'Current User' 
  };

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
      // Send both document content and comments to the backend
      // Access current comments state directly to avoid timing issues
      const currentComments = commentsRef.current;
      console.log('Saving document with comments:', currentComments);
      setStatus('Saving live changes...');
      try {
        const response = await fetch(`/api/collab/${shareToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prosemirror_json: JSON.stringify(currentJsonContent),
            base_commit_hash: baseCommitHash,
            comments: currentComments, // Use current comments
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
    [shareToken, baseCommitHash] // Remove comments from dependencies to avoid timing issues
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
      // Re-enable custom extensions since backend returns content with these node types
      QuartoBlock,
      Citation,
      FigureReference,
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
    editable: isEditorEnabled,
    onUpdate: ({ editor }) => {
      if (!isEditorEnabled) return;
      
      console.log('Editor update triggered');
      setIsEditing(true); // Mark as editing when user types
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
  }, [isEditorEnabled]);

  // Update editor editable state when isEditorEnabled changes
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      console.log('Setting editor editable to:', isEditorEnabled);
      editor.setEditable(isEditorEnabled);
    }
  }, [isEditorEnabled, editor]);

  // Reset editing state after user stops typing
  useEffect(() => {
    if (isEditing) {
      const timeoutId = setTimeout(() => {
        setIsEditing(false);
      }, 2000); // Reset after 2 seconds of no typing
      return () => clearTimeout(timeoutId);
    }
  }, [isEditing]);

  // 👇 --- THIS IS THE FINAL, CORRECT useEffect --- 👇
  useEffect(() => {
    // Don't do anything if the editor isn't ready.
    if (!editor || editor.isDestroyed) {
      console.log('Editor not ready or destroyed, skipping transaction');
      return;
    }

    console.log('Dispatching comment highlight transaction for activeId:', activeCommentId);
    console.log('Plugin key:', commentHighlightPluginKey);
    console.log('Plugin key name:', commentHighlightPluginKey.key);
    
    // Dispatch a transaction with the correct plugin key that our plugin will listen for.
    // This is the correct, performant way to send information to a plugin.
    const transaction = editor.state.tr.setMeta(commentHighlightPluginKey, {
      activeId: activeCommentId,
    });
    
    console.log('Transaction created, checking meta:', transaction.getMeta(commentHighlightPluginKey));
    editor.view.dispatch(transaction);
    
    console.log('Transaction dispatched successfully');

  }, [activeCommentId, editor]); // This runs only when the active ID changes.

  // Add effect to save when comments change
  useEffect(() => {
    if (editor && comments.length > 0) {
      console.log('Comments changed, triggering save...');
      // Use setTimeout to avoid immediate execution and potential race conditions
      const timeoutId = setTimeout(() => {
        saveDocument(editor.getJSON());
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [comments, editor]); // Remove saveDocument from dependencies to avoid infinite loops

  // Add a check to see if editor is created
  useEffect(() => {
    console.log('Editor state check:', { editor: !!editor, shareToken });
    if (editor) {
      console.log('Editor is ready, current content:', editor.getJSON());
    }
  }, [editor, shareToken]);

  useEffect(() => {
    if (!editor || !shareToken) return;
    setStatus('Loading document...');
    console.log('Loading document for shareToken:', shareToken);

    // Fetching from /api/docs/view as per backend changes in previous subtask for initial load
    // This endpoint should return { prosemirrorJson, comments, currentCommitHash }
    // If /api/collab/${shareToken} is the correct one for *live collab data*, it should also adopt this structure.
    // For now, assuming /api/docs/view for initial load as it was modified to return comments.
    // If this page is *only* for collab links, then /api/collab/${shareToken} needs to be updated in backend
    // to match the { prosemirrorJson, comments, currentCommitHash } structure.
    // Sticking to /api/collab/ for now as per original description of CollabEditorPage
    fetch(`/api/collab/${shareToken}`)
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
        console.log('API response data.collaboratorLabel:', data.collaboratorLabel);
        console.log('API response data type:', typeof data.collaboratorLabel);
        console.log('API response data.prosemirrorJson:', data.prosemirrorJson);
        console.log('API response data.prosemirrorJson type:', typeof data.prosemirrorJson);
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
          console.log('Setting editor content:', contentToLoad);
          console.log('Content to load type:', typeof contentToLoad);
          console.log('Content to load structure:', JSON.stringify(contentToLoad, null, 2));
          editor.commands.setContent(contentToLoad);
          setBaseCommitHash(data.currentCommitHash);
          // Set collaborator label if provided by the backend
          if (data.collaboratorLabel) {
            console.log('Setting collaborator label from API:', data.collaboratorLabel);
            setCollaboratorLabel(data.collaboratorLabel);
          } else {
            console.log('No collaborator label received from API');
          }
          // Load comments if provided by the backend
          if (data.comments) {
            setComments(Array.isArray(data.comments) ? data.comments : []);
          } else {
            setComments([]); // Initialize as empty if not provided
          }
          setStatus('Loaded');
        } else {
          console.error('Invalid data structure:', data);
          throw new Error('Invalid data structure from backend. Missing prosemirrorJson or currentCommitHash.');
        }
      })
      .catch(errMsg => {
        console.error('Failed to load document:', errMsg);
        setError(typeof errMsg === 'string' ? errMsg : 'This share link is invalid or has expired.');
        console.log('Setting fallback content');
        editor.commands.setContent({
          type: 'doc',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Could not load document.' }]
          }]
        });
      });
  }, [editor, shareToken]);

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
      author: collaboratorLabel || currentUser.id, // Use collaboratorLabel if available
      timestamp: new Date().toISOString(),
      status: "open",
      thread: [
        {
          text: commentText.trim(),
          author: collaboratorLabel || currentUser.id, // Use collaboratorLabel if available
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
    editor.chain().focus().setComment(newCommentId).run(); // Use setComment to apply the mark
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
      author: collaboratorLabel || currentUser.id,
      timestamp: new Date().toISOString(),
      status: "open",
      thread: [], // Empty thread - will be filled when user writes
      isNew: true // Flag to indicate this is a new comment that needs text
    };
    console.log('Creating empty comment:', newComment);
    setComments(prevComments => {
      const updatedComments = [...prevComments, newComment];
      console.log('Updated comments state:', updatedComments);
      return updatedComments;
    });
    editor.chain().focus().setComment(newCommentId).run(); // Use setComment to apply the mark
    setActiveCommentId(newCommentId);
  };

  return (
    <div className="editor-page-container">
      <header className="editor-header">
        <h3>Quartorium</h3>
        {collaboratorLabel && <p>Hello, {collaboratorLabel}!</p>}
        
        <div>
          <button 
            onClick={createEmptyComment} 
            style={{ margin: '1rem' }}
            disabled={!isEditorEnabled}
          >
            Add Comment
          </button>
          <button
            onClick={handleCollabCommit}
            style={{ marginRight: '2rem' }}
            disabled={!baseCommitHash || status.includes('Saving') || status.includes('Committing...') || !isEditorEnabled}
          >
            Commit
          </button>
        </div>
      </header>
      
      <div className="editor-main-area">
        {/* Left Sidebar for Collaboration Status */}
        <div className="collaboration-sidebar">
          {/* Save Status */}
          <SaveStatus 
            status={status}
            baseCommitHash={baseCommitHash}
          />
          
          {/* Simplified Branch Lock Status */}
          <BranchLockStatus 
            shareToken={shareToken}
            collaboratorLabel={collaboratorLabel}
            onLockChange={handleLockChange}
            isEditing={isEditing}
          />
          
          {/* Recent Changes Indicator */}
          <ChangeIndicator 
            shareToken={shareToken}
            collaboratorLabel={collaboratorLabel}
          />
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
    </div>
  );
}

export default CollabEditorPage;