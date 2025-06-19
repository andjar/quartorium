# Manual End-to-End (E2E) Testing Plan for Commenting Feature

This document outlines the manual E2E testing steps for the round-trip commenting feature.

**Prerequisites:**
*   Backend and frontend servers are running.
*   A user is available for collaboration/sharing (or tests are adapted for single-user if auth is not fully in place).
*   A sample `.qmd` document exists in a repository that can be accessed via the application.
*   Developer console in the browser is open to monitor network requests and potential errors.

---

**Test 1: Open `.qmd` with Existing Comments**

*   **Objective:** Verify that comments already present in a `.qmd` file (in the appendix) are correctly parsed and displayed when the document is loaded.
*   **Steps:**
    1.  Manually prepare a `.qmd` file:
        *   Add some Markdown content.
        *   Add a valid comments appendix at the end, for example:
            ```qmd
            Some text [highlighted with c1]{.comment ref="c1"} and other text.

            <!-- Comments Appendix -->
            <div id="quartorium-comments" style="display:none;">
            \`\`\`json
            {
              "comments": [
                {
                  "id": "c1",
                  "author": "user-initial",
                  "timestamp": "2023-10-26T10:00:00Z",
                  "status": "open",
                  "thread": [{"text": "This is the first comment from file.", "author": "user-initial", "timestamp": "2023-10-26T10:00:00Z"}]
                }
              ]
            }
            \`\`\`
            </div>
            ```
    2.  Commit this file to a git repository accessible by the application.
    3.  Open this document in the Quartorium editor (e.g., via `/api/docs/view` or by navigating through the UI if available, or using a share link that points to this document).
*   **Expected Outcome:**
    *   The document content ("Some text highlighted with c1 and other text.") loads correctly in the Tiptap editor.
    *   The text "highlighted with c1" should be visually marked (e.g., with a span `data-comment-id="c1"`).
    *   The Comment Sidebar should display one comment:
        *   Author: "user-initial"
        *   Timestamp: "2023-10-26T10:00:00Z" (or localized equivalent)
        *   Status: "open"
        *   Thread message: "This is the first comment from file."
    *   No errors in the browser console related to comment parsing.
    *   The initial API response (e.g., to `/api/docs/view` or `/api/collab/:shareToken`) should contain both `prosemirrorJson` and the parsed `comments` array.

---

**Test 2: Add a New Comment**

*   **Objective:** Verify that a user can add a new comment to selected text.
*   **Steps:**
    1.  Open any document (can be the one from Test 1, or a new one without existing comments).
    2.  In the Tiptap editor, select a portion of text (e.g., "some important text").
    3.  Click the "Add Comment" button.
    4.  When prompted, enter a comment (e.g., "This needs review").
*   **Expected Outcome:**
    *   The selected text ("some important text") in the editor should now be visually marked as having a comment (e.g., highlighted or underlined). Inspecting the DOM should show a `<span>` with a `data-comment-id` attribute around this text.
    *   A new comment appears in the Comment Sidebar:
        *   It has a unique generated ID (e.g., "c-timestamp").
        *   Author should be the `currentUser` placeholder (e.g., "Current User" or a generated ID).
        *   Timestamp should be the current time.
        *   Status should be "open".
        *   The thread should contain one message: "This needs review".
    *   The new comment should become the `activeCommentId`, and its corresponding text in the editor should be highlighted with the `.comment-mark-active` class.
    *   The `comments` state in the React DevTools for `CollabEditorPage` should show the new comment object.

---

**Test 3: Interact with Comments (Highlighting, Replying, Resolving)**

*   **Objective:** Verify functionality of selecting, replying to, and resolving/reopening comments.
*   **Steps:**
    1.  Ensure there are at least two comments visible (either loaded from file or added manually as in Test 2). Let's call them Comment A and Comment B.
    2.  **Highlighting:**
        *   Click on Comment A in the Comment Sidebar.
        *   Observe the editor content.
        *   Click on Comment B in the Comment Sidebar.
        *   Observe the editor content.
    3.  **Replying:**
        *   For Comment A, click the "Reply" button in the sidebar.
        *   An input field should appear. Type a reply (e.g., "Good point!").
        *   Click "Add Reply".
    4.  **Resolving:**
        *   For Comment A (which now has two messages in its thread), click the "Resolve" button.
    5.  **Reopening:**
        *   For Comment A, click the "Reopen" button.
