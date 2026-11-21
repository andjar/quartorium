import { useEffect, useRef, useState } from 'react';
import { api, timeAgo } from '../api.js';
import Modal from './Modal.jsx';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function FinishReview({ me, changes, comments, onDone, onClose }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const mine = changes.filter((c) => c.authorId === me.id).length;
  const said = comments.filter((c) => c.author === me.name).length;
  const submit = async () => { setBusy(true); try { await onDone(note); onClose(); } finally { setBusy(false); } };
  return (
    <Modal title="Finish your review" onClose={onClose} actions={<>
      <button type="button" className="ghost" onClick={onClose}>Not yet</button>
      <button type="button" disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Send to the lead author'}</button>
    </>}>
      <p>You made <strong>{plural(mine, 'suggested change')}</strong> and <strong>{plural(said, 'comment')}</strong>. Everything is already saved; this tells the lead author you are done and records your review in the paper’s history.</p>
      <label>A note for the lead author (optional)
        <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="E.g. “Mostly language; I’m unsure about the second paragraph of the discussion.”" />
      </label>
      <p className="hint">You can still make changes afterwards; the lead will see them.</p>
    </Modal>
  );
}

function FinishRound({ live, onDone, onClose }) {
  const [removeResolved, setRemoveResolved] = useState(true);
  const [merge, setMerge] = useState(true);
  const [busy, setBusy] = useState(false);
  const reviewers = live.people.filter((p) => p.role === 'reviewer');
  const notDone = reviewers.filter((p) => p.status !== 'done');
  const open = live.changes.length;
  const openComments = live.comments.filter((c) => !c.resolved).length;
  const resolved = live.comments.filter((c) => c.resolved).length;
  const submit = async () => { setBusy(true); try { await onDone({ removeResolved, merge }); onClose(); } finally { setBusy(false); } };
  return (
    <Modal title="Finish this review round" onClose={onClose} actions={<>
      <button type="button" className="ghost" onClick={onClose}>Cancel</button>
      <button type="button" disabled={busy} onClick={submit}>{busy ? 'Finishing…' : 'Finish round'}</button>
    </>}>
      <ul className="summary">
        <li>{notDone.length ? <><strong>{notDone.map((p) => p.name).join(', ')}</strong> {notDone.length === 1 ? 'has' : 'have'} not finished yet.</> : 'All reviewers have finished.'}</li>
        <li>{open ? <><strong>{plural(open, 'suggestion')}</strong> not decided: they stay on the reviewers’ branches but won’t be in the paper.</> : 'Every suggestion has been decided.'}</li>
        <li>{plural(openComments, 'open comment thread')} will stay in the file for the next round.</li>
      </ul>
      {resolved > 0 && <label className="check"><input type="checkbox" checked={removeResolved} onChange={(e) => setRemoveResolved(e.target.checked)} /> Remove the {plural(resolved, 'resolved thread')} from the file (they stay in the history)</label>}
      <label className="check"><input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} /> Then merge the result into the main branch</label>
      <p className="hint">Afterwards, reviewers can still read the paper but not change it. You can start the next round with the same people and links.</p>
    </Modal>
  );
}

