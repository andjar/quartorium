# Workflow

This document outlines the intended workflow for using Quartorium, covering both the Author's and Collaborator's perspectives. It also discusses the collaboration model, its challenges, and potential alternative approaches.

## Core Workflow

Quartorium is designed to facilitate collaboration on Quarto documents, bridging the gap between technical authors familiar with Git and Quarto, and non-technical collaborators who prefer a WYSIWYG editing experience.

### Author Experience

The author is typically the owner of the Quarto project and initiates the collaboration process.

1.  **Login & Repository Setup:**
    *   The author logs into Quartorium using their GitHub account.
    *   They connect their existing GitHub repository containing the Quarto (`.qmd`) documents.

2.  **Document Management:**
    *   Authors can browse the `.qmd` files within their connected repository.
    *   They can open a document to view it. The initial view is a high-fidelity rendering of the Quarto document.
    *   When an author edits their own document, changes are periodically saved to a live staging area (`live_documents` table) to prevent data loss before being formally committed.

3.  **Initiating Collaboration:**
    *   For any given document, the author can generate unique shareable links to send to collaborators.
    *   Each share link can be given a label for easy identification (e.g., "Review by Prof. X").
    *   Each share link corresponds to a dedicated collaboration branch in the Git repository, ensuring changes are isolated.

4.  **Reviewing and Merging:**
    *   Authors can see a visual diff of the changes made by collaborators on their respective branches.
    *   They can review these changes and decide to merge them into the main document.
    *   The merge process integrates the collaborator's edits from the collaboration branch into the author's main branch.

5.  **Committing Final Changes:**
    *   After reviewing and merging collaborator feedback, or after making their own direct edits, the author formally commits the final, consolidated `.qmd` file (including any commentary) back to their GitHub repository. This updates the main version of the document.

### Collaborator Experience

The collaborator is typically someone who provides feedback or makes content changes, often without needing to understand Git or Quarto syntax.

1.  **Accessing the Document:**
    *   The collaborator receives a unique share link from the author.
    *   Opening this link in a web browser takes them directly to a WYSIWYG editor view of the document. No setup or login is required on their part.

2.  **Editing Content:**
    *   Collaborators can edit the prose content of the document in a manner similar to using Microsoft Word or Google Docs.
    *   Quarto code chunks and complex configurations are hidden and non-editable by collaborators, preserving the document's structure and reproducibility. They will see the rendered output of these chunks (like plots or tables).

3.  **Commenting:**
    *   Collaborators can select text and add inline comments.
    *   They can reply to existing comments, creating discussion threads.
    *   Comments are displayed in the margin and are associated with specific parts of the text.

4.  **Automatic Saving:**
    *   Changes made by the collaborator (both content edits and comments) are automatically saved to a dedicated collaboration branch in the author's Git repository. These changes are first staged in the `live_documents` table for immediate persistence and then committed to the branch. This ensures that their work is not lost.

## Sharing, Collaboration, and Integration Model

Quartorium employs a Git-centric model for collaboration, augmented by a live staging area and a robust parsing/serialization pipeline to handle Quarto's specific needs.

1.  **Git-Powered Version Control:**
    *   The foundational element is Git. Each document shared for collaboration resides in a Git repository.
    *   When an author shares a document with a collaborator, a new, dedicated **collaboration branch** is created in the repository. This branch is based on the current state of the document in the main branch.
    *   All changes made by the collaborator are committed to this specific branch. This isolates their work and allows the author to review it independently before merging.

2.  **Share Tokens for Access:**
    *   Access for collaborators is managed via unique, unguessable **share tokens**.
    *   When an author generates a share link, a unique token is created and associated with the specific document and the newly created collaboration branch.
    *   Collaborators do not need user accounts; possession of the token grants them access to edit the document via the WYSIWYG editor.

3.  **`live_documents` Table for Real-time Staging:**
    *   To provide a smoother editing experience and prevent data loss from premature closes or network issues, Quartorium uses an intermediary SQLite table called `live_documents`.
    *   As an author or collaborator edits a document, changes (in ProseMirror JSON format, along with comments) are frequently auto-saved to this table.
    *   This decouples the immediate user experience of "saving" from the potentially slower Git commit operations.
    *   The content in `live_documents` is then used as the source for the formal Git commit to the collaboration branch (for collaborators) or the main branch (for authors). After a successful Git commit, the corresponding entry in `live_documents` is cleared.

