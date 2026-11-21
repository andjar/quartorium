'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Repo } = require('../src/git');
const { Renderer, instrument, extractDiv } = require('../src/render');
const { splitQmd } = require('../src/qmd/blocks');
const { tmpdir, makeRemote } = require('./helpers');

const hasQuarto = spawnSync('quarto', ['--version']).status === 0;
const hasJupyter = hasQuarto && spawnSync('python3', ['-c', 'import jupyter_client, matplotlib']).status === 0;

const DOC = `---
title: Render test
jupyter: python3
---

Intro text with @fig-line.

\`\`\`{python}
#| label: fig-line
#| fig-cap: "A line"
import matplotlib.pyplot as plt
plt.plot([1, 2, 3], [3, 1, 2])
plt.show()
\`\`\`

| a | b |
|---|---|
| 1 | 2 |

: A table {#tbl-x}

::: {.callout-note}
Note body.
:::

Closing words.
`;

test('instrument wraps locked blocks only', () => {
  const { text } = instrument(DOC);
  assert.equal((text.match(/\.quartorium-block\}/g) || []).length, 3);
  assert.ok(text.includes('Intro text with @fig-line.'));
  assert.equal(extractDiv('<div id="a"><div>x</div><p>y</p></div><div>z</div>', 'a'), '<div>x</div><p>y</p>');
});

test('renders the document and cuts out each block', { skip: !hasJupyter && 'quarto + jupyter not available', timeout: 300000 }, async () => {
  const r = makeRemote({ 'paper.qmd': DOC });
  const repo = new Repo(path.join(tmpdir(), 'p.git'), { remoteUrl: r.remote });
  await repo.clone();
  const renderer = new Renderer(tmpdir());
  const ref = 'refs/remotes/origin/main';
  const key = await renderer.keyFor(repo, ref, 'paper.qmd', DOC);

  // Prose edits do not change the key; code edits do.
  assert.equal(await renderer.keyFor(repo, ref, 'paper.qmd', DOC.replace('Closing words.', 'Other words.')), key);
  assert.notEqual(await renderer.keyFor(repo, ref, 'paper.qmd', DOC.replace('[3, 1, 2]', '[1, 1, 1]')), key);

  const result = await renderer.ensure({ repo, ref, docPath: 'paper.qmd', text: DOC, key });
  assert.equal(result.status, 'ok', result.error);
  const blocks = splitQmd(DOC).blocks;
  const chunk = blocks.find((b) => b.kind === 'chunk');
  const table = blocks.find((b) => b.kind === 'table');
  const div = blocks.find((b) => b.kind === 'div');
  const img = result.outputs[chunk.key].match(/src="(\/api\/render\/[^"]+)"/);
  assert.ok(img, result.outputs[chunk.key]);
  assert.match(result.outputs[chunk.key], /Figure&nbsp;1|Figure 1/);
  assert.ok(!/cell-code|matplotlib/.test(result.outputs[chunk.key]), 'echoed code is stripped');
  const rel = decodeURIComponent(img[1].split(`/api/render/${key}/`)[1]);
  assert.ok(fs.existsSync(renderer.assetPath(key, rel)));
  assert.match(result.outputs[table.key], /<table/);
  assert.match(result.outputs[div.key], /callout/);
  assert.equal(renderer.status(key), 'ok');
});
