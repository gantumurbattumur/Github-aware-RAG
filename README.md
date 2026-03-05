# GitHub-Aware-RAG

GitHub-Aware-RAG is a VS Code extension that lets you semantically search your own GitHub repos and starred repos without leaving your editor.

## Why I built this

I built this because I wanted my GitHub code references available inside the same workspace. I was tired of manually digging through personal repos and starred repos every time I needed an old pattern, utility, or implementation detail.

## What it does

- Connects to your GitHub account.
- Indexes selected repositories (personal + starred).
- Chunks code files and stores embeddings locally.
- Lets you ask natural-language questions and returns relevant code snippets with source links.

## Real use cases

- **Find your old implementation quickly**  
   “Where did I implement JWT refresh token rotation?”

- **Reuse your own patterns**  
   “Show me how I handled retry with exponential backoff before.”

- **Search starred repos as reference docs**  
   “Find React query cache invalidation examples from repos I starred.”

- **Stay in flow while coding**  
   Search history/reference code from the sidebar instead of switching tabs to GitHub.

## How search works

Search is semantic (embedding-based), not plain keyword grep.

1. Your query is embedded using `text-embedding-3-small`.
2. The backend queries ChromaDB collections (`personal_repos` and/or `starred_repos`) by vector similarity.
3. Results are merged and sorted by similarity score.
4. A short relevance explanation is generated for each result.

## Project scope (simple on purpose)

This is a local/personal productivity project first:

- Single-user local backend (FastAPI).
- Local vector storage (ChromaDB).
- Local metadata tracking (SQLite).
- No multi-tenant infrastructure, billing, or cloud deployment complexity.

## Requirements

- Node.js `>= 18`
- Python `>= 3.10`
- OpenAI API key
- GitHub account (VS Code authentication)

## Quick start (local)

### 1) Backend

```bash
cd backend
uv venv --python 3.12 .venv
uv lock
uv sync --frozen
```

### 2) Extension

```bash
cd extension
npm install
npm run compile
```

### 3) Run in VS Code

1. Open the repo in VS Code.
2. Press `F5` to open Extension Development Host.
3. Open **GitHub RAG** from the Activity Bar.
4. Sign in to GitHub.
5. Set your OpenAI API key in settings.
6. Index repos and start searching.

## Configuration

| Setting                   | Description                                            | Default            |
| ------------------------- | ------------------------------------------------------ | ------------------ |
| `github-rag.openaiApiKey` | OpenAI API key for embeddings + explanation generation | `""`               |
| `github-rag.pythonPath`   | Python interpreter used by backend                     | `.venv/bin/python` |
| `github-rag.backendPort`  | Local FastAPI backend port                             | `8747`             |

## Local data

Data is stored at `~/.github-rag/`:

- `chroma_db/` — vector index
- `metadata.db` — file/chunk metadata used for incremental re-indexing

## Privacy notes

- Repository content is indexed locally.
- Embeddings and snippet explanations use OpenAI API (network call).
- You control which repos are indexed.

## Current status

Working MVP focused on practical personal use. Expect incremental improvements rather than enterprise-level surface area.
