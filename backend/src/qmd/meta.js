'use strict';
// Comment threads live at the end of the .qmd in an HTML comment:
//
//   <!-- quartorium
//   { "comments": [ ... ] }
//   -->
//
// HTML comments are ignored by every Quarto output format (HTML, PDF, Word),
// so the threads travel with the file through Git without ever being rendered.
// Comments are anchored by quoting the commented text (plus a little context),
// so the prose itself stays free of markers.

const NEW_RE = /\n?<!--[ \t]*quartorium[ \t]*\n([\s\S]*?)\n?-->\s*$/;
const LEGACY_RE = /\n?<!-- Comments Appendix -->\s*<div id="quartorium-comments" style="display:none;">\s*```json\s*([\s\S]*?)\s*```\s*<\/div>\s*/;
const LEGACY_SPAN_RE = /\[([^\]]*)\]\{\.comment ref="([^"]+)"\}/g;

function emptyMeta() {
  return { comments: [] };
}

function normalizeComment(c) {
  return {
    id: String(c.id),
    ...(c.type === 'reference' ? { type: 'reference' } : {}),
    anchor: c.anchor || { quote: '', prefix: '', suffix: '' },
    author: c.author || 'Unknown',
    created: c.created || c.timestamp || new Date(0).toISOString(),
    resolved: Boolean(c.resolved || c.status === 'resolved'),
    thread: (c.thread || []).map((t) => ({ author: t.author || 'Unknown', created: t.created || t.timestamp || null, text: String(t.text || '') })),
    agree: Array.isArray(c.agree) ? c.agree : [],
  };
}

/** Remove the metadata block from the text. Returns { body, meta } (meta is null when absent). */
function extractMeta(text) {
  const m = text.match(NEW_RE);
  if (m) {
    let data = null;
    try { data = JSON.parse(m[1]); } catch { data = null; }
    if (data) {
      const body = text.slice(0, m.index).replace(/\s*$/, '\n');
      return { body, meta: { ...data, comments: (data.comments || []).map(normalizeComment) } };
    }
  }
  const lm = text.match(LEGACY_RE);
  if (lm) {
    // Migrate the format used by earlier Quartorium versions: a hidden div with
    // a JSON code block, plus [text]{.comment ref="id"} spans in the prose.
    let legacy = [];
    try { legacy = JSON.parse(lm[1]).comments || []; } catch { legacy = []; }
    let body = text.slice(0, lm.index) + text.slice(lm.index + lm[0].length);
    const quotes = {};
    body = body.replace(LEGACY_SPAN_RE, (_, inner, id) => { quotes[id] = inner; return inner; });
    body = body.replace(/\s*$/, '\n');
    const comments = legacy.map((c) => normalizeComment({ ...c, anchor: { quote: quotes[c.id] || '', prefix: '', suffix: '' } }));
    return { body, meta: { comments } };
  }
  return { body: text, meta: null };
}

function encodeJson(data) {
  // Never let the payload close (or open) the surrounding HTML comment.
  return JSON.stringify(data, null, 2).replace(/--/g, '-\\u002d').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/** Append the metadata block (or nothing, when there is nothing to store). */
function injectMeta(body, meta) {
  if (!meta || !meta.comments || meta.comments.length === 0) return body;
  return body.replace(/\s*$/, '\n') + '\n<!-- quartorium\n' + encodeJson({ comments: meta.comments }) + '\n-->\n';
}

module.exports = { extractMeta, injectMeta, emptyMeta, normalizeComment };
