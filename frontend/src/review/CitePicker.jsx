import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { xrefName } from './chipLabels.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/**
 * Search the paper's bibliography and its figures/tables/equations/sections.
 * The bibliography is read-only here: missing references are requested from the lead.
 */
export default function CitePicker({ references, xrefs, position, onPick, onRequest, onClose }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [locator, setLocator] = useState('');
  const [inText, setInText] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [request, setRequest] = useState('');
  const box = useRef(null);
  const search = useRef(null);
  const [style, setStyle] = useState({ visibility: 'hidden' });

  // The editor tends to take focus back right after "@" is typed; claim it once settled.
  useEffect(() => {
    const t = setTimeout(() => search.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const items = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(Boolean);
    const match = (hay) => words.every((w) => norm(hay).includes(w));
    const refs = (references?.entries || [])
      .filter((e) => match(`${e.label} ${e.title} ${e.id} ${e.year}`))
      .map((e) => ({ type: 'ref', id: e.id, main: e.label, sub: e.title || e.full }));
    const labels = (references?.labels || [])
      .map((l) => ({ type: 'label', id: l.id, main: xrefs?.[l.id] || xrefName(l.id), sub: l.description || l.id }))
      .filter((l) => match(`${l.main} ${l.sub} ${l.id}`));
    return [...refs.slice(0, 40), ...labels.slice(0, 20)];
  }, [query, references, xrefs]);

  useEffect(() => { setIndex(0); }, [query]);

  // Place the box under the cursor, inside the window.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = Math.min(position.left, window.innerWidth - w - 12);
    let top = position.bottom + 6;
    if (top + h > window.innerHeight - 12) top = Math.max(12, position.top - h - 6);
    setStyle({ left: Math.max(12, left), top });
  }, [position, items.length, requesting]);

  const pick = (item) => {
    if (!item) return;
    onPick({ id: item.id, mode: item.type === 'label' || inText ? 'AuthorInText' : 'NormalCitation', locator: item.type === 'ref' ? locator : '' });
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && !requesting) { e.preventDefault(); pick(items[index]); }
  };

  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);

  const hasBib = (references?.entries || []).length > 0;
  const firstLabel = items.findIndex((i) => i.type === 'label');
  return (
    <div className="cite-picker" ref={box} style={style} onKeyDown={onKeyDown} role="dialog" aria-label="Insert a citation">
      <input ref={search} autoFocus placeholder="Search author, title, year, or figure/table…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul className="results">
        {items.length === 0 && <li className="empty">{hasBib || references?.labels?.length ? 'Nothing matches.' : 'This paper has no bibliography and no labelled figures or tables.'}</li>}
        {items.map((it, i) => (
          <li key={`${it.type}:${it.id}`}>
            {i === 0 && it.type === 'ref' && <div className="group">Bibliography</div>}
            {i === firstLabel && <div className="group">In this paper</div>}
            <button type="button" className={i === index ? 'on' : ''} onMouseEnter={() => setIndex(i)} onClick={() => pick(it)}>
              <span className="main">{it.main}</span>
              <span className="sub">{it.sub}</span>
            </button>
          </li>
        ))}
      </ul>
      {items[index]?.type === 'ref' && (
        <div className="options">
          <input className="locator" placeholder="Page or chapter (optional), e.g. p. 12" value={locator} onChange={(e) => setLocator(e.target.value)} />
          <label className="check"><input type="checkbox" checked={inText} onChange={(e) => setInText(e.target.checked)} /> Name in the sentence, e.g. “Smith (2020) showed…”</label>
        </div>
      )}
      <div className="footer">
        {!requesting ? (
          <button type="button" className="link-button" onClick={() => setRequesting(true)}>Can’t find it? Ask the lead author to add it to the bibliography</button>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (request.trim()) onRequest(request.trim()); }}>
            <textarea autoFocus rows={2} placeholder="DOI, link, or the full reference" value={request} onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (request.trim()) onRequest(request.trim()); } }} />
            <div className="row">
              <button type="button" className="ghost small" onClick={() => setRequesting(false)}>Back</button>
              <button type="submit" className="small" disabled={!request.trim()}>Send request</button>
            </div>
            <p className="hint">This adds a note here for the lead, who adds the reference to the bibliography. You can cite it once it’s there.</p>
          </form>
        )}
      </div>
    </div>
  );
}
