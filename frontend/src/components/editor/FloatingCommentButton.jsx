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

      // Get coordinates for both start and end of selection
      const startCoords = editor.view.coordsAtPos(selection.from);
      const endCoords = editor.view.coordsAtPos(selection.to);
      
      // Ensure the button stays within the editor bounds
      const buttonWidth = 400; // Updated to account for all buttons (Add Comment, B, I, S, H1, H2, H3)
      const buttonHeight = 32; // Approximate button height
      
      // Calculate the center of the selection horizontally
      const selectionCenterX = (startCoords.left + endCoords.left) / 2;
      
      // Position relative to viewport (since we're using position: fixed)
      const x = selectionCenterX - (buttonWidth / 2); // Center the toolbar on selection
      const y = startCoords.top - 35; // Position just above the selection
      
      let adjustedX = x;
      let adjustedY = y;

      // Adjust horizontal position if button would go outside viewport
      if (x + buttonWidth > window.innerWidth) {
        adjustedX = window.innerWidth - buttonWidth - 10;
      }
      if (x < 0) {
        adjustedX = 10;
      }

      // Adjust vertical position if button would go above viewport
      if (y < 0) {
        adjustedY = endCoords.bottom + 5; // Position below selection instead
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

  const handleFormatClick = (formatAction) => {
    if (editor) {
      console.log('Format button clicked, executing format action...');
      try {
        formatAction();
        console.log('Format action executed successfully');
      } catch (error) {
        console.error('Error executing format action:', error);
      }
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
      <button onClick={() => handleFormatClick(() => {
        console.log('Bold button clicked');
        return editor.chain().focus().toggleBold().run();
      })}>B</button>
      <button onClick={() => handleFormatClick(() => {
        console.log('Italic button clicked');
        return editor.chain().focus().toggleItalic().run();
      })}>I</button>
      <button onClick={() => handleFormatClick(() => {
        console.log('Strike button clicked');
        return editor.chain().focus().toggleStrike().run();
      })}>S</button>
      <button onClick={() => handleFormatClick(() => {
        console.log('H1 button clicked');
        return editor.chain().focus().toggleHeading({ level: 1 }).run();
      })}>H1</button>
      <button onClick={() => handleFormatClick(() => {
        console.log('H2 button clicked');
        return editor.chain().focus().toggleHeading({ level: 2 }).run();
      })}>H2</button>
      <button onClick={() => handleFormatClick(() => {
        console.log('H3 button clicked');
        return editor.chain().focus().toggleHeading({ level: 3 }).run();
      })}>H3</button>
      <button onClick={() => handleFormatClick(() => {
        console.log('Clear formatting button clicked');
        return editor.chain().focus().clearNodes().unsetAllMarks().run();
      })}>N</button>
    </div>
  );
};

export default FloatingCommentButton; 