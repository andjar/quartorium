# Quartorium ✒️

**Review rounds for Quarto papers. Send co-authors a link; keep the paper trail in Git.**

Quartorium lets the author of a Quarto (`.qmd`) paper share it with co-authors who don't use
Git, R or Python. They open a personal link and see the paper with its real figures, tables,
equations and references. They edit the text, comment and cite, all in the browser, in
parallel, and they see each other's suggestions. The lead author goes through the
suggestions like tracked changes, finishes the round and merges it into main. Every edit,
comment and decision is an ordinary Git commit, with the person who made it as the author,
on any Git host (Codeberg, Forgejo, GitLab, GitHub, or a plain server).

- **Nothing to install for co-authors**: a link, no account.
- **Parallel, not sequential**: everyone edits at once, and everyone sees everyone's
  suggestions and comments, so nobody makes the same change twice.
- **Your file stays yours**: untouched text keeps its exact bytes, code and YAML are locked,
  and a one-word edit is a one-line Git diff. Comments live invisibly at the end of the `.qmd`.
- **Plain Git, no forge API**: rounds and reviewers are branches; `git blame` shows who wrote
  each sentence.

## Documentation

The full documentation is a Quarto website in [`docs/`](docs/). Preview it with
`quarto preview docs`.

- [Getting started](docs/getting-started.qmd): install, connect a repository, configuration
- [User guide](docs/guide.qmd): for reviewers and lead authors
- [Git and the paper trail](docs/git.qmd): branches, what is committed when, merging into main
- [How .qmd files are changed](docs/qmd-files.qmd): blocks, Pandoc, citations, the comment block
- [Architecture](docs/architecture.qmd): components, data model, API
- [Security and privacy](docs/security.qmd)

## Quick start

Requires Node.js ≥ 22.13, Git ≥ 2.38 and [Quarto](https://quarto.org/docs/get-started/)
(plus whatever your papers need to run, unless you use Quarto's `freeze`).

```bash
git clone https://github.com/andjar/quartorium.git
cd quartorium
npm install
npm run build
QUARTORIUM_ADMIN_PASSWORD='choose-one' npm start
```

Open <http://localhost:8000>, log in, connect a repository and start a review round.

For development, run `npm run dev:backend` and `npm run dev:frontend` in two terminals and
open <http://localhost:5173>. Run the tests with `npm test`.

## License

GPL-3.0-only (as declared in `package.json`).
