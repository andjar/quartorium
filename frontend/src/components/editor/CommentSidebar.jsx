import React, { useState } from 'react';
import './CommentSidebar.css';

function CommentSidebar({ comments, setComments, activeCommentId, onCommentSelect, currentUser }) {
  const [replyText, setReplyText] = useState({}); // Store reply text for each comment { [commentId]: "text" }
  const [showReplyInput, setShowReplyInput] = useState({}); // { [commentId]: boolean }
  const [isCollapsed, setIsCollapsed] = useState(false); // New state for collapsible functionality

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
        <>
          {comments.map((comment) => (
            <div
              key={comment.id}
              className={`comment-item ${comment.id === activeCommentId ? 'active' : ''} comment-status-${comment.status}`}
              onClick={() => onCommentSelect(comment.id)} // Keep selecting comment on click
            >
              <div className="comment-header">
                <span><strong>Author:</strong> {comment.author === currentUser.id ? currentUser.name : comment.author}</span>
                <span><strong>Status:</strong> {comment.status}</span>
                <small>Timestamp: {new Date(comment.timestamp).toLocaleString()}</small>
              </div>
              <div className="comment-thread">
                {comment.thread && comment.thread.map((message, index) => (
                  <div key={index} className="comment-message">
                    <p>{message.text}</p>
                    <small>By: {message.author === currentUser.id ? currentUser.name : message.author} at {new Date(message.timestamp).toLocaleTimeString()}</small>
                  </div>
                ))}
              </div>
              <div className="comment-actions">
                <button onClick={(e) => { e.stopPropagation(); toggleResolveComment(comment.id); }}>
                  {comment.status === 'open' ? 'Resolve' : 'Reopen'}
                </button>
                <button onClick={(e) => { e.stopPropagation(); setShowReplyInput(prev => ({ ...prev, [comment.id]: !prev[comment.id]})); }}>
                  Reply
                </button>
              </div>
              {showReplyInput[comment.id] && (
                <div className="reply-input-area" onClick={e => e.stopPropagation()}>
                  <textarea
                    value={replyText[comment.id] || ''}
                    onChange={(e) => handleReplyChange(comment.id, e.target.value)}
                    placeholder="Write a reply..."
                  />
                  <button onClick={(e) => { e.stopPropagation(); submitReply(comment.id); }}>Add Reply</button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </aside>
  );
}

export default CommentSidebar;
