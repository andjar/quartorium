import { useEffect, useRef, useState } from 'react';
import { api, linkFor, timeAgo } from '../api.js';
import { ChangeDiff } from './Diff.jsx';

const snippet = (s, n = 90) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

function Composer({ placeholder, onSubmit, onCancel, autoFocus, submitLabel = 'Post' }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try { await onSubmit(text); setText(''); } finally { setBusy(false); }
  };
  return (
    <form className="composer" onSubmit={submit}>
      <textarea value={text} autoFocus={autoFocus} placeholder={placeholder} rows={text.length > 80 ? 4 : 2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); if (e.key === 'Escape' && onCancel) onCancel(); }} />
      <div className="row">
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
        <button type="submit" disabled={busy || !text.trim()}>{busy ? '…' : submitLabel}</button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ comments

function CommentCard({ c, me, active, located, actions, onSelect }) {
  const ref = useRef(null);
  const [replying, setReplying] = useState(false);
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [active]);
  const canResolve = me.role === 'lead' || c.author === me.name;
  const agreed = c.agree.includes(me.name);
  return (
    <article ref={ref} className={`card comment ${active ? 'active' : ''} ${c.resolved ? 'resolved' : ''}`} onClick={() => onSelect(c.id)}>
      {c.anchor.quote && <blockquote className={located ? '' : 'gone'} title={located ? 'Show in the document' : 'This text is no longer in the document'}>{snippet(c.anchor.quote)}</blockquote>}
      {c.thread.map((t, i) => (
        <div key={i} className="message">
          <div className="meta"><strong>{t.author}</strong> <span>{timeAgo(t.created)}</span></div>
          <p>{t.text}</p>
        </div>
      ))}
      <div className="actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" className={`ghost small ${agreed ? 'on' : ''}`} onClick={() => actions.agree(c.id)} title={c.agree.length ? `Agrees: ${c.agree.join(', ')}` : 'Agree with this comment'}>
          👍 {c.agree.length > 0 ? c.agree.length : 'Agree'}
        </button>
        {!c.resolved && <button type="button" className="ghost small" onClick={() => setReplying((r) => !r)}>Reply</button>}
        {canResolve && <button type="button" className="ghost small" onClick={() => actions.resolve(c.id, !c.resolved)}>{c.resolved ? 'Reopen' : 'Resolve'}</button>}
      </div>
      {replying && (
        <div onClick={(e) => e.stopPropagation()}>
          <Composer autoFocus placeholder="Reply…" submitLabel="Reply" onCancel={() => setReplying(false)}
            onSubmit={async (text) => { await actions.reply(c.id, text); setReplying(false); }} />
        </div>
      )}
    </article>
  );
}

