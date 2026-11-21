import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import { api, ApiError, timeAgo } from '../api.js';
import { buildExtensions } from './extensions.js';
import { Highlights, highlightKey, anchorFromSelection, anchorBefore, locateAnchor, textIndex } from './anchors.js';
import { TrackChanges, trackKey } from './trackChanges.js';
import { RenderContext } from './renderContext.js';
import Sidebar from './Sidebar.jsx';
import Toolbar from './Toolbar.jsx';
import Topbar from './Topbar.jsx';
import ReviewBar from './ReviewBar.jsx';
import SelectionMenu from './SelectionMenu.jsx';
import CitePicker from './CitePicker.jsx';
import { setChipData, citationNode } from './chipLabels.js';

const SAVE_DELAY = 1200;
const POLL_EVERY = 10000;

const NOTICE_TEXT = {
  accepted: (n) => `${n.by} accepted your change “${n.text}”.`,
  rejected: (n) => `${n.by} did not take your change “${n.text}”.`,
  conflict: (n) => `${n.count} of your changes touched text that was rewritten meanwhile. They are kept under Changes as outdated suggestions.`,
  finished: (n) => `${n.by} finished their review${n.text ? `: “${n.text}”` : '.'}`,
  'new-round': (n) => `${n.by} started a new round: “${n.text}”. What changed since your last visit is highlighted.`,
  'main-conflict': (n) => `${n.count === 1 ? 'A paragraph was' : `${n.count} paragraphs were`} changed both here and on ${n.text}. The ${n.text} version is kept; the other version is attached as a comment.`,
};

