import { diffWords } from 'diff';
import { readable, viewText } from './nodesText.js';

const KEEP = 70;
/** Long unchanged stretches are shortened so the edits stand out. */
function shorten(text, isFirst, isLast) {
  if (text.length <= KEEP * 2 + 20 || (isFirst && isLast)) return text;
  const head = text.slice(0, KEEP).replace(/\s\S*$/, '');
  const tail = text.slice(-KEEP).replace(/^\S*\s/, '');
  if (isFirst) return '… ' + tail;
  if (isLast) return head + ' …';
  return head + ' … ' + tail;
}

/** Word-level difference between two texts, in the style of track changes. */
export default function Diff({ before, after, full = false }) {
  if (before === after) return <p className="diff"><em className="muted">Formatting changed</em> — {readable(after)}</p>;
  if (!before) return <p className="diff"><ins>{readable(after)}</ins></p>;
  if (!after) return <p className="diff"><del>{readable(before)}</del></p>;
  const parts = diffWords(before, after);
  return (
    <p className="diff">
      {parts.map((part, i) => {
        const text = readable(part.value);
        if (part.added) return <ins key={i}>{text}</ins>;
        if (part.removed) return <del key={i}>{text}</del>;
        return <span key={i}>{full ? text : shorten(text, i === 0, i === parts.length - 1)}</span>;
      })}
    </p>
  );
}

/** A change: old blocks replaced by new blocks (each a view from the server). */
export function ChangeDiff({ change, full }) {
  const { old, new: neu } = change;
  if (old.length === neu.length) return old.map((b, i) => <Diff key={i} before={viewText(b)} after={viewText(neu[i])} full={full} />);
  if (old.length === 0) return neu.map((b, i) => <Diff key={i} before="" after={viewText(b)} full={full} />);
  return <Diff before={old.map(viewText).join('\n\n')} after={neu.map(viewText).join('\n\n')} full={full} />;
}
