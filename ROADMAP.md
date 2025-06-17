### Quillarto: Iterative Development Roadmap

**Guiding Principle:** Each epic should result in a demonstrable new capability for the application. We prioritize the core user journey first: Author connects repo -> Collaborator edits -> Author reviews.

### Epic 1: Foundation & User Authentication

**Goal:** A user can log in with GitHub and see a list of their repositories. This validates the core user model and our connection to GitHub.

*   **Task 1.1 (Backend):** Install `express-session`, `passport`, `passport-github2`, and `sqlite3`.
*   **Task 1.2 (Backend):** Create the SQLite database connection module (`backend/src/db/sqlite.js`).
*   **Task 1.3 (Backend):** Define the `users` table schema and create a migration script to initialize the database.
*   **Task 1.4 (Backend):** Implement the Passport.js GitHub authentication strategy. This includes the `/auth/github` and `/auth/github/callback` routes. On successful login, create or update a user in the database.
*   **Task 1.5 (Backend):** Create a protected `/api/me` endpoint that returns the logged-in user's data from the session.
*   **Task 1.6 (Frontend):** Create a `LoginPage.jsx` with a "Login with GitHub" button that links to `/api/auth/github`.
*   **Task 1.7 (Frontend):** Create a `DashboardPage.jsx` that is shown after login. This page will call the `/api/me` endpoint to fetch user data and display it (e.g., "Welcome, [username]!").
*   **Task 1.8 (Frontend):** Implement basic routing (using `react-router-dom`) to handle logged-in vs. logged-out states.

**🏁 End of Epic 1 Result:** A user can visit the site, click "Login," be redirected to GitHub, authorize the app, and be redirected back to a dashboard showing their username.

### Epic 2: Repository & Document Browsing

**Goal:** A logged-in user can connect a GitHub repository to Quillarto and see a list of the `.qmd` files within it.

