# Quartorium ✒️

**Review rounds for Quarto papers. Send co-authors a link; keep the paper trail in Git.**

Quartorium lets the author of a Quarto (`.qmd`) paper share it with co-authors who
don't use Git, R or Python. They open a link, see the paper with its real figures and
tables, edit the text and comment, all in the browser. Every edit, comment and decision is
committed to Git, on any Git host.

See the (older) demo on YouTube:

[![Demo video](https://img.youtube.com/vi/yBLlVgVVQiE/0.jpg)](https://www.youtube.com/watch?v=yBLlVgVVQiE)

## How a review round works

1. **You keep writing as usual** in RStudio, VS Code or any editor, and push to your repository.
2. **Start a review round** on a `.qmd` (admin page). Quartorium creates the branch
   `quartorium/<paper>-<date>` and gives you a *lead* link.
3. **Invite co-authors** from the *People* tab. Each person gets a private link.
4. **Everyone works in parallel.** Reviewers edit the text directly; their edits become
   *suggestions*, shown paragraph by paragraph as word-level differences. **Everyone sees
   everyone's suggestions and comments**, so people can build on each other instead of
   repeating work, and +1 a comment instead of writing it again.
5. **The lead decides.** Accept or reject each suggestion (like Word's track changes), reply
   to and resolve comments, or edit directly. If two people changed the same paragraph, the
   second suggestion is marked *outdated* instead of silently overwriting the first.
6. **Merge the round** into your main branch with whatever you like: a pull/merge request on
   Codeberg, Forgejo, GitLab or GitHub, or `git merge`. The *Update from main* button brings
   commits you pushed meanwhile into the running round.

### The paper trail

- `quartorium/<round>`: the round's version of the paper. Every comment, accepted change
  and rejection is a commit, with the person who made it as the Git author.
- `quartorium/<round>--<name>-<id>`: one branch per reviewer with everything they wrote.
- Open comment threads are stored at the end of the `.qmd` inside an HTML comment
  (`<!-- quartorium ... -->`). Quarto never renders HTML comments, so threads don't show up
  in HTML, PDF or Word output.

Quartorium only ever pushes `quartorium/*` branches. It never writes to your main branch.

## What is (and isn't) editable in the browser

| Editable | Shown, but locked |
|---|---|
| Paragraphs, headings, lists, block quotes | Code chunks (their output is shown) |
| Bold, italic, underline, strikethrough, super/subscript, links | YAML header (shown as a title block) |
| Comments on any text | Tables, display equations, callouts and other `:::` blocks |
| | Citations, cross-references, inline math and code, shortcodes, footnotes (shown as chips) |

**Untouched text keeps its exact bytes.** Opening and saving a paper without edits gives an
identical file. When a paragraph is edited, only that paragraph is rewritten, and its line
breaks are kept where the words around them didn't change, so the Git diff of a one-word
edit is one line. Locked parts are restored from the server's copy, so nobody can change or
add code through the browser.

## Requirements

- **Node.js 22.13 or newer** (uses the built-in SQLite driver; no native modules)
- **Git 2.38 or newer**
- **[Quarto](https://quarto.org/docs/get-started/)**, plus whatever your papers need to run
  (R/knitr, Python/Jupyter, packages). If your project uses
  [`freeze`](https://quarto.org/docs/projects/code-execution.html#freeze) and commits the
  `_freeze` folder, the server doesn't need R or Python at all.

## Running it

```bash
git clone https://github.com/andjar/quartorium.git
cd quartorium
npm install
npm run build                       # builds the browser app into frontend/dist
QUARTORIUM_ADMIN_PASSWORD='choose-one' npm start
```

Open <http://localhost:8000>, log in with the admin password, and connect a repository.

For development, run `npm run dev:backend` and `npm run dev:frontend` in two terminals,
then open <http://localhost:5173>.

### Connecting a repository

Any Git URL works: `https://codeberg.org/you/paper.git`, a self-hosted Forgejo/Gitea, a
university GitLab, GitHub, an `ssh://` URL, or a path on the server. Private repositories,
and pushing, need an access token with read/write access to the repository:

| Host | Username | Token |
|---|---|---|
| Codeberg / Forgejo / Gitea | your account name | Settings → Applications → access token |
| GitLab | `oauth2` | personal or project access token (`write_repository`) |
| GitHub | anything | fine-grained token with *Contents: read & write* |

SSH URLs use the server's SSH key instead (`GIT_SSH_COMMAND` is honoured).

### Configuration

| Variable | Default | |
|---|---|---|
| `QUARTORIUM_ADMIN_PASSWORD` | *(unset: admin pages disabled)* | Password for setting up projects and rounds |
| `PORT` | `8000` | |
| `QUARTORIUM_DATA` | `backend/data` | Database, bare clones, render cache |
| `QUARTORIUM_QUARTO` | `quarto` | Path to the Quarto binary |
| `QUARTORIUM_PANDOC` | `quarto pandoc` | Pandoc command, if you want a different one |
| `QUARTORIUM_COMMIT_IDLE` | `60` | Seconds of inactivity before a draft is committed |
| `QUARTORIUM_PUSH` | `1` | Set to `0` to never push (for trying things out) |
| `QUARTORIUM_RENDER_TIMEOUT` | `900` | Seconds before a render is stopped |
| `QUARTORIUM_COMMITTER_NAME` / `_EMAIL` | `Quartorium` | Committer identity (authors are the people) |
| `QUARTORIUM_SECRET` | *(generated in the data folder)* | Signs the admin session cookie |

## Security notes

- **Links are keys.** Anyone with a link can take part as that person. Remove a person from
  the *People* tab to revoke their link.
- **Rendering runs the paper's code on the server**, the same as running `quarto render`
  yourself. Only the author's code runs: collaborators can't change or add code blocks,
  inline code or shortcodes. Still, only connect repositories you trust, and consider
  `freeze` (above) or running Quartorium in a container.
- Access tokens are stored in the database in the data folder. Protect that folder, and
  put the server behind HTTPS (e.g. a reverse proxy) when it's reachable from the internet.

## How it works (for contributors)

```
backend/src/
  qmd/blocks.js     split a .qmd into blocks without losing a byte; classify locked blocks
  qmd/protect.js    wrap Quarto-specific inline syntax so Pandoc keeps it verbatim
  qmd/pandoc.js     batch Markdown <-> Pandoc AST conversion (one Pandoc call per save)
  qmd/pm.js         Pandoc AST <-> ProseMirror JSON (the editor's document)
  qmd/document.js   parse / serialize; reuse original bytes for unchanged blocks
  qmd/reflow.js     keep the author's line breaks in edited paragraphs
  qmd/meta.js       the invisible comment block
  review.js         block-level diff, three-way merge, suggestions
  rounds.js         review rounds: links, copies, accept/reject, comments, commits
  git.js            bare clones, plumbing commits without a working directory, push, merge-tree
  render.js         one `quarto render` per code/data version; outputs cut out per block
  api.js, auth.js, db.js, server.js
frontend/src/
  admin/            projects and rounds
  review/           the editor (TipTap), comments, changes, people, history
```

Run the tests with `npm test`. The render test runs only when Quarto and Jupyter are installed.

Known limits: there are no live cursors (others' activity appears within about 10 seconds),
locked blocks such as callouts and tables can't be edited in the browser, and interactive
widgets are shown as static output.

## License

GPL-3.0-only (as declared in `package.json`). The repository has no `LICENSE` file yet; adding the GPL-3.0 text as `LICENSE` would make this explicit.