4.  **QMD <-> ProseMirror JSON Serialization:**
    *   **Parsing (QMD to ProseMirror):** When a document is opened for editing (either by an author or a collaborator), its `.qmd` file content is parsed. Quarto code chunks, YAML frontmatter, and prose are converted into a ProseMirror JSON structure. This JSON is what powers the Tiptap-based WYSIWYG editor. Rendered outputs of code chunks (like plots) are included.
    *   **Serialization (ProseMirror to QMD):** When changes are saved (committed to Git), the ProseMirror JSON (including any modifications to prose) is serialized back into valid `.qmd` format. This process ensures that code chunks, frontmatter, and the overall Quarto structure are preserved.
    *   **Comment Persistence:** Comments are a key part of the collaboration. They are stored directly within the `.qmd` file itself. This is achieved by:
        *   Embedding special HTML comment anchors (`<!-- quartorium-comment-anchor id="..." -->`) in the text to mark comment locations.
        *   Storing the actual comment threads (author, timestamp, text, status) in a JSON block within a larger HTML comment (`<!-- quartorium-metadata: ... -->`) at the end of the `.qmd` file.
        This makes the comments portable and version-controlled along with the document content. The parser and serializer are responsible for reading and writing this comment data.

## Challenges with the Current Model

While the Git-based branching model with live staging offers a robust way to manage collaborative edits, it comes with its own set of challenges:

1.  **Merge Conflicts:**
    *   If the author continues to edit the main branch significantly while a collaborator is working on a separate collaboration branch, merging can lead to conflicts.
    *   Quartorium provides a diff view, but resolving complex Git merge conflicts typically requires manual intervention by the author using standard Git tools outside the application. This can be a technical hurdle.

2.  **Scalability of Git Operations:**
    *   Each collaborator's session potentially involves creating a new branch and making several commits. With many documents, many collaborators, or very frequent auto-saves resulting in commits, this could lead to:
        *   A large number of branches in the repository, making management cumbersome.
        *   Performance degradation during Git operations (cloning, fetching, pushing) if the repository becomes too bloated with collaboration branches.
        *   Potential rate limiting or performance issues with the Git hosting provider (e.g., GitHub).

3.  **Real-time Co-editing Limitations:**
    *   The current model supports asynchronous collaboration. Collaborators work on isolated copies (branches), and their changes are reviewed and merged later.
    *   It does not support true real-time, simultaneous co-editing like Google Docs or Etherpad, where multiple users can see each other's cursors and edits live in the same document view. This can be a desired feature for highly interactive writing sessions.

4.  **Granularity of Change Tracking and Merging:**
    *   While the application provides a diff of the entire document, the merging process typically integrates all changes from a collaboration branch.
    *   The `ROADMAP.md` mentions "Granular Accept/Reject" as a future epic (Epic 8). Currently, selectively accepting or rejecting individual changes within a single collaboration session is not supported, which can be inflexible for authors.

5.  **Comment Persistence and Portability:**
    *   Embedding comments directly within the `.qmd` file using custom HTML comment syntax is an innovative solution for self-contained, version-controlled discussions.
    *   However, this custom format might be fragile:
        *   External Quarto tools or text editors not aware of this syntax could inadvertently break or remove the comment data if the file is edited outside Quartorium.
        *   Manual edits to the raw `.qmd` file could also corrupt the comment structure if care is not taken.

6.  **Security of `quarto render` (Production Context):**
    *   The `README.md` correctly notes that for the development setup, running `quarto render` directly on the server poses a security risk if untrusted `.qmd` files are processed, as Quarto documents can execute code.
    *   For a production deployment handling arbitrary user content, this process must be strictly sandboxed (e.g., using Docker containers, microVMs, or other isolation technologies) to prevent potential remote code execution. This adds infrastructural complexity.

7.  **Complexity of "Round-trip" Serialization:**
    *   Ensuring perfect fidelity when converting QMD to ProseMirror JSON and back (the "round-trip" problem) is inherently complex. Quarto has a rich feature set, and any discrepancies in the parsing or serialization logic can lead to data loss or formatting issues. This requires ongoing maintenance and thorough testing as both Quarto and the editor evolve.

## Alternative Approaches for Collaboration and Integration

To address some of the challenges and cater to different collaboration needs, several alternative or complementary approaches could be considered:

1.  **Operational Transformation (OT) or Conflict-free Replicated Data Types (CRDTs) for True Real-time Co-editing:**
    *   **Description:** Implement algorithms like OT or use CRDTs to enable multiple users to edit the same document simultaneously, with changes propagating to all participants in near real-time. This is the model used by Google Docs.
    *   **Pros:**
        *   Provides the most seamless and interactive experience for simultaneous co-editing.
        *   Eliminates the concept of explicit "merge" steps for concurrent edits.
    *   **Cons:**
        *   Extremely complex to design, implement, and debug, especially for rich text or structured documents like QMD which are not plain text.
        *   Requires significant backend infrastructure to manage real-time connections (e.g., WebSockets) and document state synchronization.
        *   Integrating with Quarto's code execution and rendering pipeline in real-time would be a major challenge.
        *   May be overkill if the primary need is asynchronous feedback rather than simultaneous co-authoring.