*   **Task 2.1 (Backend):** Define the `repositories` and `documents` table schemas in the database.
*   **Task 2.2 (Backend):** Create a protected `/api/repos` endpoint (POST) that takes a GitHub repo URL. This endpoint will:
    *   Use the GitHub API (with the user's token) to verify access.
    *   Save the repository info to the database, linked to the user.
*   **Task 2.3 (Backend):** Create a `/api/repos` endpoint (GET) to list all repositories the user has connected.
*   **Task 2.4 (Backend):** Create a `/api/repos/:repoId/qmd-files` endpoint that uses a Git client library (like `isomorphic-git` or by shelling out to `git`) to:
    *   Clone the repository to a temporary directory on the server (if not already cloned).
    *   Scan the filesystem for all files ending in `.qmd`.
    *   Return the list of file paths.
*   **Task 2.5 (Frontend):** On the `DashboardPage.jsx`, add a form to allow users to paste a GitHub repo URL.
*   **Task 2.6 (Frontend):** Display a list of connected repositories. Clicking a repository should fetch and display the list of its `.qmd` files.

**🏁 End of Epic 2 Result:** A user can add their project repository and see "paper1/manuscript.qmd" listed in the UI, ready to be edited.

### **Epic 3 Specification: The Read-Only Editor (Render-to-JSON-AST Architecture)**

**Goal:** Clicking a `.qmd` file opens a new page that displays a fully rendered, high-fidelity, read-only version of the document. This will be achieved by leveraging Quarto's native JSON Abstract Syntax Tree (AST) output for maximum fidelity, performance, and reliability.

**Core Principle:** We will instruct Quarto to run all code and output the entire document's structure as a single, machine-readable JSON file (a Pandoc AST). We will then transform this "perfect" representation into the ProseMirror JSON format required by our frontend editor. This eliminates all manual parsing of intermediate files and brittle ID-injection hacks.

#### 1. Backend Tasks

**Task 3.1: Create the Definitive Core Parser Module (`astParser.js`)**
This single new module will replace all previous parser/runner concepts.

*   **Sub-task 3.1.1: Quarto Execution:**
    *   Create a function `renderToAST(qmdFilepath, projectDir)`.
    *   It will execute a single, powerful command in the `projectDir`: `quarto render [qmdFilepath] --to json`.
    *   This command runs all code, generates all assets (like plots), and prints a massive JSON string to standard output.
    *   The function will capture this standard output, parse it using `JSON.parse()`, and return the resulting Pandoc AST object.

*   **Sub-task 3.1.2: AST Transformation:**
    *   Create the main function `pandocAST_to_proseMirrorJSON(pandocAST)`.
    *   This function's sole responsibility is to "walk" the Pandoc AST and convert its structure into the ProseMirror JSON format.
    *   It will contain a recursive transformer that handles different Pandoc node types:
        *   `Header` node -> ProseMirror `heading` node.
        *   `Para` node -> ProseMirror `paragraph` node.
        *   `BulletList` / `OrderedList` -> ProseMirror `bulletList` / `orderedList` nodes.
        *   Text nodes with marks (`Strong`, `Emph`) -> ProseMirror `text` nodes with `bold`/`italic` marks.
        *   **`CodeBlock` node:** This is the key. When a `CodeBlock` with Quarto attributes is found, the transformer will:
            a. Extract its attributes (chunk options like `{r, label='...'}`).
            b. Extract its source code.
            c. Look at the `outputs` property directly within the `CodeBlock` node in the AST. This property is added by Quarto and contains the rendered result (e.g., an `Image` node with a path to the plot, or a `Table` node).
            d. Convert the output into the required HTML for the `htmlOutput` attribute of our custom `quartoBlock`. For images, this will involve creating an `<img>` tag pointing to a new API endpoint that serves the static asset from the render cache.
            e. Create a single ProseMirror `quartoBlock` node containing all this information.

**Task 3.2: Create a Static Asset Server Endpoint**
*   When Quarto renders, it creates image files in a folder (e.g., `document_files/figure-html/`).
*   The Pandoc AST will contain relative paths to these images.
*   We need a new public API endpoint, e.g., `GET /api/assets/:repoId/:filepath`, that can securely serve these static image files to the frontend editor. The `pandocAST_to_proseMirrorJSON` function will rewrite image `src` attributes to point to this endpoint.

**Task 3.3: Update the Document View Endpoint (`docs.routes.js`)**
*   The `GET /api/docs/view` endpoint will be refactored to be much simpler.
*   It will call `renderToAST` to get the Pandoc JSON.
*   It will then call `pandocAST_to_proseMirrorJSON` to transform it.
*   It will return the resulting ProseMirror JSON to the frontend.

**Task 3.4: Install New Backend Dependencies**
*   No major new dependencies are needed for this approach. We are simplifying and removing dependencies like `remark-gfm` and `uuid`. We are simply using the built-in `child_process` and `JSON.parse`.

#### 2. Frontend Tasks (Unchanged)

This architecture is a pure backend improvement. The contract with the frontend remains the same.

*   **Task 3.5 (No Change):** The `EditorPage.jsx` component still expects a valid ProseMirror JSON object from the API.
*   **Task 3.6 (No Change):** The custom `QuartoBlock.js` and `QuartoBlockNodeView.jsx` components will render the `htmlOutput` provided by the backend, just as before.
*   **Task 3.7 (No Change):** The routing and linking from the dashboard to the editor page remain the same.

**🏁 End of Epic 3 Result:** A user can click on a `.qmd` file and see a fast, pixel-perfect, read-only preview of their paper. The architecture is now built on Quarto's most fundamental and stable output format, ensuring long-term reliability and performance. All future features are now built on rock-solid ground.

### Epic 4 Specification: The Collaborative Editing Workflow

**Goal:** To enable the full "Collaborator" experience. An Author can generate unique share links for a document. Anyone with a link can edit the document in a WYSIWYG editor, with their changes being saved automatically to a dedicated, isolated Git branch.

#### 1. User Stories

*   **As an Author,** I want to generate a unique share link for a specific `.qmd` file so I can send it to a collaborator.
*   **As an Author,** I want to create multiple, separate share links for the same document so I can get feedback from different people without their edits conflicting.
*   **As an Author,** I want to give each share link a friendly label (e.g., "Prof. Smith's Review") so I can remember who I sent it to.
*   **As a Collaborator,** I want to open a link and immediately start editing the text in a simple, Word-like interface.
*   **As a Collaborator,** I want my changes to be saved automatically so I don't have to worry about losing my work.
*   **As a Collaborator,** I want to be completely shielded from Git, branches, and code. I just want to edit the document.

#### 2. Database Schema Changes

We need to introduce a new table to manage the share links and potentially simplify the `documents` table.

**A. `documents` Table**
This table acts as a pointer to a specific file within a repository.

*   `id`: SERIAL PRIMARY KEY
*   `repo_id`: INT REFERENCES `repositories(id)`
*   `filepath`: VARCHAR(1024) (e.g., "paper1/manuscript.qmd")
*   `UNIQUE(repo_id, filepath)`: We should only have one entry per file.

**B. `share_links` Table (New)**
This is the core of the new model. Each row represents a unique collaborative session.

*   `id`: SERIAL PRIMARY KEY
*   `doc_id`: INT REFERENCES `documents(id)`
*   `share_token`: VARCHAR(255) UNIQUE NOT NULL (A long, unguessable random string)
*   `collab_branch_name`: VARCHAR(255) NOT NULL (e.g., "quillarto/collab-prof-smith-2023-10-28")
*   `collaborator_label`: VARCHAR(255) (A user-provided friendly name)
*   `created_at`: TIMESTAMP DEFAULT CURRENT_TIMESTAMP

#### 3. Backend API Endpoints

**A. `POST /api/docs/share` (New Endpoint)**
This endpoint creates a new shareable link and its corresponding branch.
*   **Request Body:** `{ "repoId": 123, "filepath": "paper1/manuscript.qmd", "label": "Prof. Smith's Review" }`
*   **Logic:**
    1.  Verify the authenticated user owns the `repoId`.
    2.  Find or create an entry in the `documents` table for this `repoId` and `filepath`.
    3.  Generate a unique, secure `share_token`.
    4.  Generate a descriptive `collab_branch_name` (e.g., `quillarto/review-[label]-[timestamp]`).
    5.  Use the Git client to create this new branch in the cloned repository, branching off the repository's main branch.
    6.  Insert a new record into the `share_links` table with the `doc_id`, `share_token`, `collab_branch_name`, and `label`.
    7.  **Response:** `201 Created` with the new share link details: `{ "shareUrl": "https://quillarto.app/collab/[share_token]", "label": "..." }`

**B. `GET /api/docs/:docId/shares` (New Endpoint)**
Fetches all existing share links for a given document.
*   **Logic:**
    1.  Verify user ownership.
    2.  Query the `share_links` table for all links associated with the `docId`.
    3.  **Response:** `200 OK` with an array of share link objects.

**C. `GET /api/collab/:shareToken` (Public Endpoint)**
This is what the collaborator's browser calls to load the document.
*   **Logic:**
    1.  Find the `share_links` record matching the `shareToken`. If not found, return `404`.
    2.  From the record, get the `collab_branch_name` and the document's `filepath`.
    3.  Use the Git client to ensure the `collab_branch_name` is checked out.
    4.  Read the `.qmd` file content from that branch.
    5.  Use the **`quarto.parser.js`** (from Epic 3) to convert the file content into ProseMirror JSON.
    6.  **Response:** `200 OK` with the ProseMirror JSON.

**D. `POST /api/collab/:shareToken` (Public Endpoint)**
This is called by the collaborator's editor to save changes.
*   **Request Body:** The full ProseMirror JSON object representing the document state.
*   **Logic:**
    1.  Find the `share_links` record matching the `shareToken`. If not found, return `404`.
    2.  Get the `collab_branch_name` and `filepath`.
    3.  Use the **`prosemirror.serializer.js`** (to be created) to convert the incoming JSON back into a `.qmd` string.
    4.  Use the Git client to:
        a. Check out the `collab_branch_name`.
        b. Write the new `.qmd` string to the correct `filepath`.
        c. Commit the change with a generic message (e.g., "Update from collaborator via Quillarto").
    5.  **Response:** `200 OK` with `{ "status": "saved" }`.

#### 4. Core Logic Modules (Backend)

*   **`prosemirror.serializer.js` (New Module):** This is the inverse of the parser from Epic 3. It must reliably take a ProseMirror JSON object and reconstruct the original `.qmd` file format, including YAML frontmatter and code chunk syntax (` ```{r} ... ``` `). This is a critical piece for "round-trip" integrity.

#### 5. Frontend Tasks

*   **Task 4.1: Sharing Modal:**
    *   On the `DashboardPage`, next to each `.qmd` file, add a "Share" button.
    *   Clicking it opens a modal window.
    *   The modal shows a list of existing share links (fetched from `GET /api/docs/:docId/shares`) and a form to create a new one.
    *   The "Create New Link" form has one field: "Label" (e.g., "Review from Prof. Smith").
    *   Submitting the form calls `POST /api/docs/share` and then refreshes the list of links.

*   **Task 4.2: Collaborator Editor Page (`CollabEditorPage.jsx`):**
    *   Create a new route `/collab/:shareToken` that maps to this page.
    *   This page is very similar to the `EditorPage` from Epic 3, but it's public.
    *   On load, it uses the `shareToken` from the URL to call `GET /api/collab/:shareToken`.
    *   It initializes the TipTap editor with the fetched ProseMirror JSON.
    *   Crucially, it sets the editor to be **`editable: true`**.

*   **Task 4.3: Auto-Save Mechanism:**
    *   In the `CollabEditorPage`, configure the TipTap editor to listen for the `update` event.
    *   Use a debouncing function (e.g., from `lodash.debounce` or a custom hook) to avoid spamming the server on every keystroke. A delay of 1-2 seconds is typical.
    *   The debounced function will take the latest editor state (as JSON), and `POST` it to `/api/collab/:shareToken`.
    *   Add a small UI indicator (e.g., "Saving..." -> "Saved") to give the collaborator confidence their work is being saved.

**🏁 End of Epic 4 Result:** The Author can generate multiple, isolated share links for a document. A collaborator can open a link, edit the text of the Quarto document in a clean WYSIWYG editor, and have their changes automatically saved to a specific Git branch in the Author's repository, ready for review in Epic 5.

### Epic 5: Reviewing & Merging

**Goal:** The author can see a visual representation of the collaborator's changes and merge them into the main branch.

*   **Task 5.1 (Backend):** Create a `/api/docs/:docId/diff` endpoint. It will fetch the content of the `.qmd` file from both the `main` and `collab` branches and use a library like `diff-match-patch` to generate a structured diff.
*   **Task 5.2 (Backend):** Create the `/api/docs/:docId/merge` endpoint that executes the `git merge` command to merge the collaboration branch into the main branch.
*   **Task 5.3 (Frontend):** Create a `ReviewPanel.jsx` component.
*   **Task 5.4 (Frontend):** In the Author's `EditorPage.jsx`, fetch the diff data and pass it to the `ReviewPanel`.
*   **Task 5.5 (Frontend):** Display the changes in a user-friendly way in the panel (e.g., list of insertions/deletions). Add a "Merge All Changes" button that calls the merge endpoint.
*   **Task 5.6 (Stretch Goal):** Instead of a simple panel, create a custom TipTap extension that visually highlights the diffs directly within the editor text (e.g., green for additions, red strikethrough for deletions).

**🏁 End of Epic 5 Result:** The entire core loop is complete. An author can manage the full lifecycle of feedback from a non-technical collaborator, all within the app.

### Future Epics (Post-V1)

*   **Epic 6: The Commenting System:** Implement the full commenting UI and backend logic.
*   **Epic 7: Granular Accept/Reject:** Move beyond "Merge All" to allowing authors to accept/reject individual changes.
*   **Epic 8: Polishing & UX:** Improve loading states, error handling, caching, and overall user experience.
*   **Epic 9: Production Hardening:** Re-introduce Docker for sandboxing `quarto render` calls for a secure, public-facing deployment.