export default function ReviewPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [docKey, setDocKey] = useState(0);
  const [saveState, setSaveState] = useState('saved');
  const [live, setLive] = useState({ comments: [], changes: [], people: [], render: { outputs: {}, status: 'none' }, version: 0 });
  const [stale, setStale] = useState(null);
  const [tab, setTab] = useState('comments');
  const [activeComment, setActiveComment] = useState(null);
  const [activeChange, setActiveChange] = useState(null);
  const [activeSince, setActiveSince] = useState(null);
  const [showSince, setShowSince] = useState(true);
  const [draft, setDraft] = useState(null);
  const [located, setLocated] = useState({});
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(null);
  const [picker, setPicker] = useState(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueIndex, setQueueIndex] = useState(0);
  const [queueVersion, setQueueVersion] = useState(0);
  const openPickerRef = useRef(null);

  const rev = useRef(0);
  const proseVersion = useRef(0);
  const saveTimer = useRef(null);
  const saving = useRef(null);
  const dirty = useRef(false);
  const halted = useRef(false);
  const editorRef = useRef(null);

  const toast = useCallback((text, kind = 'info') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 10000 : 7000);
  }, []);

  // ---------------------------------------------------------------- loading
  const applyLive = useCallback((d) => {
    setLive((prev) => ({
      comments: d.comments ?? prev.comments,
      changes: d.changes ?? prev.changes,
      people: d.people ?? prev.people,
      version: d.version ?? prev.version,
      round: d.round ?? prev.round,
      pushError: d.pushError,
      render: d.render ? { ...d.render, outputs: d.render.outputs ?? prev.render.outputs, xrefs: d.render.xrefs ?? prev.render.xrefs } : prev.render,
    }));
  }, []);

  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      const d = await api.get(`/r/${token}`);
      rev.current = d.rev;
      proseVersion.current = d.proseVersion;
      dirty.current = false;
      halted.current = false;
      setStale(null);
      setData(d);
      applyLive(d);
      setChipData({ entries: d.references?.entries || [], hasBibliography: (d.references?.files || []).length > 0 });
      setDocKey((k) => k + 1);
      setSaveState('saved');
      if (!quiet) {
        for (const n of d.notices || []) if (NOTICE_TEXT[n.type]) toast(NOTICE_TEXT[n.type](n));
        if (d.sinceLastVisit?.changes?.length) { setTab('changes'); setShowSince(true); }
        else if (d.me.role === 'lead' && d.changes.length && !d.comments.some((c) => !c.resolved)) setTab('changes');
      }
      return d;
    } catch (e) {
      setLoadError(e.message);
      return null;
    }
  }, [token, applyLive, toast]);

  useEffect(() => { load(); }, [load]);

  const isOpen = (live.round || data?.round)?.status === 'open';

  // ---------------------------------------------------------------- saving
  const save = useCallback(async () => {
    clearTimeout(saveTimer.current);
    if (saving.current) await saving.current;
    const editor = editorRef.current;
    if (!dirty.current || !editor || halted.current) return;
    dirty.current = false;
    setSaveState('saving');
    const body = data?.me.role === 'lead' ? { doc: editor.getJSON(), proseVersion: proseVersion.current } : { doc: editor.getJSON(), rev: rev.current };
    saving.current = api.put(`/r/${token}/doc`, body).then((res) => {
      if (res.rev !== undefined) rev.current = res.rev;
      if (res.proseVersion !== undefined) proseVersion.current = res.proseVersion;
      if (res.status && res.status !== data?.me.status) setData((d) => ({ ...d, me: { ...d.me, status: res.status } }));
      setSaveState(dirty.current ? 'dirty' : 'saved');
    }).catch((e) => {
      if (e instanceof ApiError && e.data.reload) {
        halted.current = true;
        setStale({ reason: 'conflict', message: e.message });
        setSaveState('error');
      } else {
        dirty.current = true;
        setSaveState('error');
        toast(`Could not save: ${e.message}`, 'error');
        saveTimer.current = setTimeout(() => save(), 5000);
      }
    }).finally(() => { saving.current = null; });
    await saving.current;
  }, [data, token, toast]);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setSaveState('dirty');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, SAVE_DELAY);
  }, [save]);

  // Leaving the page: save, and let the server commit what was done.
  useEffect(() => {
    const warn = (e) => { if (dirty.current || saving.current) { save(); e.preventDefault(); e.returnValue = ''; } };
    const leave = () => {
      if (document.visibilityState !== 'hidden') return;
      save().finally(() => navigator.sendBeacon?.(`/api/r/${token}/pause`, ''));
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('visibilitychange', leave);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('visibilitychange', leave); };
  }, [save, token]);

  const reload = useCallback(async () => { await save(); await load({ quiet: true }); }, [save, load]);

  // ---------------------------------------------------------------- polling
  useEffect(() => {
    if (!data) return undefined;
    const tick = async () => {
      try {
        // Outputs are only sent again when the render changed or is still running.
        const known = live.render.status === 'rendering' ? '' : live.render.key || '';
        const a = await api.get(`/r/${token}/activity?renderKey=${encodeURIComponent(known)}`);
        applyLive(a);
        if (a.round?.status !== data.round.status) { await save(); await load({ quiet: true }); return; }
        if (a.proseVersion !== proseVersion.current && !halted.current) setStale((s) => s || { reason: 'updated' });
      } catch { /* offline for a moment: try again next tick */ }
    };
    const id = setInterval(tick, POLL_EVERY);
    return () => clearInterval(id);
  }, [data, token, live.render.key, live.render.status, applyLive, save, load]);

  // ---------------------------------------------------------------- editor
  const extensions = useMemo(() => [
    ...buildExtensions({
      onBlocked: () => toast('Code, figures, tables and equations can’t be removed or moved here. Ask the lead author to change them in the source.'),
      onAt: (pos) => openPickerRef.current?.(pos),
    }),
    Highlights.configure({
      onCommentClick: (id) => { setActiveComment(id); setTab('comments'); },
      onChangeClick: (id) => { setActiveChange(id); setTab('changes'); },
    }),
    TrackChanges,
  ], [toast]);

  const editor = useEditor({
    extensions,
    content: data?.doc || null,
    editable: data?.round.status === 'open',
    editorProps: { attributes: { class: 'paper', spellcheck: 'true' } },
    onUpdate: ({ transaction }) => { if (transaction.docChanged) scheduleSave(); },
  }, [docKey, data?.doc]);
  editorRef.current = editor;

  useEffect(() => { if (editor && !editor.isDestroyed) editor.setEditable(Boolean(isOpen)); }, [editor, isOpen]);

  // Positions of blocks and comments, for ordering things like the paper.
  const positions = useMemo(() => {
    const blocks = {}, comments = {};
    if (!editor || editor.isDestroyed) return { blocks, comments };
    editor.state.doc.forEach((n, pos) => {
      const key = n.type.name === 'locked' ? n.attrs.key : n.attrs.seg;
      if (key && blocks[key] === undefined) blocks[key] = pos;
    });
    const index = textIndex(editor.state.doc);
    for (const c of live.comments) { const r = locateAnchor(index, c.anchor); comments[c.id] = r ? r.from : Infinity; }
    return { blocks, comments };
  }, [editor, live.comments, live.changes, docKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const changePos = useCallback((c) => {
    const p = positions.blocks[c.anchor?.key];
    return p === undefined ? Infinity : p + (c.anchor?.after ? 0.5 : 0);
  }, [positions]);

  const changeKeys = useMemo(() => {
    const map = {};
    for (const c of live.changes) {
      if (!c.anchor || c.status !== 'open') continue;
      (map[c.anchor.key] ||= { ids: [] }).ids.push(c.id);
    }
    return map;
  }, [live.changes]);

  // The lead's review queue: groups of competing changes, and open comments, in document order.
  const queue = useMemo(() => {
    const groups = new Map();
    for (const c of [...live.changes].sort((a, b) => changePos(a) - changePos(b))) {
      const k = c.status === 'open' && c.anchor ? `${c.anchor.key}:${c.anchor.after}` : c.id;
      if (!groups.has(k)) groups.set(k, { type: 'change', id: k, group: [], pos: changePos(c) });
      groups.get(k).group.push(c);
    }
    const comments = live.comments.filter((c) => !c.resolved).map((c) => ({ type: 'comment', id: c.id, comment: c, pos: positions.comments[c.id] ?? Infinity }));
    return [...groups.values(), ...comments].sort((a, b) => a.pos - b.pos);
  }, [live.changes, live.comments, positions, changePos]);

  const queueItem = queueOpen ? queue[Math.min(queueIndex, queue.length - 1)] : null;
  const queueChange = queueItem?.type === 'change' ? queueItem.group[Math.min(queueVersion, queueItem.group.length - 1)] : null;
  useEffect(() => { setQueueVersion(0); }, [queueIndex]);
  useEffect(() => { if (queueIndex >= queue.length && queue.length) setQueueIndex(queue.length - 1); }, [queue.length, queueIndex]);

  // Feed comment highlights and change markers.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const focusComment = queueItem?.type === 'comment' ? queueItem.id : activeComment;
    editor.view.dispatch(editor.state.tr.setMeta(highlightKey, { comments: live.comments, activeComment: focusComment, changeKeys, activeChange: queueChange?.id || activeChange }));
    const loc = highlightKey.getState(editor.state)?.located || {};
    setLocated((prev) => (JSON.stringify(prev) === JSON.stringify(loc) ? prev : loc));
  }, [editor, live.comments, activeComment, changeKeys, activeChange, queueItem, queueChange]);

  // Feed inline change marking: own edits, since-last-visit, and the selected change.
  const since = useMemo(() => data?.sinceLastVisit?.changes || [], [data]);
  const selectedChange = queueChange || live.changes.find((c) => c.id === activeChange) || null;
  const selectedSince = activeSince != null ? since[activeSince] : null;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    let preview = null;
    if (selectedChange) preview = { old: selectedChange.old, new: selectedChange.new, after: selectedChange.anchor?.after ? selectedChange.anchor.key : null, docIsNew: false, title: `Suggested by ${selectedChange.author}` };
    else if (selectedSince) preview = { old: selectedSince.old, new: selectedSince.new, after: selectedSince.anchor?.after ? selectedSince.anchor.key : null, docIsNew: true, title: `Changed by ${selectedSince.by}` };
    editor.view.dispatch(editor.state.tr.setMeta(trackKey, {
      own: data?.me.role === 'reviewer' ? data.track || [] : null,
      since: showSince ? since : [],
      preview,
    }));
  }, [editor, data, since, showSince, selectedChange, selectedSince]);

  const scrollToKey = (key) => requestAnimationFrame(() => {
    const el = document.querySelector('.paper .tc-preview') || (key && [...document.querySelectorAll('.paper > *')].find((n) => n.classList.contains('has-change')));
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  useEffect(() => { if (queueChange) scrollToKey(queueChange.anchor?.key); }, [queueChange]);
  useEffect(() => {
    if (queueItem?.type === 'comment') requestAnimationFrame(() => document.querySelector(`.paper [data-comment="${queueItem.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }, [queueItem]);

  const selectComment = (id) => {
    setActiveComment(id);
    requestAnimationFrame(() => document.querySelector(`.paper [data-comment="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };
  const selectChange = (id) => { setActiveSince(null); setActiveChange((cur) => (cur === id ? null : id)); scrollToKey(); };
  const selectSince = (i) => { setActiveChange(null); setActiveSince((cur) => (cur === i ? null : i)); setShowSince(true); scrollToKey(); };
  const order = {
    comments: (a, b) => (positions.comments[a.id] ?? Infinity) - (positions.comments[b.id] ?? Infinity),
    changes: (a, b) => changePos(a) - changePos(b),
  };

  // ---------------------------------------------------------------- actions
  const refresh = useCallback(async () => {
    const known = live.render.status === 'rendering' ? '' : live.render.key || '';
    applyLive(await api.get(`/r/${token}/activity?renderKey=${encodeURIComponent(known)}`));
  }, [token, live.render.key, live.render.status, applyLive]);
  const guarded = (fn) => async (...args) => {
    try { return await fn(...args); } catch (e) { toast(e.message, 'error'); if (e.data?.reload) await load({ quiet: true }); throw e; }
  };
  const actions = {
    addComment: guarded(async (anchor, text, type) => { await save(); const c = await api.post(`/r/${token}/comments`, { anchor, text, type }); await refresh(); setActiveComment(c.id); }),
    reply: guarded(async (id, text) => { await api.post(`/r/${token}/comments/${id}/replies`, { text }); await refresh(); }),
    resolve: guarded(async (id, resolved) => { await api.post(`/r/${token}/comments/${id}/resolve`, { resolved }); await refresh(); }),
    agree: guarded(async (id) => { await api.post(`/r/${token}/comments/${id}/agree`); await refresh(); }),
    accept: guarded(async (id) => { await save(); await api.post(`/r/${token}/changes/${id}/accept`); setActiveChange(null); await load({ quiet: true }); }),
    acceptAll: guarded(async (authorId) => {
      await save();
      const r = await api.post(`/r/${token}/changes/accept-all`, authorId ? { authorId } : {});
      await load({ quiet: true });
      toast(r.accepted ? `Accepted ${r.accepted} change${r.accepted === 1 ? '' : 's'}.` : 'Nothing to accept without choosing between versions.');
    }),
    reject: guarded(async (id) => {
      await save();
      await api.post(`/r/${token}/changes/${id}/reject`);
      setActiveChange(null);
      if (data.me.role === 'lead') await refresh(); else await load({ quiet: true });
    }),
    discuss: (c) => {
      const text = (c.old[0] || c.new[0])?.text || '';
      const quote = text.split(/(?<=[.!?])\s/)[0].slice(0, 120);
      const exists = editor && textIndex(editor.state.doc).text.includes(quote);
      setDraft({ quote: exists ? quote : '', prefix: '', suffix: '', about: c.author });
      setTab('comments');
    },
  };

  const startComment = () => {
    const anchor = editor && anchorFromSelection(editor.state);
    if (!anchor) { toast('Select some text first, then click Comment.'); return; }
    setDraft(anchor);
    setTab('comments');
  };

  const finishReview = guarded(async (note) => {
    await save();
    await api.post(`/r/${token}/finish`, { note });
    setData((d) => ({ ...d, me: { ...d.me, status: 'done' } }));
    toast('Thank you! The lead author can see that you have finished.');
  });

  const roundAction = async (kind, options = {}) => {
    const base = data.round.baseBranch;
    setBusy(kind);
    try {
      await save();
      if (kind === 'sync') {
        const r = await api.post(`/r/${token}/sync`);
        if (r.pulled) await load({ quiet: true });
        const parts = [r.pulled ? `Brought in the latest ${base}` : `Nothing new on ${base}`, r.published ? `${base} is up to date with this round` : null];
        toast(parts.filter(Boolean).join('; ') + '.');
      } else if (kind === 'keep-main') {
        const on = !(live.round || data.round).keepMain;
        if (on && !window.confirm(`Keep ${base} up to date automatically?\n\nAccepted text, your edits here and comments go to ${base}, so a git pull in RStudio brings them.`)) return;
        await api.post(`/r/${token}/round/keep-main`, { on });
        if (on) await api.post(`/r/${token}/sync`).catch((e) => toast(e.message, 'error'));
        await load({ quiet: true });
        toast(on ? `${base} is kept up to date.` : `${base} is no longer updated automatically. Use “Merge into ${base}” when you want.`);
      } else if (kind === 'merge') {
        if (!window.confirm(`Put this round's version of the paper on ${base} and push it?`)) return;
        const r = await api.post(`/r/${token}/round/merge`);
        await load({ quiet: true });
        toast(r.published ? `Merged into ${base}.` : `${base} already contains this round.`);
      } else if (kind === 'finish') {
        const f = await api.post(`/r/${token}/round/finish`, { removeResolved: options.removeResolved });
        let msg = 'Round finished. Reviewers can still read the paper but not change it.';
        if (f.main?.error) toast(f.main.error, 'error');
        if (options.merge) {
          try { await api.post(`/r/${token}/round/merge`); msg += ` Merged into ${base}.`; } catch (e) { toast(e.message, 'error'); }
        }
        await load({ quiet: true });
        toast(msg);
      } else if (kind === 'next') {
        const r = await api.post(`/r/${token}/round/next`, options);
        await load({ quiet: true });
        toast(`Next round started from ${r.from}. Everyone's links now open it.`);
      } else if (kind === 'reopen') {
        await api.post(`/r/${token}/round/reopen`);
        await load({ quiet: true });
      }
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  };

  // Citations: the picker opens from the toolbar or when "@" is typed.
  useEffect(() => { if (live.render.xrefs) setChipData({ xrefs: live.render.xrefs }); }, [live.render.xrefs]);
  const openPicker = (atPos = null) => {
    if (!editor || !isOpen) return;
    const pos = atPos != null ? atPos + 1 : editor.state.selection.to;
    const c = editor.view.coordsAtPos(Math.min(pos, editor.state.doc.content.size));
    editor.view.dom.blur();
    setPicker({ pos, atPos, coords: { left: c.left, top: c.top, bottom: c.bottom } });
  };
  openPickerRef.current = openPicker;
  const typedAt = (p) => p.atPos != null && editor.state.doc.textBetween(p.atPos, p.atPos + 1) === '@';
  const pickCitation = (choice) => {
    const p = picker;
    setPicker(null);
    const range = typedAt(p) ? { from: p.atPos, to: p.atPos + 1 } : p.pos;
    editor.chain().insertContentAt(range, citationNode(choice)).run();
    editor.view.focus(); // synchronously, so the next keystroke lands in the paper
  };
  const requestReference = async (text) => {
    const p = picker;
    setPicker(null);
    const anchor = (!editor.state.selection.empty && anchorFromSelection(editor.state)) || anchorBefore(editor.state, p.atPos ?? p.pos);
    if (typedAt(p)) editor.chain().focus().deleteRange({ from: p.atPos, to: p.atPos + 1 }).run();
    await actions.addComment(anchor, text, 'reference');
    setTab('comments');
    toast('Sent: the lead author will add the reference to the bibliography.');
  };
  const closePicker = () => {
    const p = picker;
    setPicker(null);
    if (p && editor) { editor.commands.setTextSelection(p.atPos != null ? p.atPos + 1 : p.pos); editor.view.focus(); }
  };

  const retryRender = async () => {
    try { applyLive({ render: await api.post(`/r/${token}/render`) }); } catch (e) { toast(e.message, 'error'); }
  };

  // ---------------------------------------------------------------- view
  if (loadError) return <div className="centered"><div className="card"><h2>Can’t open this paper</h2><p>{loadError}</p></div></div>;
  if (!data) return <div className="centered muted">Opening the paper…</div>;

  const isLead = data.me.role === 'lead';
  const render = live.render;
  const round = live.round || data.round;
  const sinceBy = [...new Set(since.map((c) => c.by))];
  return (
    <div className={`review ${queueOpen ? 'with-queue' : ''}`}>
      <Topbar data={{ ...data, round }} live={live} saveState={saveState} token={token} busy={busy}
        queueCount={queue.length} onQueue={() => { setQueueIndex(0); setQueueOpen(true); setActiveChange(null); }}
        onFinishReview={finishReview} onRoundAction={roundAction} />

      {round.status !== 'open' && (
        <div className="banner">
          {isLead
            ? <>This round is finished{round.mergedAt ? ` and merged into ${round.baseBranch}` : ''}. Reviewers can read but not change it. Use <strong>Round ▾</strong> to {round.mergedAt ? '' : `merge it into ${round.baseBranch} or `}start the next round.</>
            : <>This review round has finished — thank you! You can still read the paper. When the lead author starts a new round, this same link will open it.</>}
        </div>
      )}
      {stale && (
        <div className={`banner ${stale.reason === 'conflict' ? 'warn' : ''}`}>
          {stale.reason === 'conflict'
            ? <>This paper was changed in another window or by another lead. Reload to continue{dirty.current ? ' (your last few seconds of typing may be lost)' : ''}.</>
            : isLead ? <>The paper was changed elsewhere (for example a push to {round.baseBranch}). Reload to see the latest version.</>
              : <>The lead author has updated the paper. Reload to see the latest version — your own edits are kept.</>}
          <button type="button" className="small" onClick={reload}>Reload</button>
        </div>
      )}
      {since.length > 0 && showSince && (
        <div className="banner since">
          Since your last visit ({timeAgo(data.sinceLastVisit.at)}): {since.length} paragraph{since.length === 1 ? '' : 's'} changed by {sinceBy.join(', ')} — highlighted in the text.
          <button type="button" className="ghost small" onClick={() => { setTab('changes'); selectSince(0); }}>Show the first</button>
          <button type="button" className="ghost small" onClick={() => { setShowSince(false); setActiveSince(null); }}>Hide</button>
        </div>
      )}
      {isLead && round.mainError && (
        <div className="banner warn">
          {round.mainError.split('\n\n')[0]}
          {round.mainError.includes('\n\n') && <details><summary>Details</summary><pre>{round.mainError.split('\n\n').slice(1).join('\n\n')}</pre></details>}
        </div>
      )}
      {isLead && live.pushError && <div className="banner warn">Could not push to the Git remote: <code>{live.pushError.slice(0, 300)}</code> (work is safe on the server and will be pushed when this is fixed).</div>}
      {render.status === 'rendering' && <div className="banner subtle">Running the code to show figures and tables… This can take a minute.</div>}
      {render.status === 'error' && (
        <div className="banner warn">
          Figures and tables could not be rendered{isLead ? '' : ' yet'}.
          {isLead && <details><summary>Quarto output</summary><pre>{render.error}</pre></details>}
          {isLead && <button type="button" className="small" onClick={retryRender}>Try again</button>}
        </div>
      )}

      <div className="workspace">
        <main className="document">
          {isOpen ? <Toolbar editor={editor} onComment={startComment} onCite={() => openPicker()} /> : <div className="toolbar readonly">Read-only: this round has finished.</div>}
          <SelectionMenu editor={editor} enabled={isOpen} onComment={startComment} />
          <RenderContext.Provider value={{ outputs: render.outputs || {}, status: render.status }}>
            <EditorContent editor={editor} key={docKey} />
          </RenderContext.Provider>
        </main>
        <Sidebar
          tab={tab} setTab={setTab} me={data.me} token={token} version={live.version} mail={data.mail} round={round}
          comments={live.comments} changes={live.changes} people={live.people} since={since}
          draft={draft} setDraft={setDraft} actions={actions} located={located} readOnly={!isOpen}
          activeComment={activeComment} onSelectComment={selectComment}
          activeChange={activeChange} onSelectChange={selectChange}
          activeSince={activeSince} onSelectSince={selectSince}
          order={tab === 'changes' ? order.changes : order.comments}
          refresh={refresh}
        />
      </div>

      {queueOpen && (
        <ReviewBar items={queue} index={Math.min(queueIndex, Math.max(0, queue.length - 1))} setIndex={setQueueIndex}
          version={queueVersion} setVersion={setQueueVersion}
          onAccept={(id) => actions.accept(id)} onReject={(id) => actions.reject(id)} onResolve={(id) => actions.resolve(id, true)}
          onClose={() => setQueueOpen(false)} />
      )}
      {picker && (
        <CitePicker references={data.references} xrefs={live.render.xrefs} position={picker.coords}
          onPick={pickCitation} onRequest={requestReference} onClose={closePicker} />
      )}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
    </div>
  );
}
