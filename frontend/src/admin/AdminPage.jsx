import { useCallback, useEffect, useState } from 'react';
import { api, linkFor, timeAgo } from '../api.js';

function Login({ onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try { await api.post('/admin/login', { password }); onDone(); } catch (err) { setError(err.message); }
  };
  return (
    <div className="centered">
      <form className="card login" onSubmit={submit}>
        <h1>Quartorium</h1>
        <p className="muted">Review rounds for Quarto papers. Co-authors only need the link you send them — this page is for setting things up.</p>
        <input type="password" placeholder="Admin password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} />
        <button type="submit">Log in</button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

function CopyLink({ token, label = 'Copy link' }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(linkFor(token)); } catch { window.prompt('Copy this link:', linkFor(token)); }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return <button type="button" className="ghost small" onClick={copy}>{done ? 'Copied!' : label}</button>;
}

function NewProject({ onCreated }) {
  const [form, setForm] = useState({ name: '', remoteUrl: '', baseBranch: '', username: '', token: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api.post('/projects', form); setForm({ name: '', remoteUrl: '', baseBranch: '', username: '', token: '' }); onCreated(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form className="card form" onSubmit={submit}>
      <h2>Connect a repository</h2>
      <p className="hint">Any Git host works: Codeberg or your own Forgejo, GitLab, GitHub, or a repository on a server. Quartorium only pushes branches named <code>quartorium/…</code>; it never touches your main branch.</p>
      <label>Git URL<input required placeholder="https://codeberg.org/you/paper.git" value={form.remoteUrl} onChange={set('remoteUrl')} /></label>
      <div className="grid2">
        <label>Name<input placeholder="(from the URL)" value={form.name} onChange={set('name')} /></label>
        <label>Main branch<input placeholder="(the repository's default)" value={form.baseBranch} onChange={set('baseBranch')} /></label>
      </div>
      <details>
        <summary>Access token (for private repositories and pushing)</summary>
        <p className="hint">Create a token with read/write access to the repository in your Git host’s settings. For GitLab use the username <code>oauth2</code>; for Codeberg/Forgejo/Gitea use your account name; for GitHub any name works. SSH URLs use the server’s SSH key instead.</p>
        <div className="grid2">
          <label>Username<input value={form.username} onChange={set('username')} autoComplete="off" /></label>
          <label>Token<input type="password" value={form.token} onChange={set('token')} autoComplete="new-password" /></label>
        </div>
      </details>
      <button type="submit" disabled={busy}>{busy ? 'Cloning…' : 'Connect'}</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function NewRound({ project, onCreated }) {
  const [files, setFiles] = useState(null);
  const [form, setForm] = useState({ docPath: '', title: '', leadName: '', leadEmail: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.get(`/projects/${project.id}/files`).then((f) => { setFiles(f); setForm((x) => ({ ...x, docPath: f[0] || '' })); }).catch((e) => setError(e.message));
  }, [project.id]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { const r = await api.post(`/projects/${project.id}/rounds`, form); onCreated(r); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  if (!files) return <p className="muted">{error || 'Looking for .qmd files…'}</p>;
  if (!files.length) return <p className="muted">No .qmd files found on {project.base_branch}.</p>;
  return (
    <form className="form inline-form" onSubmit={submit}>
      <div className="grid2">
        <label>Document<select value={form.docPath} onChange={set('docPath')}>{files.map((f) => <option key={f}>{f}</option>)}</select></label>
        <label>Round title<input placeholder="(the paper's title)" value={form.title} onChange={set('title')} /></label>
        <label>Lead author’s name<input required value={form.leadName} onChange={set('leadName')} /></label>
        <label>Lead author’s e-mail<input type="email" placeholder="(optional, for Git history)" value={form.leadEmail} onChange={set('leadEmail')} /></label>
      </div>
      <button type="submit" disabled={busy}>{busy ? 'Starting…' : 'Start review round'}</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function RoundRow({ round }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  useEffect(() => { if (open && !detail) api.get(`/rounds/${round.id}`).then(setDetail); }, [open, detail, round.id]);
  return (
    <li className="round">
      <button type="button" className="link-button" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'} {round.title}</button>
      <span className="muted"> {round.doc_path} · <code>{round.branch}</code> · updated {timeAgo(round.updated_at)}</span>
      {open && detail && (
        <ul className="people">
          {detail.people.map((p) => (
            <li key={p.id}>
              <span className="name">{p.name}</span><span className="role">{p.role === 'lead' ? 'Lead' : 'Reviewer'}</span>
              <span className="muted">seen {timeAgo(p.lastSeen)}</span>
              <CopyLink token={p.token} />
              {p.role === 'lead' && <a className="button small" href={`/r/${p.token}`}>Open as lead</a>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function ProjectCard({ project, onChanged }) {
  const [starting, setStarting] = useState(false);
  const [created, setCreated] = useState(null);
  const remove = async () => {
    if (!window.confirm(`Remove ${project.name} from Quartorium? Branches already pushed stay in your repository.`)) return;
    await api.del(`/projects/${project.id}`);
    onChanged();
  };
  return (
    <section className="card project">
      <header>
        <div><h2>{project.name}</h2><span className="muted">{project.remote_url} · {project.base_branch}</span></div>
        <div className="row">
          <button type="button" onClick={() => { setStarting((s) => !s); setCreated(null); }}>{starting ? 'Cancel' : 'New review round'}</button>
          <button type="button" className="ghost small danger" onClick={remove}>Remove</button>
        </div>
      </header>
      {project.push_error && <p className="error">Last push failed: {project.push_error.slice(0, 300)}</p>}
      {starting && !created && <NewRound project={project} onCreated={(r) => { setCreated(r); setStarting(false); onChanged(); }} />}
      {created && (
        <div className="banner">
          Round started. Open it with your lead link, then invite co-authors from the <strong>People</strong> tab.
          <CopyLink token={created.leadToken} label="Copy lead link" />
          <a className="button small" href={`/r/${created.leadToken}`}>Open as lead</a>
        </div>
      )}
      {project.rounds.length > 0 ? <ul className="rounds">{project.rounds.map((r) => <RoundRow key={r.id} round={r} />)}</ul> : !starting && <p className="muted">No review rounds yet.</p>}
    </section>
  );
}

export default function AdminPage() {
  const [session, setSession] = useState(null);
  const [projects, setProjects] = useState([]);
  const refresh = useCallback(async () => {
    const s = await api.get('/admin/session');
    setSession(s);
    if (s.admin) setProjects(await api.get('/projects'));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  if (!session) return null;
  if (!session.admin) return <Login onDone={refresh} />;
  return (
    <div className="admin">
      <header className="topbar">
        <div className="title"><strong>Quartorium</strong><span className="muted">Projects and review rounds</span></div>
        <button type="button" className="ghost small" onClick={async () => { await api.post('/admin/logout'); refresh(); }}>Log out</button>
      </header>
      <div className="admin-body">
        {projects.map((p) => <ProjectCard key={p.id} project={p} onChanged={refresh} />)}
        <NewProject onCreated={refresh} />
      </div>
    </div>
  );
}
