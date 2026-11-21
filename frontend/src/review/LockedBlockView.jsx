import { useContext, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import katex from 'katex';
import { RenderContext } from './renderContext.js';

const KIND_LABEL = {
  chunk: 'Code', code: 'Code block', raw: 'Raw block', div: 'Block', comment: 'Hidden note',
  math: 'Equation', shortcode: 'Shortcode', table: 'Table', def: 'Footnote / link definition',
  html: 'HTML', other: 'Block',
};

function renderMath(root) {
  root.querySelectorAll('span.math').forEach((el) => {
    if (el.dataset.katex) return;
    const display = el.classList.contains('display');
    const tex = el.textContent.replace(/^\\[([]|\\[)\]]$/g, '');
    try { katex.render(tex, el, { displayMode: display, throwOnError: false }); el.dataset.katex = '1'; } catch { /* leave as is */ }
  });
}

function TitleBlock({ meta }) {
  if (!meta?.title) return <div className="locked-meta">Document settings</div>;
  return (
    <header className="title-block">
      <h1>{meta.title}</h1>
      {meta.subtitle && <p className="subtitle">{meta.subtitle}</p>}
      {meta.authors?.length > 0 && <p className="authors">{meta.authors.join(', ')}</p>}
      {meta.date && <p className="date">{meta.date}</p>}
    </header>
  );
}

function Fallback({ attrs, status }) {
  if (attrs.kind === 'math') {
    const tex = attrs.source.replace(/^\s*\$\$/, '').replace(/\$\$\s*(\{[^}]*\})?\s*$/, '');
    return <div className="math-fallback" ref={(el) => { if (el) try { katex.render(tex, el, { displayMode: true, throwOnError: false }); } catch { el.textContent = attrs.source; } }} />;
  }
  if (attrs.kind === 'chunk') {
    return (
      <div className="output-placeholder">
        {status === 'rendering' ? 'Running the code to show its output…' : status === 'error' ? 'The output of this code could not be rendered.' : 'Output not rendered yet.'}
      </div>
    );
  }
  if (attrs.kind === 'comment') return <pre className="source muted">{attrs.source}</pre>;
  return <pre className="source">{attrs.source}</pre>;
}

export default function LockedBlockView({ node, selected }) {
  const { attrs } = node;
  const { outputs, status } = useContext(RenderContext);
  const [showSource, setShowSource] = useState(false);
  const outRef = useRef(null);
  const html = outputs?.[attrs.key];

  useEffect(() => { if (outRef.current) renderMath(outRef.current); }, [html]);

  if (attrs.kind === 'yaml') {
    return <NodeViewWrapper className={`locked locked-yaml ${selected ? 'selected' : ''}`} contentEditable={false}><TitleBlock meta={attrs.meta} /></NodeViewWrapper>;
  }
  if (attrs.kind === 'comment' && !showSource) {
    return (
      <NodeViewWrapper className="locked locked-hidden" contentEditable={false}>
        <button type="button" className="link-button" onClick={() => setShowSource(true)}>Hidden note for the author</button>
      </NodeViewWrapper>
    );
  }

  const label = [KIND_LABEL[attrs.kind] || 'Block', attrs.lang, attrs.label].filter(Boolean).join(' · ');
  return (
    <NodeViewWrapper className={`locked locked-${attrs.kind} ${selected ? 'selected' : ''}`} contentEditable={false} data-key={attrs.key}>
      {html != null && html !== '' ? <div className="output" ref={outRef} dangerouslySetInnerHTML={{ __html: html }} /> : <Fallback attrs={attrs} status={status} />}
      <div className="locked-footer">
        <span title="This part is managed by the author and can't be edited here.">🔒 {label}</span>
        {attrs.kind !== 'comment' && (
          <button type="button" className="link-button" onClick={() => setShowSource((s) => !s)}>{showSource ? 'Hide source' : 'Show source'}</button>
        )}
      </div>
      {showSource && <pre className="source">{attrs.source}</pre>}
    </NodeViewWrapper>
  );
}
