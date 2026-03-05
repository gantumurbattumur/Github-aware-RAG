# GitHub RAG

Search your personal GitHub repos and starred repos from inside VS Code.

GitHub RAG indexes selected repositories into a local vector database, then lets you ask natural-language questions to find relevant code snippets fast.

## Why this exists

I built this to stop manually browsing GitHub every time I needed an old implementation from my own repos or starred repos. The goal is to keep code reference search inside the same coding workspace.

## Features

- Semantic code search across personal + starred repos
- Sidebar UI in VS Code
- Local indexing with ChromaDB + SQLite metadata
- Source links back to GitHub files

## Requirements

- Node.js >= 18
- Python >= 3.10
- OpenAI API key
- GitHub authentication in VS Code

## Local development

```bash
cd extension
npm install
npm run compile
npm run vsix
```

Install the generated `.vsix` and open the extension from the activity bar.

## Settings

- `github-rag.openaiApiKey`
- `github-rag.pythonPath` (default: `.venv/bin/python`)
- `github-rag.backendPort` (default: `8747`)

## Search behavior

Search uses semantic retrieval (embeddings + vector similarity), not plain keyword-only grep.

## Privacy

- Index data is stored locally (`~/.github-rag/`)
- OpenAI API is used for embeddings and result explanations
- You choose which repositories are indexed
