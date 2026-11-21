'use strict';
// `npm run dev`: the backend (restarts on changes) and the frontend dev server
// together. Open http://localhost:5173. Ctrl-C stops both.
const { spawn } = require('child_process');

const win = process.platform === 'win32';
const procs = ['dev:backend', 'dev:frontend'].map((script) => spawn(win ? 'npm.cmd' : 'npm', ['run', script], { stdio: 'inherit', shell: win }));
const stop = () => { for (const p of procs) if (p.exitCode === null) p.kill(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { stop(); if (code) process.exitCode = code; });
