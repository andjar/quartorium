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

const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

/**
 * Three-way merge of comment threads (by id), for merges between branches.
 * A thread added on either side is kept; one removed on one side (e.g. a
 * resolved thread cleaned up when a round finished) stays removed unless the
 * other side changed it; replies and agreements from both sides are combined.
 */
function mergeMeta(base, ours, theirs) {
  const map = (m) => new Map(((m && m.comments) || []).map((c) => [c.id, c]));
  const B = map(base), A = map(ours), T = map(theirs);
  const ids = [...A.keys(), ...[...T.keys()].filter((id) => !A.has(id))];
  const comments = [];
  for (const id of ids) {
    const b = B.get(id), a = A.get(id), t = T.get(id);
    if (!a || !t) {
      const only = a || t;
      if (!b || !same(only, b)) comments.push(only);
      continue;
    }
    if (same(a, t) || (b && same(t, b))) { comments.push(a); continue; }
    if (b && same(a, b)) { comments.push(t); continue; }
    const key = (m) => `${m.author}\u0000${m.created}\u0000${m.text}`;
    const thread = [...a.thread, ...t.thread.filter((m) => !a.thread.some((x) => key(x) === key(m)))];
    if (thread.every((m) => m.created)) thread.sort((x, y) => (x.created < y.created ? -1 : x.created > y.created ? 1 : 0));
    const resolved = b && a.resolved === b.resolved ? t.resolved : a.resolved;
    comments.push({ ...a, thread, resolved, agree: [...new Set([...a.agree, ...t.agree])] });
  }
  return { comments };
}

module.exports = { extractMeta, injectMeta, emptyMeta, normalizeComment, mergeMeta };