function CommentsPanel({ comments, me, draft, setDraft, actions, activeComment, onSelect, located, order }) {
  const [showResolved, setShowResolved] = useState(false);
  const open = comments.filter((c) => !c.resolved).sort(order);
  const resolved = comments.filter((c) => c.resolved);
  return (
    <div className="panel">
      {draft ? (
        <div className="card draft">
          <blockquote>{snippet(draft.quote)}</blockquote>
          <Composer autoFocus placeholder="Your comment…" onCancel={() => setDraft(null)}
            onSubmit={async (text) => { await actions.addComment(draft, text); setDraft(null); }} />
        </div>
      ) : (
        <p className="hint">Select text in the paper and click <strong>Comment</strong> to start a discussion. Everyone in this round sees all comments.</p>
      )}
      {open.length === 0 && !draft && <p className="empty">No open comments.</p>}
      {open.map((c) => <CommentCard key={c.id} c={c} me={me} active={c.id === activeComment} located={located[c.id] !== false} actions={actions} onSelect={onSelect} />)}
      {resolved.length > 0 && (
        <>
          <button type="button" className="link-button" onClick={() => setShowResolved((s) => !s)}>{showResolved ? 'Hide' : 'Show'} {resolved.length} resolved</button>
          {showResolved && resolved.map((c) => <CommentCard key={c.id} c={c} me={me} active={c.id === activeComment} located={located[c.id] !== false} actions={actions} onSelect={onSelect} />)}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ changes

function ChangeCard({ c, me, active, actions, onSelect }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [active]);
  const own = c.authorId === me.id;
  const run = (fn) => async (e) => { e.stopPropagation(); setBusy(true); try { await fn(); } finally { setBusy(false); } };
  return (
    <article ref={ref} className={`card change ${active ? 'active' : ''} ${c.status}`} onClick={() => onSelect(c.id)}>
      <div className="meta">
        <strong>{own ? 'You' : c.author}</strong>
        <span>{c.old.length === 0 ? 'added text' : c.new.length === 0 ? 'removed text' : 'suggested'}</span>
      </div>
      <ChangeDiff change={c} />
      {c.status === 'outdated' && (
        <p className="note">The paragraph has changed since this was suggested, so it can’t be applied automatically.</p>
      )}
      <div className="actions">
        {me.role === 'lead' && c.status === 'open' && <button type="button" className="small" disabled={busy} onClick={run(() => actions.accept(c.id))}>Accept</button>}
        {(me.role === 'lead' || own) && (
          <button type="button" className="ghost small" disabled={busy} onClick={run(() => actions.reject(c.id))}>{own && me.role !== 'lead' ? 'Withdraw' : c.status === 'outdated' ? 'Dismiss' : 'Reject'}</button>
        )}
        {!own && <button type="button" className="ghost small" onClick={(e) => { e.stopPropagation(); actions.discuss(c); }}>Discuss</button>}
      </div>
    </article>
  );
}

function ChangesPanel({ changes, me, actions, activeChange, onSelect, order }) {
  const sorted = [...changes].sort(order);
  const mine = sorted.filter((c) => c.authorId === me.id);
  const others = sorted.filter((c) => c.authorId !== me.id);
  return (
    <div className="panel">
      <p className="hint">
        {me.role === 'lead'
          ? 'Co-authors’ edits appear here, paragraph by paragraph. Accept to put a change into the paper, or reject it.'
          : 'Edit the paper directly: your edits become suggestions for the lead author. Here you see everyone’s suggestions, so you can build on them instead of repeating work.'}
      </p>
      {sorted.length === 0 && <p className="empty">No suggested changes yet.</p>}
      {others.map((c) => <ChangeCard key={c.id} c={c} me={me} active={c.id === activeChange} actions={actions} onSelect={onSelect} />)}
      {mine.length > 0 && <h3>Your suggestions</h3>}
      {mine.map((c) => <ChangeCard key={c.id} c={c} me={me} active={c.id === activeChange} actions={actions} onSelect={onSelect} />)}
    </div>
  );
}

// ------------------------------------------------------------------ people

function PeoplePanel({ people, me, token, onChanged }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState(null);
  const [error, setError] = useState(null);
  const copy = async (p) => {
    try { await navigator.clipboard.writeText(linkFor(p.token)); } catch { window.prompt('Copy this link:', linkFor(p.token)); }
    setCopied(p.id);
    setTimeout(() => setCopied(null), 2000);
  };
  const add = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const p = await api.post(`/r/${token}/people`, { name, email });
      setName(''); setEmail('');
      await onChanged();
      copy(p);
    } catch (err) { setError(err.message); }
  };
  const remove = async (p) => {
    if (!window.confirm(`Remove ${p.name}? Their link stops working; their work so far stays in Git.`)) return;
    await api.del(`/r/${token}/people/${p.id}`);
    await onChanged();
  };
  const online = (p) => p.lastSeen && Date.now() - new Date(p.lastSeen).getTime() < 60000;
  return (
    <div className="panel">
      <ul className="people">
        {people.map((p) => (
          <li key={p.id}>
            <span className={`dot ${online(p) ? 'on' : ''}`} title={online(p) ? 'Here now' : `Last seen ${timeAgo(p.lastSeen)}`} />
            <span className="name">{p.name}{p.id === me.id ? ' (you)' : ''}</span>
            <span className="role">{p.role === 'lead' ? 'Lead' : 'Reviewer'}</span>
            {me.role === 'lead' && p.token && (
              <span className="row">
                <button type="button" className="ghost small" onClick={() => copy(p)}>{copied === p.id ? 'Copied!' : 'Copy link'}</button>
                {p.id !== me.id && <button type="button" className="ghost small danger" onClick={() => remove(p)}>Remove</button>}
              </span>
            )}
          </li>
        ))}
      </ul>
      {me.role === 'lead' && (
        <form className="card invite" onSubmit={add}>
          <h3>Invite a co-author</h3>
          <input placeholder="Name (shown on their comments and in Git)" value={name} onChange={(e) => setName(e.target.value)} required />
          <input placeholder="E-mail (optional, used in Git history)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit">Create link</button>
          {error && <p className="error">{error}</p>}
          <p className="hint">Each person gets a private link. Send it to them however you like; anyone with the link can take part.</p>
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ history

function HistoryPanel({ token, version }) {
  const [items, setItems] = useState(null);
  useEffect(() => { api.get(`/r/${token}/history`).then(setItems).catch(() => setItems([])); }, [token, version]);
  if (!items) return <div className="panel"><p className="empty">Loading…</p></div>;
  return (
    <div className="panel">
      <p className="hint">Every comment, decision and edit is saved as a Git commit on this round’s branch.</p>
      <ol className="history">
        {items.map((h) => (
          <li key={h.hash}>
            <div className="meta"><strong>{h.author}</strong> <span>{timeAgo(h.date)}</span> <code>{h.hash.slice(0, 7)}</code></div>
            <p>{h.subject}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------ sidebar

export default function Sidebar(props) {
  const { tab, setTab, comments, changes, people, me } = props;
  const openComments = comments.filter((c) => !c.resolved).length;
  const openChanges = changes.length;
  const tabs = [
    ['comments', `Comments${openComments ? ` (${openComments})` : ''}`],
    ['changes', `Changes${openChanges ? ` (${openChanges})` : ''}`],
    ['people', `People (${people.length})`],
    ['history', 'History'],
  ];
  return (
    <aside className="sidebar">
      <nav className="tabs">
        {tabs.map(([id, label]) => <button type="button" key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      {tab === 'comments' && <CommentsPanel {...props} onSelect={props.onSelectComment} />}
      {tab === 'changes' && <ChangesPanel {...props} onSelect={props.onSelectChange} order={props.order} />}
      {tab === 'people' && <PeoplePanel people={people} me={me} token={props.token} onChanged={props.refresh} />}
      {tab === 'history' && <HistoryPanel token={props.token} version={props.version} />}
    </aside>
  );
}
