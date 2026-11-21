import { useEffect, useState } from 'react';
import { ChangeDiff } from './Diff.jsx';

/**
 * The lead's review queue: every open suggestion and comment in document
 * order, one at a time, shown in place. Keys: A accept, R reject/resolve,
 * N next, P previous, Esc close.
 */
export default function ReviewBar({ items, index, setIndex, version, setVersion, onAccept, onReject, onResolve, onClose }) {
  const [busy, setBusy] = useState(false);
  const item = items[index];
  const change = item?.type === 'change' ? item.group[Math.min(version, item.group.length - 1)] : null;

  const run = async (fn) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const next = () => setIndex(Math.min(index + 1, items.length - 1));
  const prev = () => setIndex(Math.max(index - 1, 0));
  const accept = () => change && change.status === 'open' && run(() => onAccept(change.id));
  const reject = () => run(() => (change ? onReject(change.id) : onResolve(item.comment.id)));

  useEffect(() => {
    const key = (e) => {
      const t = e.target;
      if (t.closest?.('input, textarea, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') onClose();
      else if (k === 'a') accept();
      else if (k === 'r') reject();
      else if (k === 'n' || e.key === 'ArrowRight') next();
      else if (k === 'p' || e.key === 'ArrowLeft') prev();
      else if (item?.type === 'change' && /^[1-9]$/.test(k) && Number(k) <= item.group.length) setVersion(Number(k) - 1);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  if (!item) {
    return (
      <div className="review-bar">
        <p className="done-msg">Nothing left to review. 🎉</p>
        <div className="row"><button type="button" className="small" onClick={onClose}>Close</button></div>
      </div>
    );
  }
  return (
    <div className="review-bar" role="region" aria-label="Review queue">
      <div className="where">
        <span className="count">{index + 1} / {items.length}</span>
        {change ? (
          <span><strong>{change.author}</strong> {change.old.length === 0 ? 'added text' : change.new.length === 0 ? 'removed text' : 'suggested a change'}{change.status === 'outdated' ? ' (outdated)' : ''}</span>
        ) : (
          <span><strong>{item.comment.author}</strong> {item.comment.type === 'reference' ? 'asks for a reference' : 'commented'}: <em>{item.comment.thread[0].text.slice(0, 140)}</em>{item.comment.thread.length > 1 ? ` (+${item.comment.thread.length - 1} replies)` : ''}</span>
        )}
      </div>
      {change && item.group.length > 1 && (
        <div className="versions">
          <span className="muted">{item.group.length} people rewrote this — pick one:</span>
          {item.group.map((c, i) => <button type="button" key={c.id} className={`ghost small ${i === version ? 'on' : ''}`} onClick={() => setVersion(i)}>{i + 1}. {c.author}</button>)}
        </div>
      )}
      {change && <div className="bar-diff"><ChangeDiff change={change} /></div>}
      <div className="row">
        <button type="button" className="ghost small" onClick={prev} disabled={index === 0} title="Previous (P)">← Back</button>
        {change && change.status === 'open' && <button type="button" className="small" disabled={busy} onClick={accept} title="Accept (A)">Accept{item.group.length > 1 ? ` ${change.author}’s` : ''}</button>}
        <button type="button" className="ghost small" disabled={busy} onClick={reject} title={change ? 'Reject (R)' : 'Resolve (R)'}>{change ? (change.status === 'outdated' ? 'Dismiss' : 'Reject') : 'Resolve'}</button>
        <button type="button" className="ghost small" onClick={next} disabled={index === items.length - 1} title="Next (N)">Skip →</button>
        <button type="button" className="ghost small" onClick={onClose} title="Close (Esc)">Close</button>
      </div>
    </div>
  );
}
