'use strict';
// Thin bridge to Pandoc (bundled with Quarto). Many prose blocks are converted
// in one call by wrapping each in a fenced div with a known id.

const { spawn, spawnSync } = require('child_process');
const config = require('../config');

const READER = 'markdown-auto_identifiers-implicit_header_references-smart';
const WRITER = 'markdown-auto_identifiers-smart';
const FENCE = '::::::::::::::::';
const ID = (i) => `qtmseg-${i}`;

let pandocCmd = null;
function resolvePandoc() {
  if (pandocCmd) return pandocCmd;
  if (config.pandoc) {
    pandocCmd = config.pandoc.split(' ');
  } else if (spawnSync(config.quarto, ['--version']).status === 0) {
    pandocCmd = [config.quarto, 'pandoc'];
  } else {
    pandocCmd = ['pandoc'];
  }
  return pandocCmd;
}

function run(args, input) {
  const [cmd, ...pre] = resolvePandoc();
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, [...pre, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`pandoc failed (${code}): ${Buffer.concat(err).toString('utf8')}`));
    });
    p.stdin.end(input, 'utf8');
  });
}

let apiVersion = null;

async function parseOne(source) {
  const json = JSON.parse(await run(['-f', READER, '-t', 'json'], source));
  apiVersion = json['pandoc-api-version'];
  return json.blocks;
}

/**
 * Parse several markdown snippets. Returns one array of Pandoc blocks per snippet.
 */
async function parseSegments(sources) {
  if (sources.length === 0) return [];
  const input = sources.map((s, i) => `${FENCE} {#${ID(i)}}\n${s}\n${FENCE}\n`).join('\n');
  const json = JSON.parse(await run(['-f', READER, '-t', 'json'], input));
  apiVersion = json['pandoc-api-version'];
  const blocks = json.blocks;
  const ok = blocks.length === sources.length && blocks.every((b, i) => b.t === 'Div' && b.c[0][0] === ID(i));
  if (ok) return blocks.map((b) => b.c[1]);
  // A snippet confused the wrapper (e.g. stray fence lines): fall back to one call each.
  return Promise.all(sources.map(parseOne));
}

async function ensureApiVersion() {
  if (!apiVersion) await parseOne('x');
  return apiVersion;
}

/**
 * Write several lists of Pandoc blocks back to markdown. Returns one string per list.
 */
async function writeSegments(blockLists) {
  if (blockLists.length === 0) return [];
  const doc = {
    'pandoc-api-version': await ensureApiVersion(),
    meta: {},
    blocks: blockLists.map((bl, i) => ({ t: 'Div', c: [[ID(i), [], []], bl] })),
  };
  const md = await run(['-f', 'json', '-t', WRITER, '--wrap=none'], JSON.stringify(doc));
  const lines = md.split('\n');
  const result = new Array(blockLists.length).fill('');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(:{3,}) \{#qtmseg-(\d+)\}\s*$/);
    if (!m) continue;
    const close = new RegExp(`^${m[1]}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    result[Number(m[2])] = lines.slice(i + 1, j).join('\n').trim();
    i = j;
  }
  return result;
}

module.exports = { parseSegments, writeSegments, run };
