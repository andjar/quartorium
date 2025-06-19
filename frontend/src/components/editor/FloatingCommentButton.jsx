import React, { useState, useEffect } from 'react';
import './FloatingCommentButton.css';

const FloatingCommentButton = ({ onAddComment, editor }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      const { state } = editor;
      const { selection } = state;
      
      // Check if there's a non-empty text selection
      if (selection.empty || selection.from === selection.to) {
        setIsVisible(false);
        return;
      }

      // Get the editor DOM element
      const editorElement = editor.view.dom;
      if (!editorElement) return;

      // Get the selection coordinates
      const coords = editor.view.coordsAtPos(selection.to);
      
      // Calculate position relative to the editor
      const editorRect = editorElement.getBoundingClientRect();
      const x = coords.left - editorRect.left - 60;
      const y = coords.top - editorRect.top; // Position closer to the selection (reduced from -40)

      // Ensure the button stays within the editor bounds
      const buttonWidth = 120; // Approximate button width
      const buttonHeight = 32; // Approximate button height
      
      let adjustedX = x;
      let adjustedY = y;

      // Adjust horizontal position if button would go outside editor
      if (x + buttonWidth > editorRect.width) {
        adjustedX = editorRect.width - buttonWidth - 10;
      }
      if (x < 0) {
        adjustedX = 10;
      }

      // Adjust vertical position if button would go above editor
      if (y < 0) {
        adjustedY = coords.bottom - editorRect.top + 10;
      }

      setPosition({ x: adjustedX, y: adjustedY });
      setIsVisible(true);
    };

    // Listen for selection changes
    editor.on('selectionUpdate', handleSelectionUpdate);
    
    // Also listen for document changes that might affect selection
    editor.on('update', handleSelectionUpdate);

    // Handle clicks outside to hide the button
    const handleClickOutside = (event) => {
      if (!editor.view.dom.contains(event.target)) {
        setIsVisible(false);
      }
    };

    document.addEventListener('click', handleClickOutside);

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
      editor.off('update', handleSelectionUpdate);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [editor]);

  const handleAddComment = () => {
    if (onAddComment) {
      onAddComment();
    }
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div 
      className="floating-comment-button"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      <button onClick={handleAddComment}>
        💬 Add Comment
      </button>
    </div>
  );
};

export default FloatingCommentButton; 