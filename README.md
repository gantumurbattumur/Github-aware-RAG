# GitHub-Aware-RAG

A semantic code reference tool for VS Code. Indexes your personal GitHub repositories and starred repos into a local vector database, letting you search across your entire coding history using natural language — without leaving your editor.

## Features

- **Natural language search** — Ask questions like "how did I handle JWT refresh tokens" and get relevant code snippets
- **Dual-track index** — Searches both your own repos (personal history) and starred repos (curated reference library)
- **Local & private** — All data stored locally in ChromaDB. No cloud required for querying.
- **VS Code sidebar** — Integrated panel with search, results, and repo management

## Architecture

```
┌──────────────────┐     postMessage      ┌──────────────────┐     HTTP      ┌──────────────────┐
│  React Webview   │ ◄──────────────────► │  Extension Host  │ ◄──────────► │  FastAPI Backend │
│  (Sidebar Panel) │                      │  (TypeScript)    │              │  (Python, local) │
└──────────────────┘                      └──────────────────┘              └──────────────────┘
                                                                                     │
                                                                           ┌─────────┴─────────┐
                                                                           │                   │
                                                                      ChromaDB           GitHub API
                                                                   (local vectors)      (PyGithub)
```

## Prerequisites

- **Node.js** ≥ 18
- **Python** ≥ 3.10
- **OpenAI API key** (for embeddings and answer generation)
- **GitHub account** (OAuth handled by VS Code)

## Setup

### Backend

```bash
cd backend
uv venv --python 3.12 .venv
uv lock
uv sync --frozen
```

### Extension

```bash
cd extension
npm install
npm run compile
```

### Running

1. Open the project in VS Code
2. Press **F5** to launch the Extension Development Host
3. Click the **GitHub RAG** icon in the activity bar
4. Sign in with GitHub when prompted
5. Select repos to index, then search!

## Configuration

| Setting                   | Description                                | Default            |
| ------------------------- | ------------------------------------------ | ------------------ |
| `github-rag.openaiApiKey` | OpenAI API key for embeddings & generation | —                  |
| `github-rag.pythonPath`   | Path to Python interpreter                 | `.venv/bin/python` |
| `github-rag.backendPort`  | Port for the local FastAPI server          | `8747`             |

## Data Storage

All data is stored locally at `~/.github-rag/`:

- `chroma_db/` — ChromaDB persistent vector store
- `metadata.db` — SQLite file metadata for stale chunk tracking