2.  **API-Driven Collaboration with an External Source of Truth:**
    *   **Description:** Instead of relying directly on Git branches for every collaborator's live edits, changes are sent to a central API. The backend maintains the canonical version of the document, possibly in a database or a specialized document store. Git syncs (commits to the user's repository) become more explicit "publish," "snapshot," or "version" actions initiated by the author.
    *   **Pros:**
        *   Can offer finer-grained control over change tracking and conflict resolution logic, potentially managed within the application.
        *   Reduces the proliferation of short-lived collaboration branches in the user's Git repository.
        *   May simplify the backend logic for handling many concurrent collaborators if Git is not the bottleneck.
        *   Better suited for auto-saving very frequent, small changes without creating excessive Git commit history.
    *   **Cons:**
        *   Moves away from the "Git as the single source of truth" model for in-progress collaborative work, which might be a drawback for users who want everything in Git.
        *   Requires a more complex backend to manage document states, versioning, and diffing outside of Git.
        *   Merging changes back into the author's main Git branch still needs careful handling.

3.  **Delta-Based Storage and Patching:**
    *   **Description:** Instead of storing the full document state for every change or auto-save from a collaborator, store only the differences (deltas or patches) relative to a base version. These patches are then applied when an author views the changes or merges them. Libraries like `diff-match-patch` can be used to create and apply patches.
    *   **Pros:**
        *   Potentially more storage-efficient for the `live_documents` table or collaboration branches if changes are incremental.
        *   Can simplify the generation of diffs for review.
    *   **Cons:**
        *   Reconstructing a specific version of the document by applying a long series of patches can become computationally intensive.
        *   Ensuring patch compatibility and handling conflicts between patches can be complex.
        *   The reliability of applying patches to structured data like ProseMirror JSON or QMD needs careful consideration.

4.  **Hybrid Approach: Enhancing the Current Git-Based Model:**
    *   **Description:** Maintain the current Git-branch-per-collaborator model but invest in mitigating its challenges directly.
        *   **In-App Merge Conflict Resolution:** Develop UI tools within Quartorium to help authors resolve common Git merge conflicts without resorting to the command line (e.g., a three-way merge view).
        *   **Granular Change Review (Block-Level):** Implement the "Granular Accept/Reject" feature (Epic 8) by tracking changes at a more granular level (e.g., per paragraph, list item, or document block). This would allow authors to selectively integrate parts of a collaborator's work.
        *   **Optimized Git Interactions:** Implement strategies like batching commits from the `live_documents` table, using shallower clones, or optimizing how branches are managed to reduce server load and repository bloat.
        *   **Comment Management Improvements:** Explore alternative comment storage or synchronization mechanisms if the embedded HTML approach proves too fragile (e.g., storing comments in a separate sidecar file that's linked to the QMD, or using a database for comments during active collaboration and only serializing them to QMD on final commit).
    *   **Pros:**
        *   Builds on the existing, understood foundation and user mental model.
        *   Likely less disruptive to implement than a complete architectural overhaul.
        *   Allows for incremental improvements to address specific pain points.
    *   **Cons:**
        *   May not fully address the desire for true real-time co-editing if that becomes a critical requirement.
        *   Some underlying limitations of Git for very high-frequency, fine-grained changes might persist.

5.  **Headless CMS Approach for Content Blocks:**
    *   **Description:** Treat the QMD document more like a template, and allow collaborators to edit specific "content blocks" (prose sections) through a simplified interface, similar to how a headless CMS works. These content blocks are stored and versioned, then injected back into the QMD structure during rendering/commit.
    *   **Pros:**
        *   Strong separation between content (editable by collaborators) and structure/code (managed by authors).
        *   Could simplify the collaborator UI even further.
    *   **Cons:**
        *   Significant departure from the current model of editing a representation of the whole document.
        *   More complex to map content blocks back to the correct locations in the QMD, especially if the structure changes.
        *   Inline commenting across block boundaries could be challenging.

The choice of approach depends heavily on the primary goals for collaboration (e.g., asynchronous review vs. live co-authoring), technical resources, and the desired user experience. The current hybrid Git-based model in Quartorium offers a strong foundation for asynchronous collaboration with clear versioning, and enhancing it (Option 4) seems like a pragmatic path forward.
