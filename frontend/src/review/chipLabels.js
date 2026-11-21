// Readable labels for citation and cross-reference chips: "Smith et al. 2020",
// "Figure 1". The bibliography comes with the page; the numbering comes from
// Quarto's render. Chips re-draw themselves when either arrives.

const XREF = /^(fig|tbl|eq|sec|lst|thm|lem|cor|prp|cnj|def|exm|exr|rem|sol)-/;
const KIND = { fig: 'Figure', tbl: 'Table', eq: 'Equation', sec: 'Section', lst: 'Listing', thm: 'Theorem', lem: 'Lemma', cor: 'Corollary', prp: 'Proposition', cnj: 'Conjecture', def: 'Definition', exm: 'Example', exr: 'Exercise', rem: 'Remark', sol: 'Solution' };

const state = { refs: new Map(), xrefs: {}, hasBibliography: false };
const listeners = new Set();

export const isXref = (id) => XREF.test(id);

export function setChipData({ entries, xrefs, hasBibliography }) {
  if (entries) state.refs = new Map(entries.map((e) => [e.id, e]));
  if (xrefs) state.xrefs = xrefs;
  if (hasBibliography !== undefined) state.hasBibliography = hasBibliography;
  listeners.forEach((fn) => fn());
}

export function onChipData(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const inlineText = (list) => (list || []).map((n) => (n.t === 'Str' ? n.c : n.t === 'Space' ? ' ' : '')).join('');

/** Name for a label before (or without) Quarto's numbering, e.g. "Figure mpg". */
export function xrefName(id) {
  if (state.xrefs[id]) return state.xrefs[id];
  const [prefix, ...rest] = id.split('-');
  return `${KIND[prefix] || prefix} ${rest.join('-')}`;
}

function inTextLabel(entry) {
  // "Smith et al. 2020" -> "Smith et al. (2020)"
  return entry.year && entry.label.endsWith(entry.year) ? `${entry.label.slice(0, -entry.year.length).trim()} (${entry.year})` : entry.label;
}

/** { text, title, kind: 'ref'|'citation', missing } for a Pandoc Cite node. */
export function citeLabel(ast) {
  const cites = ast?.c?.[0] || [];
  const titles = [];
  let missing = false;
  const parts = cites.map((c) => {
    const id = c.citationId;
    const prefix = inlineText(c.citationPrefix);
    const suffix = inlineText(c.citationSuffix);
    let base;
    if (isXref(id)) {
      base = xrefName(id);
      titles.push(`Cross-reference to ${id}`);
    } else {
      const e = state.refs.get(id);
      if (!e) {
        missing = state.hasBibliography;
        base = '@' + id;
        titles.push(state.hasBibliography ? `@${id} is not in the bibliography` : `@${id}`);
      } else {
        const mode = c.citationMode?.t;
        base = mode === 'AuthorInText' ? inTextLabel(e) : mode === 'SuppressAuthor' ? e.year || e.label : e.label;
        titles.push(e.full);
      }
    }
    return [prefix, base].filter(Boolean).join(' ') + suffix;
  });
  return { text: parts.join('; '), title: titles.join('\n'), kind: cites.every((c) => isXref(c.citationId)) ? 'ref' : 'citation', missing };
}

/** Attributes for a new citation chip. */
export function citationNode({ id, mode = 'NormalCitation', locator = '' }) {
  const loc = locator.trim();
  const suffix = loc ? [{ t: 'Str', c: ',' }, { t: 'Space' }, ...loc.split(/\s+/).flatMap((w, i) => (i ? [{ t: 'Space' }, { t: 'Str', c: w }] : [{ t: 'Str', c: w }]))] : [];
  const ast = {
    t: 'Cite',
    c: [[{ citationId: id, citationPrefix: [], citationSuffix: suffix, citationMode: { t: mode }, citationNoteNum: 0, citationHash: 0 }], [{ t: 'Str', c: '@' + id }]],
  };
  return { type: 'opaque', attrs: { kind: 'Cite', label: mode === 'AuthorInText' ? '@' + id : `[@${id}]`, ast } };
}
