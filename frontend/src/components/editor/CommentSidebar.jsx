import React, { useState, useEffect, useRef, useCallback } from 'react';
import './CommentSidebar.css';

function CommentSidebar({ comments, setComments, activeCommentId, onCommentSelect, currentUser, onAddComment, shareToken }) {
  const [replyText, setReplyText] = useState({});
  const [showReplyInput, setShowReplyInput] = useState({});
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [otherComments, setOtherComments] = useState([]);
  const [showOtherComments, setShowOtherComments] = useState(true);
  const textareaRefs = useRef({});

  // Fetch comments from other collaborators
  const fetchOtherComments = useCallback(async () => {
    if (!shareToken) return;
    
    try {
      const response = await fetch(`/api/collab/${shareToken}/other-branches`);
      if (!response.ok) return;
      
      const data = await response.json();
      const allOtherComments = [];
      
      (data.otherBranches || []).forEach((branch, branchIndex) => {
        (branch.comments || []).forEach(comment => {
          allOtherComments.push({
            ...comment,
            branchLabel: branch.collaboratorLabel,
            branchToken: branch.shareToken,
            branchIndex,
            isFromOther: true
          });
        });
      });
      
      setOtherComments(allOtherComments);
    } catch (err) {
      console.error('Failed to fetch other comments:', err);
    }
  }, [shareToken]); // Remove comments dependency to avoid loops

  useEffect(() => {
    fetchOtherComments();
    const interval = setInterval(fetchOtherComments, 30000);
    return () => clearInterval(interval);
  }, [fetchOtherComments]);

  // Handle reaction for a comment or reply
  const handleReaction = async (commentId, sourceShareToken, reactionType, currentReaction, replyIndex = null) => {
    if (!shareToken) return;

    // For replies, we use a composite ID
    const targetId = replyIndex !== null ? `${commentId}:reply:${replyIndex}` : commentId;

    try {
      if (currentReaction === reactionType) {
        await fetch('/api/collab/reaction', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commentId: targetId,
            sourceShareToken,
            reactorShareToken: shareToken
          })
        });
      } else {
        await fetch('/api/collab/reaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commentId: targetId,
            sourceShareToken,
            reactorShareToken: shareToken,
            reactionType
          })
        });
      }
      fetchOtherComments();
    } catch (err) {
      console.error('Failed to save reaction:', err);
    }
  };

  // Focus on new comment textarea when it's created
  useEffect(() => {
    const newComment = comments.find(comment => comment.isNew && (!comment.thread || comment.thread.length === 0));
    if (newComment && textareaRefs.current[newComment.id]) {
      setTimeout(() => {
        textareaRefs.current[newComment.id]?.focus();
      }, 100);
    }
  }, [comments]);

  if (!currentUser) {
    return (
      <aside className={`comment-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="comment-sidebar-header">
          <h3>Comments</h3>
          <button 
            className="collapse-toggle"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {isCollapsed ? '◀' : '▶'}
          </button>
        </div>
        {!isCollapsed && <p className="sidebar-message">Loading user info...</p>}
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
          thread: [...(comment.thread || []), newThreadMessage],
        };
      }
      return comment;
    });
    setComments(updatedComments);
    setReplyText(prev => ({ ...prev, [commentId]: '' }));
    setShowReplyInput(prev => ({ ...prev, [commentId]: false }));
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
          isNew: false
        };
      }
      return comment;
    });
    setComments(updatedComments);
  };

  const cancelNewComment = (commentId) => {
    const updatedComments = comments.filter(comment => comment.id !== commentId);
    setComments(updatedComments);
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const BRANCH_COLORS = ['#8b5cf6', '#06b6d4', '#f97316', '#ec4899'];
  const getBranchColor = (index) => BRANCH_COLORS[index % BRANCH_COLORS.length];

  // Render reactions for a message
  const renderReactions = (comment, replyIndex = null) => {
    const reactionKey = replyIndex !== null ? `${comment.id}:reply:${replyIndex}` : comment.id;
    const reactions = replyIndex !== null 
      ? comment.replyReactions?.[replyIndex] 
      : comment.reactions;
    const myReaction = replyIndex !== null 
      ? comment.replyMyReactions?.[replyIndex] 
      : comment.myReaction;

    return (
      <div className="message-reactions">
        <button
          className={`reaction-btn-small ${myReaction === 'thumbs_up' ? 'active thumbs-up' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            handleReaction(comment.id, comment.branchToken, 'thumbs_up', myReaction, replyIndex);
          }}
        >
          👍 {reactions?.thumbs_up || 0}
        </button>
        <button
          className={`reaction-btn-small ${myReaction === 'thumbs_down' ? 'active thumbs-down' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            handleReaction(comment.id, comment.branchToken, 'thumbs_down', myReaction, replyIndex);
          }}
        >
          👎 {reactions?.thumbs_down || 0}
        </button>
      </div>
    );
  };

  const renderComment = (comment, isOther = false) => {
    const firstMessage = comment.thread?.[0];
    const replies = comment.thread?.slice(1) || [];

    return (
      <div
        key={comment.id}
        className={`comment-item ${comment.id === activeCommentId ? 'active' : ''} comment-status-${comment.status} ${isOther ? 'from-other' : ''}`}
        onClick={() => !isOther && onCommentSelect(comment.id)}
      >
        {/* Branch badge for other's comments */}
        {isOther && (
          <div className="comment-branch-badge" style={{ borderLeftColor: getBranchColor(comment.branchIndex) }}>
            <span className="branch-dot" style={{ backgroundColor: getBranchColor(comment.branchIndex) }} />
            {comment.branchLabel}
          </div>
        )}

        {/* New comment input */}
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
            {/* Main comment */}
            {firstMessage && (
              <div className="comment-main">
                <div className="comment-meta">
                  <strong>{firstMessage.author === currentUser.id ? 'You' : firstMessage.author}</strong>
                  <span>{formatTime(firstMessage.timestamp)}</span>
                </div>
                <div className="comment-body">
                  <p>{firstMessage.text}</p>
                </div>
                {isOther && renderReactions(comment)}
              </div>
            )}

            {/* Replies */}
            {replies.length > 0 && (
              <div className="comment-thread">
                {replies.map((reply, index) => (
                  <div key={index} className="comment-reply">
                    <div className="comment-meta">
                      <strong>{reply.author === currentUser.id ? 'You' : reply.author}</strong>
                      <span>{formatTime(reply.timestamp)}</span>
                    </div>
                    <div className="comment-body">
                      <p>{reply.text}</p>
                    </div>
                    {isOther && renderReactions(comment, index)}
                  </div>
                ))}
              </div>
            )}

            {/* Actions for own comments */}
            {!isOther && (
              <div className="comment-actions" onClick={e => e.stopPropagation()}>
                <button onClick={() => setShowReplyInput(prev => ({ ...prev, [comment.id]: !prev[comment.id]}))}>
                  Reply
                </button>
                <button onClick={() => toggleResolveComment(comment.id)}>
                  {comment.status === 'open' ? 'Resolve' : 'Reopen'}
                </button>
              </div>
            )}

            {/* Reply input */}
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
    );
  };

  const hasComments = comments.length > 0 || otherComments.length > 0;

  return (
    <aside className={`comment-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="comment-sidebar-header">
        <h3>Comments</h3>
        <button 
          className="collapse-toggle"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? '◀' : '▶'}
        </button>
      </div>
      
      {!isCollapsed && (
        <div className="comment-list">
          {!hasComments ? (
            <p className="sidebar-message">No comments yet. Select text in the editor and click "Add Comment".</p>
          ) : (
            <>
              {/* My comments */}
              {comments.length > 0 && (
                <div className="comments-section">
                  <p className="section-label">Your Comments</p>
                  {comments.map(comment => renderComment(comment, false))}
                </div>
              )}

              {/* Other collaborators' comments */}
              {otherComments.length > 0 && (
                <div className="comments-section other-comments-section">
                  <div 
                    className="section-header"
                    onClick={() => setShowOtherComments(!showOtherComments)}
                  >
                    <p className="section-label">
                      From Collaborators
                      <span className="comment-count-badge">{otherComments.length}</span>
                    </p>
                    <span className="section-toggle">{showOtherComments ? '−' : '+'}</span>
                  </div>
                  {showOtherComments && otherComments.map(comment => renderComment(comment, true))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}

export default CommentSidebar;