*   **Expected Outcome:**
    *   **Highlighting:**
        *   When Comment A is clicked, the text in the editor corresponding to Comment A should get the `.comment-mark-active` style (e.g., yellow background). Any other active comment highlight should be removed.
        *   When Comment B is clicked, its corresponding text should get the active highlight, and Comment A's text should lose it.
    *   **Replying:**
        *   The reply "Good point!" should appear as a new message in Comment A's thread in the sidebar, below the initial message. It should show the current user as author and current timestamp.
        *   The reply input field for Comment A should clear and hide.
        *   The `comments` state in React DevTools should reflect this new message in Comment A's thread.
    *   **Resolving:**
        *   Comment A's status should change to "resolved" in the sidebar.
        *   The "Resolve" button should change to "Reopen".
        *   The visual appearance of Comment A in the sidebar might change (e.g., dimmed, styled as per `comment-status-resolved` CSS).
        *   The `comments` state for Comment A should show `status: "resolved"`.
    *   **Reopening:**
        *   Comment A's status should change back to "open".
        *   The "Reopen" button should change back to "Resolve".
        *   The `comments` state for Comment A should show `status: "open"`.

---

**Test 4: Deletion of Commented Text**

*   **Objective:** Verify that if text associated with a comment is deleted from the editor, the comment is removed from the sidebar and state.
*   **Steps:**
    1.  Ensure there's at least one comment (Comment C) on a specific piece of text.
    2.  Make Comment C the active comment by clicking it in the sidebar. Its text should be highlighted.
    3.  In the Tiptap editor, select the text that Comment C is attached to.
    4.  Delete the selected text (e.g., using backspace or delete key).
*   **Expected Outcome:**
    *   Comment C should disappear from the Comment Sidebar.
    *   The `comments` state in React DevTools should no longer contain Comment C.
    *   Since Comment C was the `activeCommentId`, the `activeCommentId` state should become `null`.
    *   No errors in the console.

---

**Test 5: Commit Changes (Serialization and Save to Git)**

*   **Objective:** Verify that comments are correctly saved to the `live_documents` table (for live save) and then serialized into the QMD file upon final commit, including the appendix.
*   **Steps:**
    1.  Open a document. Add a new comment (Comment D) and reply to an existing comment (e.g., Comment A from Test 1 or Test 3). Resolve another comment (Comment B).
    2.  **Live Save Verification (Intermediate):**
        *   Wait for the auto-save/live save feature to trigger (usually after a short debounce period following an editor update or comment addition/modification).
        *   If possible, inspect the `live_documents` table in the SQLite database for the current `shareToken`.
    3.  **Final Commit:** Click the "Commit to Collaboration Branch" (or similar) button.
    4.  After the commit is successful, access the repository directly (e.g., on the file system or via a Git client if the test setup allows).
    5.  Inspect the committed `.qmd` file.
*   **Expected Outcome:**
    *   **Live Save:**
        *   The `live_documents` table row for the `shareToken` should have a `comments_json` column.
        *   The `comments_json` column should contain a JSON string representing all current comments (Comment A with its new reply, resolved Comment B, new Comment D), including their full structure (authors, timestamps, threads, status).
        *   The `prosemirror_json` should also be updated.
    *   **Final Commit (QMD File Content):**
        *   The committed `.qmd` file should contain:
            *   The main document content, with comment marks correctly formatted (e.g., `[text for D]{.comment ref="comment_d_id"}`).
            *   A "Comments Appendix" section at the end (`<!-- Comments Appendix --> ...`).
            *   The JSON block within the appendix should contain all comments (A, B, D) with their latest state:
                *   Comment A should have its new reply in its thread.
                *   Comment B should have `status: "resolved"`.
                *   Comment D should be present with its single thread message.
        *   The YAML frontmatter (if any) should be preserved.
        *   The `live_documents` entry for the `shareToken` should be deleted after a successful commit.
    *   No errors during the save or commit process.

---
This E2E testing plan covers the main user flows and technical aspects of the commenting feature.
