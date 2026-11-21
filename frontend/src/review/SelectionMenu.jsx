import { useEffect, useState } from 'react';

/**
 * A small floating menu over selected text (bold, italic, comment).
 * Positioned by React itself, so it can come and go with the editor safely.
 */
export default function SelectionMenu({ editor, enabled, onComment }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!editor) return undefined;
    const update = () => {
      const { state, view } = editor;
      const sel = state.selection;
      if (!enabled || sel.empty || sel.node || !view.hasFocus()) { setPos(null); return; }
      const a = view.coordsAtPos(sel.from), b = view.coordsAtPos(sel.to);
      setPos({ left: (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2, top: Math.min(a.top, b.top) });
    };
    const hide = () => setTimeout(() => { if (!editor.isDestroyed && !editor.view.hasFocus()) setPos(null); }, 150);
    editor.on('selectionUpdate', update);
    editor.on('focus', update);
    editor.on('blur', hide);
    return () => { editor.off('selectionUpdate', update); editor.off('focus', update); editor.off('blur', hide); };
  }, [editor, enabled]);
  if (!pos || !editor || editor.isDestroyed) return null;
  const keep = (e) => e.preventDefault(); // keep the selection when clicking
  return (
    <div className="bubble floating" style={{ left: pos.left, top: pos.top }} onMouseDown={keep}>
      <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'on' : ''}><b>B</b></button>
      <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? 'on' : ''}><i>I</i></button>
      <button type="button" onClick={onComment}>💬 Comment</button>
    </div>
  );
}
