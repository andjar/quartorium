import { diffWords } from 'diff';

const KEEP = 70;
/** Long unchanged stretches are shortened so the edits stand out. */
function shorten(text, isFirst, isLast) {
  if (text.length <= KEEP * 2 + 20) return text;
  const head = text.slice(0, KEEP).replace(/\s\S*$/, '');
  const tail = text.slice(-KEEP).replace(/^\S*\s/, '');
  if (isFirst && isLast) return text;
  if (isFirst) return '… ' + tail;
  if (isLast) return head + ' …';
  return head + ' … ' + tail;
}

/** Word-level difference between two texts, in the style of track changes. */
export default function Diff({ before, after }) {
  if (before === after) return <p className="diff"><em className="muted">Formatting changed</em> — {after}</p>;
  if (!before) return <p className="diff"><ins>{after}</ins></p>;
  if (!after) return <p className="diff"><del>{before}</del></p>;
  const parts = diffWords(before, after);
  return (
    <p className="diff">
      {parts.map((part, i) => {
        if (part.added) return <ins key={i}>{part.value}</ins>;
        if (part.removed) return <del key={i}>{part.value}</del>;
        return <span key={i}>{shorten(part.value, i === 0, i === parts.length - 1)}</span>;
      })}
    </p>
  );
}

/** A change is a list of old blocks replaced by new blocks. */
export function ChangeDiff({ change }) {
  const { old, new: neu } = change;
  if (old.length === neu.length) {
    return old.map((b, i) => <Diff key={i} before={b.text} after={neu[i].text} />);
  }
  return (
    <>
      {old.length > 0 && <Diff before={old.map((b) => b.text).join('\n\n')} after={neu.map((b) => b.text).join('\n\n')} />}
      {old.length === 0 && neu.map((b, i) => <Diff key={i} before="" after={b.text} />)}
    </>
  );
}