function NextRound({ data, live, onDone, onClose }) {
  const [title, setTitle] = useState(data.round.title);
  const reviewers = live.people.filter((p) => p.role === 'reviewer');
  const [keep, setKeep] = useState(() => new Set(reviewers.map((p) => p.id)));
  const [busy, setBusy] = useState(false);
  const toggle = (id) => setKeep((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const submit = async () => {
    setBusy(true);
    try { await onDone({ title, memberIds: [...live.people.filter((p) => p.role === 'lead').map((p) => p.id), ...keep] }); onClose(); } finally { setBusy(false); }
  };
  return (
    <Modal title="Start the next round" onClose={onClose} actions={<>
      <button type="button" className="ghost" onClick={onClose}>Cancel</button>
      <button type="button" disabled={busy} onClick={submit}>{busy ? 'Starting…' : 'Start next round'}</button>
    </>}>
      <p>The new round starts from {data.round.mergedAt ? <>the main branch (this round was merged into it)</> : <>this round’s version of the paper</>}. People keep their links, and see what changed since they last looked.</p>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      {reviewers.length > 0 && <fieldset className="people-pick"><legend>Invite again</legend>
        {reviewers.map((p) => <label key={p.id} className="check"><input type="checkbox" checked={keep.has(p.id)} onChange={() => toggle(p.id)} /> {p.name}</label>)}
      </fieldset>}
    </Modal>
  );
}

function EarlierRounds({ token, onClose }) {
  const [rounds, setRounds] = useState(null);
  useEffect(() => { api.get(`/r/${token}/rounds`).then(setRounds).catch(() => setRounds([])); }, [token]);
  return (
    <Modal title="Earlier rounds" onClose={onClose} actions={<button type="button" className="ghost" onClick={onClose}>Close</button>}>
      {!rounds ? <p className="muted">Loading…</p> : rounds.length === 0 ? <p className="muted">This is the first round.</p> : (
        <ul className="rounds-list">
          {rounds.map((r) => (
            <li key={r.id}>
              <strong>{r.title}</strong> <span className="muted">finished {timeAgo(r.finishedAt)}{r.mergedAt ? ', merged into main' : ''} · <code>{r.branch}</code></span>
              {r.token && <a className="button small" href={`/r/${r.token}`} target="_blank" rel="noreferrer">Open (read-only)</a>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function RoundMenu({ data, onAction }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const finished = data.round.status !== 'open';
  const item = (label, kind, hint) => <button type="button" onClick={() => { setOpen(false); onAction(kind); }}><span>{label}</span>{hint && <small>{hint}</small>}</button>;
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="ghost small" onClick={() => setOpen((o) => !o)}>Round ▾</button>
      {open && (
        <div className="menu-items">
          {!finished && item(`Update from ${data.round.baseBranch}`, 'sync', 'Bring in what you pushed from your own editor')}
          {item(`Merge into ${data.round.baseBranch}`, 'merge', 'Put the accepted text into the main branch')}
          {!finished && item('Finish round…', 'finish', 'Close the round for reviewers')}
          {finished && !data.round.nextRoundId && item('Start next round…', 'next', 'Same people, same links')}
          {finished && !data.round.nextRoundId && item('Reopen round', 'reopen')}
          {item('Earlier rounds…', 'earlier')}
        </div>
      )}
    </div>
  );
}

export default function Topbar({ data, live, saveState, token, queueCount, onQueue, onFinishReview, onRoundAction, busy }) {
  const [modal, setModal] = useState(null);
  const isLead = data.me.role === 'lead';
  const open = data.round.status === 'open';
  const action = (kind) => {
    if (['finish', 'next', 'earlier'].includes(kind)) setModal(kind);
    else onRoundAction(kind);
  };
  return (
    <header className="topbar">
      <div className="title">
        <strong>{data.round.title}</strong>
        <span className="muted">{data.round.docPath}{data.round.status !== 'open' ? ' · round finished' : ''}</span>
      </div>
      <div className="status">
        {open && <span className={`save ${saveState}`}>{{ saved: 'All changes saved', dirty: 'Editing…', saving: 'Saving…', error: 'Not saved' }[saveState]}</span>}
        <span className={`role ${data.me.role}`} title={isLead ? 'Your edits go straight into the paper; you decide on suggestions.' : 'Your edits are suggestions for the lead author.'}>
          {data.me.name} · {isLead ? 'Lead author' : 'Reviewer'}
        </span>
        {isLead && open && <button type="button" className="small" disabled={!queueCount} onClick={onQueue} title="Go through suggestions and comments one by one">Review {queueCount ? `(${queueCount})` : ''}</button>}
        {isLead && <RoundMenu data={data} onAction={action} busy={busy} />}
        {!isLead && open && (data.me.status === 'done'
          ? <button type="button" className="ghost small done" onClick={() => setModal('review')} title="The lead knows you are done. You can still make changes.">✓ Review sent</button>
          : <button type="button" className="small" onClick={() => setModal('review')}>Finish my review</button>)}
      </div>
      {modal === 'review' && <FinishReview me={data.me} changes={live.changes} comments={live.comments} onDone={onFinishReview} onClose={() => setModal(null)} />}
      {modal === 'finish' && <FinishRound live={live} onDone={(o) => onRoundAction('finish', o)} onClose={() => setModal(null)} />}
      {modal === 'next' && <NextRound data={data} live={live} onDone={(o) => onRoundAction('next', o)} onClose={() => setModal(null)} />}
      {modal === 'earlier' && <EarlierRounds token={token} onClose={() => setModal(null)} />}
    </header>
  );
}
