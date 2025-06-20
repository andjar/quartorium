import React, { useState, useEffect, useRef } from 'react';
import './CommentSidebar.css';

function CommentSidebar({ comments, setComments, activeCommentId, onCommentSelect, currentUser, onAddComment }) {
  const [replyText, setReplyText] = useState({}); // Store reply text for each comment { [commentId]: "text" }
  const [showReplyInput, setShowReplyInput] = useState({}); // { [commentId]: boolean }
  const [isCollapsed, setIsCollapsed] = useState(false); // New state for collapsible functionality
  const textareaRefs = useRef({}); // Refs for textareas

  // Focus on new comment textarea when it's created
  useEffect(() => {
    const newComment = comments.find(comment => comment.isNew && (!comment.thread || comment.thread.length === 0));
    if (newComment && textareaRefs.current[newComment.id]) {
      // Use setTimeout to ensure the DOM element is fully rendered
      setTimeout(() => {
        textareaRefs.current[newComment.id]?.focus();
      }, 100);
    }
  }, [comments]);

  if (!currentUser) { // currentUser might not be available immediately or in all contexts
    return (
      <aside className={`comment-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="comment-sidebar-header">
          <h3>Comments</h3>
          <button 
            className="collapse-toggle"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? '◀' : '▶'}
          </button>
        </div>
        {!isCollapsed && <p>Loading user info...</p>}
      </aside>
    );
  }

  const handleReplyChange = (commentId, text) => {
    setReplyText(prev => ({ ...prev, [commentId]: text }));
  };

  const submitReply = (commentId) => {
    if (!replyText[commentId] || !replyText[commentId].trim()) return;

    const newThreadMessage = {
      text: replyText[commentId].trim(),
      author: currentUser.id,
      timestamp: new Date().toISOString(),
    };

    const updatedComments = comments.map(comment => {
      if (comment.id === commentId) {
        return {
          ...comment,
          thread: [...(comment.thread || []), newThreadMessage], // Ensure thread exists
        };
      }
      return comment;
    });
    setComments(updatedComments);
    setReplyText(prev => ({ ...prev, [commentId]: '' })); // Clear reply input
    setShowReplyInput(prev => ({ ...prev, [commentId]: false })); // Hide input
  };

  const toggleResolveComment = (commentId) => {
    const updatedComments = comments.map(comment => {
      if (comment.id === commentId) {
        return {
          ...comment,
          status: comment.status === 'open' ? 'resolved' : 'open',
        };
      }
      return comment;
    });
    setComments(updatedComments);
  };

  const submitInitialComment = (commentId, text) => {
    if (!text || !text.trim()) return;

    const newThreadMessage = {
      text: text.trim(),
      author: currentUser.id,
      timestamp: new Date().toISOString(),
    };

    const updatedComments = comments.map(comment => {
      if (comment.id === commentId) {
        return {
          ...comment,
          thread: [newThreadMessage],
          isNew: false // Remove the new flag
        };
      }
      return comment;
    });
    setComments(updatedComments);
  };

  const cancelNewComment = (commentId) => {
    // Remove the comment entirely if it's canceled
    const updatedComments = comments.filter(comment => comment.id !== commentId);
    setComments(updatedComments);
  };

  if (!comments || comments.length === 0) {
    return (
      <aside className={`comment-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="comment-sidebar-header">
          <h3>Comments</h3>
          <button 
            className="collapse-toggle"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? '◀' : '▶'}
          </button>
        </div>
        {!isCollapsed && <p>No comments yet. Select text in the editor and click "Add Comment".</p>}
      </aside>
    );
  }

  return (
    <aside className={`comment-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="comment-sidebar-header">
        <h3>Comments</h3>
        <button 
          className="collapse-toggle"
          onClick={() => setIsCollapsed(!isCollapsed)}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? '◀' : '▶'}
        </button>
      </div>
      {!isCollapsed && (
        <div className="comment-list">
          {comments.map((comment) => {
            // Separate the first message from the subsequent replies
            const firstMessage = comment.thread?.[0];
            const replies = comment.thread?.slice(1) || [];
  
            return (
              <div
                key={comment.id}
                className={`comment-item ${comment.id === activeCommentId ? 'active' : ''} comment-status-${comment.status}`}
                onClick={() => onCommentSelect(comment.id)}
              >
                {/* === Case 1: This is a brand new, empty comment === */}
                {comment.isNew && !firstMessage ? (
                  <div className="new-comment-input-area" onClick={e => e.stopPropagation()}>
                    <textarea
                      ref={(el) => textareaRefs.current[comment.id] = el}
                      placeholder="Add a comment..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          submitInitialComment(comment.id, e.target.value);
                        }
                      }}
                    />
                    <div className="new-comment-buttons">
                      <button 
                        className="save-button"
                        onClick={() => submitInitialComment(comment.id, textareaRefs.current[comment.id]?.value || '')}
                      >
                        Comment
                      </button>
                      <button 
                        className="cancel-button"
                        onClick={() => cancelNewComment(comment.id)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* === Case 2: This is an existing comment thread === */}
                    {/* Render the first message prominently */}
                    {firstMessage && (
                      <div className="comment-main">
                        <div className="comment-meta">
                          <strong>{firstMessage.author === currentUser.id ? currentUser.name : firstMessage.author}</strong>
                          <span> at {new Date(firstMessage.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        </div>
                        <div className="comment-body">
                          <p>{firstMessage.text}</p>
                        </div>
                      </div>
                    )}
  
                    {/* Render replies, if they exist */}
                    {replies.length > 0 && (
                      <div className="comment-thread">
                        {replies.map((reply, index) => (
                          <div key={index} className="comment-reply">
                            <div className="comment-meta">
                              <strong>{reply.author === currentUser.id ? currentUser.name : reply.author}</strong>
                              <span> at {new Date(firstMessage.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                            </div>
                            <div className="comment-body">
                              <p>{reply.text}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
  
                    {/* Render actions and the reply input area */}
                    <div className="comment-actions" onClick={e => e.stopPropagation()}>
                      <button onClick={() => setShowReplyInput(prev => ({ ...prev, [comment.id]: !prev[comment.id]}))}>
                        Reply
                      </button>
                      <button onClick={() => toggleResolveComment(comment.id)}>
                        {comment.status === 'open' ? 'Resolve' : 'Reopen'}
                      </button>
                    </div>
  
                    {showReplyInput[comment.id] && (
                      <div className="reply-input-area" onClick={e => e.stopPropagation()}>
                        <textarea
                          value={replyText[comment.id] || ''}
                          onChange={(e) => handleReplyChange(comment.id, e.target.value)}
                          placeholder="Write a reply..."
                          autoFocus
                        />
                        <div className="reply-input-buttons">
                          <button className="save-button" onClick={() => submitReply(comment.id)}>
                            Reply
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </aside>
  );
}

export default CommentSidebar;
