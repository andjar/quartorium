import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { EditorContent, useEditor, BubbleMenu } from '@tiptap/react';
import { api, ApiError } from '../api.js';
import { buildExtensions } from './extensions.js';
import { Highlights, highlightKey, anchorFromSelection, anchorBefore, locateAnchor, textIndex } from './anchors.js';
import { RenderContext } from './renderContext.js';
import Sidebar from './Sidebar.jsx';
import Toolbar from './Toolbar.jsx';
import CitePicker from './CitePicker.jsx';
import { setChipData, citationNode } from './chipLabels.js';

const SAVE_DELAY = 1200;
const POLL_EVERY = 10000;

const NOTICE_TEXT = {
  accepted: (n) => `${n.by} accepted your change “${n.text}”.`,
  rejected: (n) => `${n.by} did not take your change “${n.text}”.`,
  conflict: (n) => `${n.count} of your changes touched text that was rewritten meanwhile. They are kept under Changes as outdated suggestions.`,
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
  const [draft, setDraft] = useState(null);
  const [located, setLocated] = useState({});
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(null);
  const [picker, setPicker] = useState(null);
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
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 6000);
  }, []);

  // ---------------------------------------------------------------- loading
  const applyLive = useCallback((d) => {
    setLive((prev) => ({
      comments: d.comments ?? prev.comments,
      changes: d.changes ?? prev.changes,
      people: d.people ?? prev.people,
      version: d.version ?? prev.version,
      pushError: d.pushError,
      render: d.render ? { ...d.render, outputs: d.render.outputs ?? prev.render.outputs } : prev.render,
    }));
  }, []);

  const load = useCallback(async () => {
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
      for (const n of d.notices || []) if (NOTICE_TEXT[n.type]) toast(NOTICE_TEXT[n.type](n));
      if (d.me.role === 'lead' && d.changes.length && !d.comments.some((c) => !c.resolved)) setTab('changes');
    } catch (e) {
      setLoadError(e.message);
    }
  }, [token, applyLive, toast]);

  useEffect(() => { load(); }, [load]);

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

  useEffect(() => {
    const warn = (e) => { if (dirty.current || saving.current) { save(); e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [save]);

  const reload = useCallback(async () => { await save(); await load(); }, [save, load]);

  // ---------------------------------------------------------------- polling
  useEffect(() => {
    if (!data) return undefined;
    const tick = async () => {
      try {
        const a = await api.get(`/r/${token}/activity?renderKey=${encodeURIComponent(live.render.key || '')}`);
        applyLive(a);
        if (a.proseVersion !== proseVersion.current && !halted.current) setStale((s) => s || { reason: 'updated' });
      } catch { /* offline for a moment: try again next tick */ }
    };
    const id = setInterval(tick, POLL_EVERY);
    return () => clearInterval(id);
  }, [data, token, live.render.key, applyLive]);

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
  ], [toast]);

  const editor = useEditor({
    extensions,
    content: data?.doc || null,
    editorProps: { attributes: { class: 'paper', spellcheck: 'true' } },
    onUpdate: ({ transaction }) => { if (transaction.docChanged) scheduleSave(); },
  }, [docKey, data?.doc]);
  editorRef.current = editor;

  // Positions of blocks and comments, for ordering the sidebar like the paper.
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

  const changeKeys = useMemo(() => {
    const map = {};
    for (const c of live.changes) {
      if (!c.anchor || c.status !== 'open') continue;
      (map[c.anchor.key] ||= { ids: [] }).ids.push(c.id);
    }
    return map;
  }, [live.changes]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(highlightKey, { comments: live.comments, activeComment, changeKeys, activeChange }));
    const loc = highlightKey.getState(editor.state)?.located || {};
    setLocated((prev) => (JSON.stringify(prev) === JSON.stringify(loc) ? prev : loc));
  }, [editor, live.comments, activeComment, changeKeys, activeChange]);

  const selectComment = (id) => {
    setActiveComment(id);
    requestAnimationFrame(() => document.querySelector(`.paper [data-comment="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };
  const selectChange = (id) => {
    setActiveChange(id);
    requestAnimationFrame(() => document.querySelector(`.paper .has-change[data-change-ids*="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };
  const order = {
    comments: (a, b) => (positions.comments[a.id] ?? Infinity) - (positions.comments[b.id] ?? Infinity),
    changes: (a, b) => (positions.blocks[a.anchor?.key] ?? Infinity) - (positions.blocks[b.anchor?.key] ?? Infinity),
  };

  // ---------------------------------------------------------------- actions
  const refresh = useCallback(async () => applyLive(await api.get(`/r/${token}/activity?renderKey=${encodeURIComponent(live.render.key || '')}`)), [token, live.render.key, applyLive]);
  const guarded = (fn) => async (...args) => {
    try { return await fn(...args); } catch (e) { toast(e.message, 'error'); if (e.data?.reload) await load(); throw e; }
  };
  const actions = {
    addComment: guarded(async (anchor, text, type) => { await save(); const c = await api.post(`/r/${token}/comments`, { anchor, text, type }); await refresh(); setActiveComment(c.id); }),
    reply: guarded(async (id, text) => { await api.post(`/r/${token}/comments/${id}/replies`, { text }); await refresh(); }),
    resolve: guarded(async (id, resolved) => { await api.post(`/r/${token}/comments/${id}/resolve`, { resolved }); await refresh(); }),
    agree: guarded(async (id) => { await api.post(`/r/${token}/comments/${id}/agree`); await refresh(); }),
    accept: guarded(async (id) => { await save(); await api.post(`/r/${token}/changes/${id}/accept`); await load(); toast('Change accepted.'); }),
    reject: guarded(async (id) => {
      await save();
      await api.post(`/r/${token}/changes/${id}/reject`);
      if (data.me.role === 'lead') await refresh(); else await load();
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

  // Citations: the picker opens from the toolbar or when "@" is typed.
  useEffect(() => { if (live.render.xrefs) setChipData({ xrefs: live.render.xrefs }); }, [live.render.xrefs]);
  const openPicker = (atPos = null) => {
    if (!editor) return;
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

  const sync = async () => {
    if (!window.confirm(`Bring the latest version of ${data.round.baseBranch} into this round? Use this after you pushed changes from your own editor.`)) return;
    setBusy('sync');
    try {
      await save();
      const r = await api.post(`/r/${token}/sync`);
      if (r.upToDate) toast(`Already up to date with ${data.round.baseBranch}.`);
      else { await load(); toast(`Brought in the latest ${data.round.baseBranch}.`); }
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  };

  const retryRender = async () => {
    try { applyLive({ render: await api.post(`/r/${token}/render`) }); } catch (e) { toast(e.message, 'error'); }
  };

  // ---------------------------------------------------------------- view
  if (loadError) return <div className="centered"><div className="card"><h2>Can’t open this paper</h2><p>{loadError}</p></div></div>;
  if (!data) return <div className="centered muted">Opening the paper…</div>;

  const isLead = data.me.role === 'lead';
  const render = live.render;
  return (
    <div className="review">
      <header className="topbar">
        <div className="title">
          <strong>{data.round.title}</strong>
          <span className="muted">{data.round.docPath}</span>
        </div>
        <div className="status">
          <span className={`save ${saveState}`}>{{ saved: 'All changes saved', dirty: 'Editing…', saving: 'Saving…', error: 'Not saved' }[saveState]}</span>
          <span className={`role ${data.me.role}`} title={isLead ? 'Your edits go straight into the paper; you decide on suggestions.' : 'Your edits are suggestions for the lead author.'}>
            {data.me.name} · {isLead ? 'Lead author' : 'Reviewer'}
          </span>
          {isLead && <button type="button" className="ghost small" disabled={busy === 'sync'} onClick={sync}>{busy === 'sync' ? 'Updating…' : `Update from ${data.round.baseBranch}`}</button>}
        </div>
      </header>

      {stale && (
        <div className={`banner ${stale.reason === 'conflict' ? 'warn' : ''}`}>
          {stale.reason === 'conflict'
            ? <>This paper was changed in another window or by another lead. Reload to continue{dirty.current ? ' (your last few seconds of typing may be lost)' : ''}.</>
            : isLead ? <>The paper was changed elsewhere. Reload to see the latest version.</>
              : <>The lead author has updated the paper. Reload to see the latest version — your own edits are kept.</>}
          <button type="button" className="small" onClick={reload}>Reload</button>
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
          <Toolbar editor={editor} onComment={startComment} onCite={() => openPicker()} />
          {editor && (
            <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }} shouldShow={({ state }) => !state.selection.empty && !state.selection.node}>
              <div className="bubble">
                <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'on' : ''}><b>B</b></button>
                <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? 'on' : ''}><i>I</i></button>
                <button type="button" onClick={startComment}>💬 Comment</button>
              </div>
            </BubbleMenu>
          )}
          <RenderContext.Provider value={{ outputs: render.outputs || {}, status: render.status }}>
            <EditorContent editor={editor} key={docKey} />
          </RenderContext.Provider>
        </main>
        <Sidebar
          tab={tab} setTab={setTab} me={data.me} token={token} version={live.version}
          comments={live.comments} changes={live.changes} people={live.people}
          draft={draft} setDraft={setDraft} actions={actions} located={located}
          activeComment={activeComment} onSelectComment={selectComment}
          activeChange={activeChange} onSelectChange={selectChange}
          order={tab === 'changes' ? order.changes : order.comments}
          refresh={refresh}
        />
      </div>

      {picker && (
        <CitePicker references={data.references} xrefs={live.render.xrefs} position={picker.coords}
          onPick={pickCitation} onRequest={requestReference} onClose={closePicker} />
      )}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
    </div>
  );
}
