import { useEffect, useReducer } from 'react';

/** A small formatting toolbar: only what the server can write back to Markdown. */
export default function Toolbar({ editor, onComment, onCite }) {
  const [, rerender] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (!editor) return undefined;
    editor.on('transaction', rerender);
    return () => editor.off('transaction', rerender);
  }, [editor]);
  if (!editor) return <div className="toolbar" />;

  const btn = (label, title, action, active, disabled) => (
    <button type="button" title={title} className={active ? 'on' : ''} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={action}>{label}</button>
  );
  const chain = () => editor.chain().focus();
  const level = [1, 2, 3, 4].find((l) => editor.isActive('heading', { level: l }));
  const setLink = () => {
    const prev = editor.getAttributes('link').href || '';
    const href = window.prompt('Link address (leave empty to remove the link):', prev);
    if (href === null) return;
    if (href === '') chain().unsetLink().run();
    else chain().extendMarkRange('link').setLink({ href }).run();
  };

  return (
    <div className="toolbar" role="toolbar">
      {btn('↶', 'Undo (Ctrl+Z)', () => chain().undo().run(), false, !editor.can().undo())}
      {btn('↷', 'Redo (Ctrl+Shift+Z)', () => chain().redo().run(), false, !editor.can().redo())}
      <span className="sep" />
      <select value={level || 0} title="Paragraph style" onChange={(e) => {
        const l = Number(e.target.value);
        if (l === 0) chain().setParagraph().run(); else chain().setHeading({ level: l }).run();
      }}>
        <option value={0}>Text</option>
        <option value={1}>Heading 1</option>
        <option value={2}>Heading 2</option>
        <option value={3}>Heading 3</option>
        <option value={4}>Heading 4</option>
      </select>
      <span className="sep" />
      {btn(<b>B</b>, 'Bold (Ctrl+B)', () => chain().toggleBold().run(), editor.isActive('bold'))}
      {btn(<i>I</i>, 'Italic (Ctrl+I)', () => chain().toggleItalic().run(), editor.isActive('italic'))}
      {btn(<u>U</u>, 'Underline (Ctrl+U)', () => chain().toggleUnderline().run(), editor.isActive('underline'))}
      {btn(<s>S</s>, 'Strikethrough', () => chain().toggleStrike().run(), editor.isActive('strike'))}
      {btn(<>x<sup>2</sup></>, 'Superscript', () => chain().toggleSuperscript().run(), editor.isActive('superscript'))}
      {btn(<>x<sub>2</sub></>, 'Subscript', () => chain().toggleSubscript().run(), editor.isActive('subscript'))}
      {btn('🔗', 'Link', setLink, editor.isActive('link'))}
      <span className="sep" />
      {btn('• List', 'Bulleted list', () => chain().toggleBulletList().run(), editor.isActive('bulletList'))}
      {btn('1. List', 'Numbered list', () => chain().toggleOrderedList().run(), editor.isActive('orderedList'))}
      {btn('❝', 'Quote', () => chain().toggleBlockquote().run(), editor.isActive('blockquote'))}
      <span className="sep" />
      {btn('📚 Cite', 'Insert a citation or a reference to a figure/table (or type @)', onCite)}
      <span className="grow" />
      {btn('💬 Comment', 'Comment on the selected text', onComment, false, editor.state.selection.empty)}
    </div>
  );
}
