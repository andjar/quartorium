import React from 'react';
import './CommentSidebar.css';

function CommentSidebar({ comments, activeCommentId, onCommentSelect }) {
  if (!comments || comments.length === 0) {
    return (
      <aside className="comment-sidebar">
        <h3>Comments</h3>
        <p>No comments yet.</p>
      </aside>
    );
  }

  return (
    <aside className="comment-sidebar">
      <h3>Comments</h3>
      {comments.map((comment) => (
        <div
          key={comment.id}
          className={`comment-item ${comment.id === activeCommentId ? 'active' : ''}`}
          onClick={() => onCommentSelect(comment.id)}
        >
          <p>{comment.text}</p>
        </div>
      ))}
    </aside>
  );
}

export default CommentSidebar;
