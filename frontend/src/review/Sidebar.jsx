import { useEffect, useRef, useState } from 'react';
import { api, linkFor, timeAgo } from '../api.js';
import { ChangeDiff } from './Diff.jsx';

const snippet = (s, n = 90) => {
  const t = String(s || '').replace(/￼/g, '…').replace(/\s+/g, ' ').trim(); // ￼: a chip inside the quoted text
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

function CommentCard({ c, me, active, located, actions, onSelect, readOnly }) {
  const ref = useRef(null);
  const [replying, setReplying] = useState(false);
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [active]);
  const canResolve = !readOnly && (me.role === 'lead' || c.author === me.name);
  const agreed = c.agree.includes(me.name);
  return (
    <article ref={ref} className={`card comment ${active ? 'active' : ''} ${c.resolved ? 'resolved' : ''} ${c.type === 'reference' ? 'reference' : ''}`} onClick={() => onSelect(c.id)}>
      {c.type === 'reference' && <div className="badge">📚 Reference to add to the bibliography</div>}
      {c.anchor.quote && <blockquote className={located ? '' : 'gone'} title={located ? 'Show in the document' : 'This text is no longer in the document'}>{snippet(c.anchor.quote)}</blockquote>}
      {c.thread.map((t, i) => (
        <div key={i} className="message">
          <div className="meta"><strong>{t.author}</strong> <span>{timeAgo(t.created)}</span></div>
          <p>{t.text}</p>
        </div>
      ))}
      {!readOnly && (
        <div className="actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={`ghost small ${agreed ? 'on' : ''}`} onClick={() => actions.agree(c.id)} title={c.agree.length ? `Agrees: ${c.agree.join(', ')}` : 'Agree with this comment'}>
            👍 {c.agree.length > 0 ? c.agree.length : 'Agree'}
          </button>
          {!c.resolved && <button type="button" className="ghost small" onClick={() => setReplying((r) => !r)}>Reply</button>}
          {canResolve && <button type="button" className="ghost small" onClick={() => actions.resolve(c.id, !c.resolved)}>{c.resolved ? 'Reopen' : 'Resolve'}</button>}
        </div>
      )}
      {readOnly && c.agree.length > 0 && <p className="muted small">👍 {c.agree.join(', ')}</p>}
      {replying && (
        <div onClick={(e) => e.stopPropagation()}>
          <Composer autoFocus placeholder="Reply…" submitLabel="Reply" onCancel={() => setReplying(false)}
            onSubmit={async (text) => { await actions.reply(c.id, text); setReplying(false); }} />
        </div>
      )}
    </article>
  );
}

