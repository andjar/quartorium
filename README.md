# Quartorium ✒️

**A collaborative WYSIWYG editor for Quarto, bridging the gap between reproducible research and seamless teamwork.**

Quartorium allows technical authors to share their Quarto (`.qmd`) documents with non-technical collaborators through a simple, clean, Word-like interface. Collaborators can edit prose and add comments without ever seeing code, while authors can review these changes and merge them back into a version-controlled Git workflow.

See demo on youtube:

[![Demo video](https://img.youtube.com/vi/yBLlVgVVQiE/0.jpg)](https://www.youtube.com/watch?v=yBLlVgVVQiE)


## ✨ Core Features

*   **Seamless Collaboration:** Share a simple link with collaborators. They get a clean WYSIWYG editor—no setup required.
*   **Code-Free Editing:** Quarto code chunks are hidden from collaborators. They see the plots and tables, but can only edit the surrounding prose.
*   **Git-Powered Version Control:** Every change is automatically committed to a separate Git branch, creating a perfect audit trail.
*   **Visual Diff & Merge:** Authors can visually review all suggestions, then accept or reject changes with the click of a button.
*   **Inline Commenting:** Highlight text to start a discussion, right in the margin.

## 🚀 Tech Stack

*   **Frontend:** React (Vite), TipTap (for the editor), Tailwind CSS
*   **Backend:** Node.js, Express.js
*   **Database:** SQLite
*   **Core Engine:** Git, Quarto CLI

## 🏁 Getting Started

Follow these instructions to get Quartorium running on your local machine for development and testing.

### Prerequisites

You must have the following tools installed directly on your system:
*   [Node.js](https://nodejs.org/) (v18 or later)
*   [Git](https://git-scm.com/)
*   [Quarto CLI](https://quarto.org/docs/get-started/)

### Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/andjar/quartorium.git
    cd quartorium
    ```

2.  **Install all dependencies:**
    This command will run `npm install` in the root, `backend`, and `frontend` directories.
    ```bash
    npm install
    ```

3.  **Set up environment variables:**
    Copy the example environment file. The default settings with SQLite should work out of the box for local development. You will still need to add GitHub API keys to enable login.
    ```bash
    cp .env.example .env
    ```
    To get your GitHub keys, create a new GitHub OAuth App in your developer settings.

4.  **Run the application:**
    You will need two separate terminal windows or tabs.

    *   **In Terminal 1 (for the Backend):**
        ```bash
        npm run start:backend
        ```
        This will start the backend API server, typically on `http://localhost:8000`.

    *   **In Terminal 2 (for the Frontend):**
        ```bash
        npm run start:frontend
        ```
        This will start the React development server, typically on `http://localhost:3000`.

5.  **Open the app:**
    Navigate to `http://localhost:3000` in your web browser.

### Scripts

The root `package.json` contains helper scripts to manage the project:
*   `npm install`: Installs dependencies for all workspaces.
*   `npm run start:backend`: Starts the backend server in development mode.
*   `npm run start:frontend`: Starts the frontend development server.

### ⚠️ A Note on Security

This development setup runs the `quarto render` command directly on your machine. **Do not use this application with untrusted `.qmd` files from the internet**, as they could contain malicious code. For personal use and with trusted collaborators, this setup is fine. A public-facing production deployment would require sandboxing this process (e.g., using Docker).

## 📄 License

This project is licensed under the GPL3 License - see the `LICENSE` file for details.
