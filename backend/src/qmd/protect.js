'use strict';
// Before Pandoc sees a prose block, Quarto-specific or context-dependent inline
// syntax is wrapped as raw markdown (`...`{=markdown}). Pandoc then hands it to
// the editor as an untouchable chip and writes it back byte for byte.
//
// Protected: shortcodes {{< ... >}}, inline notes ^[...], footnote references
// [^id], reference-style links [text][ref], and labelled display math
// $$...$$ {#eq-...}. Without this, an edited paragraph would come back with
// escaped or broken syntax (e.g. {{\< meta \>}}).

const normLabel = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();

function rawMarkdown(s) {
  const longest = Math.max(0, ...(s.match(/`+/g) || []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  const pad = /^`|`$/.test(s) ? ' ' : '';
  return `${fence}${pad}${s}${pad}${fence}{=markdown}`;
}

function balancedBracketEnd(src, open) {
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return j; }
  }
  return -1;
}

/** Collect reference-link labels defined in `[label]: url` blocks. */
function collectDefLabels(defSources) {
  const labels = new Set();
  for (const src of defSources) {
    for (const line of src.split('\n')) {
      const m = line.match(/^ {0,3}\[([^\]^][^\]]*)\]:/);
      if (m) labels.add(normLabel(m[1]));
    }
  }
  return labels;
}

function protect(src, defLabels = new Set()) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const rest = src.slice(i);
    if (ch === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
    if (ch === '`') {
      // Inline code: copy verbatim up to the matching backtick run.
      const run = rest.match(/^`+/)[0];
      const re = new RegExp(`(?<!\`)${run}(?!\`)`, 'g');
      re.lastIndex = i + run.length;
      const m = re.exec(src);
      const end = m ? m.index + run.length : i + run.length;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    let m;
    if ((m = rest.match(/^\{\{\{?<[\s\S]*?>\}?\}\}/))) {
      out += rawMarkdown(m[0]); i += m[0].length; continue;
    }
    if (rest.startsWith('^[')) {
      const end = balancedBracketEnd(src, i + 1);
      if (end !== -1) { out += rawMarkdown(src.slice(i, end + 1)); i = end + 1; continue; }
    }
    if ((m = rest.match(/^\[\^[^\]\s]+\]/))) {
      out += rawMarkdown(m[0]); i += m[0].length; continue;
    }
    if ((m = rest.match(/^\$\$[\s\S]+?\$\$[ \t]*\{#[^}\n]*\}/))) {
      out += rawMarkdown(m[0]); i += m[0].length; continue;
    }
    if (defLabels.size && (ch === '[' || rest.startsWith('!['))) {
      const open = ch === '!' ? i + 1 : i;
      const end = balancedBracketEnd(src, open);
      if (end !== -1) {
        const text = src.slice(open + 1, end);
        const after = src.slice(end + 1);
        const full = after.match(/^\[([^\]]*)\]/);
        if (full && defLabels.has(normLabel(full[1] || text))) {
          const len = end + 1 + full[0].length - i;
          out += rawMarkdown(src.slice(i, i + len)); i += len; continue;
        }
        if (!/^[([{:]/.test(after) && defLabels.has(normLabel(text))) {
          out += rawMarkdown(src.slice(i, end + 1)); i = end + 1; continue;
        }
      }
    }
    out += ch;
    i++;
  }
  return out;
}

module.exports = { protect, collectDefLabels, rawMarkdown };