function CommentsPanel({ comments, me, draft, setDraft, actions, activeComment, onSelect, located, order, readOnly }) {
  const [showResolved, setShowResolved] = useState(false);
  const open = comments.filter((c) => !c.resolved).sort(order);
  const resolved = comments.filter((c) => c.resolved);
  const card = (c) => <CommentCard key={c.id} c={c} me={me} active={c.id === activeComment} located={located[c.id] !== false} actions={actions} onSelect={onSelect} readOnly={readOnly} />;
  return (
    <div className="panel">
      {draft && !readOnly ? (
        <div className="card draft">
          {draft.quote && <blockquote>{snippet(draft.quote)}</blockquote>}
          {draft.about && <p className="muted small">About {draft.about}’s suggestion</p>}
          <Composer autoFocus placeholder="Your comment…" onCancel={() => setDraft(null)}
            onSubmit={async (text) => { await actions.addComment(draft, text); setDraft(null); }} />
        </div>
      ) : !readOnly && (
        <p className="hint">Select text in the paper and click <strong>Comment</strong> to start a discussion. Everyone in this round sees all comments.</p>
      )}
      {open.length === 0 && !draft && <p className="empty">No open comments.</p>}
      {open.map(card)}
      {resolved.length > 0 && (
        <>
          <button type="button" className="link-button" onClick={() => setShowResolved((s) => !s)}>{showResolved ? 'Hide' : 'Show'} {resolved.length} resolved</button>
          {showResolved && resolved.map(card)}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ changes

function ChangeCard({ c, me, active, actions, onSelect, readOnly, compact }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [active]);
  const own = c.authorId === me.id;
  const run = (fn) => async (e) => { e.stopPropagation(); setBusy(true); try { await fn(); } catch { /* shown as a toast */ } finally { setBusy(false); } };
  return (
    <article ref={ref} className={`card change ${active ? 'active' : ''} ${c.status} ${compact ? 'compact' : ''}`} onClick={() => onSelect(c.id)} title="Click to show it in the text">
      <div className="meta">
        <strong>{own ? 'You' : c.author}</strong>
        <span>{c.old.length === 0 ? 'added text' : c.new.length === 0 ? 'removed text' : 'suggested'}</span>
      </div>
      <ChangeDiff change={c} />
      {c.status === 'outdated' && <p className="note">The paragraph has changed since this was suggested, so it can’t be applied automatically.</p>}
      {!readOnly && (
        <div className="actions">
          {me.role === 'lead' && c.status === 'open' && <button type="button" className="small" disabled={busy} onClick={run(() => actions.accept(c.id))}>Accept</button>}
          {(me.role === 'lead' || own) && (
            <button type="button" className="ghost small" disabled={busy} onClick={run(() => actions.reject(c.id))}>{own && me.role !== 'lead' ? 'Withdraw' : c.status === 'outdated' ? 'Dismiss' : 'Reject'}</button>
          )}
          {!own && <button type="button" className="ghost small" onClick={(e) => { e.stopPropagation(); actions.discuss(c); }}>Discuss</button>}
        </div>
      )}
    </article>
  );
}

function SinceSection({ since, activeSince, onSelectSince }) {
  const [open, setOpen] = useState(true);
  if (!since.length) return null;
  return (
    <section className="since-section">
      <button type="button" className="section-head" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'} Since your last visit ({since.length})</button>
      {open && since.map((c, i) => (
        <article key={i} className={`card since ${activeSince === i ? 'active' : ''}`} onClick={() => onSelectSince(i)} title="Click to show it in the text">
          <div className="meta"><strong>{c.by}</strong><span>changed this</span></div>
          <ChangeDiff change={c} />
        </article>
      ))}
    </section>
  );
}

function ChangesPanel({ changes, me, actions, activeChange, onSelect, order, readOnly, since, activeSince, onSelectSince }) {
  const sorted = [...changes].sort(order);
  const mine = sorted.filter((c) => c.authorId === me.id);
  const others = sorted.filter((c) => c.authorId !== me.id);
  // Changes to the same paragraph by different people are shown together.
  const groups = [];
  for (const c of others) {
    const g = groups.find((x) => c.competing.length && x.some((y) => c.competing.includes(y.id)));
    if (g) g.push(c); else groups.push([c]);
  }
  const clean = others.filter((c) => c.status === 'open' && c.competing.length === 0);
  const authors = [...new Map(clean.map((c) => [c.authorId, c.author])).entries()];
  return (
    <div className="panel">
      <SinceSection since={since} activeSince={activeSince} onSelectSince={onSelectSince} />
      {!readOnly && (
        <p className="hint">
          {me.role === 'lead'
            ? 'Co-authors’ edits, paragraph by paragraph. Click one to see it in the text, or use Review to go through everything with the keyboard.'
            : 'Edit the paper directly: your edits are marked in the text and become suggestions for the lead author. Here you also see everyone else’s, so you can build on them.'}
        </p>
      )}
      {me.role === 'lead' && !readOnly && clean.length > 1 && (
        <div className="bulk">
          <button type="button" className="small" onClick={() => actions.acceptAll()}>Accept all {clean.length} that don’t conflict</button>
          {authors.length > 1 && authors.map(([id, name]) => <button type="button" key={id} className="ghost small" onClick={() => actions.acceptAll(id)}>All from {name}</button>)}
        </div>
      )}
      {sorted.length === 0 && <p className="empty">No suggested changes{readOnly ? '' : ' yet'}.</p>}
      {groups.map((g) => (g.length === 1
        ? <ChangeCard key={g[0].id} c={g[0]} me={me} active={g[0].id === activeChange} actions={actions} onSelect={onSelect} readOnly={readOnly} />
        : (
          <div key={g[0].id} className="competing">
            <div className="competing-head">{g.length} versions of the same paragraph — {me.role === 'lead' ? 'pick one' : 'compare before adding another'}</div>
            {g.map((c) => <ChangeCard key={c.id} c={c} me={me} active={c.id === activeChange} actions={actions} onSelect={onSelect} readOnly={readOnly} compact />)}
          </div>
        )))}
      {mine.length > 0 && <h3>Your suggestions</h3>}
      {mine.map((c) => <ChangeCard key={c.id} c={c} me={me} active={c.id === activeChange} actions={actions} onSelect={onSelect} readOnly={readOnly} />)}
    </div>
  );
}

// ------------------------------------------------------------------ people

const STATUS = { invited: ['Not opened yet', 'invited'], working: ['Reviewing', 'working'], done: ['Finished', 'done'] };

function mailtoInvite(p, round, me) {
  const subject = `Please review: ${round.title}`;
  const body = `Hi ${p.name},\n\nCould you review "${round.title}"? Open your personal link to read the paper, edit the text and comment:\n${linkFor(p.token)}\n\nYour edits are saved automatically and shown to me as suggestions. No account or software needed; please keep the link to yourself. When you are done, click "Finish my review".\n\nThanks!\n${me.name}`;
  return `mailto:${encodeURIComponent(p.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function PeoplePanel({ people, me, token, onChanged, mail, round, readOnly }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState(null);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);
  const copy = async (p) => {
    try { await navigator.clipboard.writeText(linkFor(p.token)); } catch { window.prompt('Copy this link:', linkFor(p.token)); }
    setCopied(p.id);
    setTimeout(() => setCopied(null), 2000);
  };
  const add = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/r/${token}/people`, { name, email });
      setName(''); setEmail('');
      await onChanged();
    } catch (err) { setError(err.message); }
  };
  const remove = async (p) => {
    if (!window.confirm(`Remove ${p.name}? Their link stops working; their work so far stays in Git.`)) return;
    await api.del(`/r/${token}/people/${p.id}`);
    await onChanged();
  };
  const send = async (p) => {
    try { await api.post(`/r/${token}/people/${p.id}/invite`); setSent(p.id); await onChanged(); } catch (err) { setError(err.message); }
  };
  const online = (p) => p.lastSeen && Date.now() - new Date(p.lastSeen).getTime() < 60000;
  const isLead = me.role === 'lead';
  return (
    <div className="panel">
      <ul className="people">
        {people.map((p) => {
          const [label, cls] = STATUS[p.status] || STATUS.working;
          return (
            <li key={p.id}>
              <div className="person-line">
                <span className={`dot ${online(p) ? 'on' : ''}`} title={online(p) ? 'Here now' : `Last seen ${timeAgo(p.lastSeen)}`} />
                <span className="name">{p.name}{p.id === me.id ? ' (you)' : ''}</span>
                <span className="role">{p.role === 'lead' ? 'Lead' : 'Reviewer'}</span>
                {p.role === 'reviewer' && <span className={`status ${cls}`}>{label}{p.status === 'done' && p.doneAt ? ` ${timeAgo(p.doneAt)}` : ''}</span>}
              </div>
              {p.role === 'reviewer' && (p.suggestions > 0 || p.comments > 0) && <div className="muted small">{plural(p.suggestions, 'suggestion')} · {plural(p.comments, 'comment')}</div>}
              {p.doneNote && <blockquote className="done-note">{p.doneNote}</blockquote>}
              {isLead && p.token && (
                <div className="row left">
                  <button type="button" className="ghost small" onClick={() => copy(p)}>{copied === p.id ? 'Copied!' : 'Copy link'}</button>
                  {p.id !== me.id && !readOnly && (mail && p.email
                    ? <button type="button" className="ghost small" onClick={() => send(p)}>{sent === p.id || p.invitedAt ? 'Send again' : 'Send invitation'}</button>
                    : <a className="button ghost small" href={mailtoInvite(p, round, me)}>Invite by e-mail</a>)}
                  {p.id !== me.id && !readOnly && <button type="button" className="ghost small danger" onClick={() => remove(p)}>Remove</button>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {isLead && !readOnly && (
        <form className="card invite" onSubmit={add}>
          <h3>Add a co-author</h3>
          <input placeholder="Name (shown on their comments and in Git)" value={name} onChange={(e) => setName(e.target.value)} required />
          <input placeholder={mail ? 'E-mail (to send the invitation)' : 'E-mail (optional: for the invitation and Git history)'} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit">Add</button>
          {error && <p className="error">{error}</p>}
          <p className="hint">Each person gets a private link that stays the same in later rounds. {mail ? 'Send it from here' : 'Use “Invite by e-mail” to send it from your own mail program'}, or copy it.</p>
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ history

function HistoryEntry({ h, token }) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState(null);
  const toggle = async () => {
    setOpen((o) => !o);
    if (!diff) setDiff(await api.get(`/r/${token}/history/${h.hash}`).catch(() => ({ changes: [], comments: null })));
  };
  const c = diff?.comments;
  const commentsChanged = c && (c.after !== c.before || c.messagesAfter !== c.messagesBefore);
  const delta = c ? c.messagesAfter - c.messagesBefore : 0;
  return (
    <li>
      <button type="button" className="history-head" onClick={toggle}>
        <div className="meta"><strong>{h.author}</strong> <span>{timeAgo(h.date)}</span> <code>{h.hash.slice(0, 7)}</code></div>
        <p>{h.subject}</p>
      </button>
      {open && (
        <div className="history-diff">
          {!diff ? <p className="muted">Loading…</p> : <>
            {diff.changes.map((ch, i) => <ChangeDiff key={i} change={ch} />)}
            {commentsChanged && <p className="muted small">Comments: {delta >= 0 ? '+' : ''}{delta} message{Math.abs(delta) === 1 ? '' : 's'}</p>}
            {!diff.changes.length && !commentsChanged && <p className="muted small">No change to the text (a decision or note).</p>}
          </>}
        </div>
      )}
    </li>
  );
}

function HistoryPanel({ token, version }) {
  const [items, setItems] = useState(null);
  useEffect(() => { api.get(`/r/${token}/history`).then(setItems).catch(() => setItems([])); }, [token, version]);
  if (!items) return <div className="panel"><p className="empty">Loading…</p></div>;
  return (
    <div className="panel">
      <p className="hint">Every comment, decision and edit is a saved version in Git. Click one to see what it changed.</p>
      <ol className="history">{items.map((h) => <HistoryEntry key={h.hash} h={h} token={token} />)}</ol>
    </div>
  );
}

// ------------------------------------------------------------------ sidebar

export default function Sidebar(props) {
  const { tab, setTab, comments, changes, people, me, since } = props;
  const openComments = comments.filter((c) => !c.resolved).length;
  const tabs = [
    ['comments', `Comments${openComments ? ` (${openComments})` : ''}`],
    ['changes', `Changes${changes.length || since.length ? ` (${changes.length}${since.length ? ` + ${since.length} new` : ''})` : ''}`],
    ['people', `People (${people.length})`],
    ['history', 'History'],
  ];
  return (
    <aside className="sidebar">
      <nav className="tabs">
        {tabs.map(([id, label]) => <button type="button" key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      {tab === 'comments' && <CommentsPanel {...props} onSelect={props.onSelectComment} />}
      {tab === 'changes' && <ChangesPanel {...props} onSelect={props.onSelectChange} />}
      {tab === 'people' && <PeoplePanel people={people} me={me} token={props.token} onChanged={props.refresh} mail={props.mail} round={props.round} readOnly={props.readOnly} />}
      {tab === 'history' && <HistoryPanel token={props.token} version={props.version} />}
    </aside>
  );
}
