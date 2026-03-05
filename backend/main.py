"""
GitHub-Aware-RAG FastAPI Backend
================================
Local server that handles GitHub API calls, file chunking, embedding, and RAG retrieval.
Runs on http://127.0.0.1:8747 (default port).
No CORS middleware needed — all requests come from the VS Code extension host (Node.js),
not from a browser.
"""

import asyncio
import logging
from contextlib import asynccontextmanager

import chromadb
from fastapi import FastAPI, Header, HTTPException

from config import CHROMA_DIR
from metadata_db import MetadataDB
from github_client import GitHubClient
from ingester import (
    create_ingest_job,
    get_ingest_job,
    run_ingestion,
)
from retriever import search
from models import (
    RepoInfo,
    IngestRequest,
    IngestResponse,
    IngestStatus,
    QueryRequest,
    QueryResponse,
)

# ----- Logging -----
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ----- Global state -----
chroma_client: chromadb.ClientAPI | None = None
metadata_db: MetadataDB | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    global chroma_client, metadata_db

    # ---- Startup ----
    logger.info(f"Initializing ChromaDB at {CHROMA_DIR}")
    chroma_client = chromadb.PersistentClient(path=str(CHROMA_DIR))

    # Create both collections (get_or_create is idempotent)
    chroma_client.get_or_create_collection(
        name="personal_repos",
        metadata={"hnsw:space": "cosine"},
    )
    chroma_client.get_or_create_collection(
        name="starred_repos",
        metadata={"hnsw:space": "cosine"},
    )
    logger.info("ChromaDB collections ready: personal_repos, starred_repos")

    # Initialize SQLite metadata DB
    metadata_db = MetadataDB()
    logger.info(f"Metadata DB initialized at {metadata_db.db_path}")

    yield

    # ---- Shutdown ----
    logger.info("Backend shutting down")


# ----- App -----
app = FastAPI(
    title="GitHub RAG Backend",
    description="Local backend for the GitHub-Aware-RAG VS Code extension",
    version="0.1.0",
    lifespan=lifespan,
)


# ----- Helper to extract headers -----

def _require_github_token(x_github_token: str | None = Header(None)) -> str:
    if not x_github_token:
        raise HTTPException(status_code=401, detail="X-GitHub-Token header required")
    return x_github_token


def _require_openai_key(x_openai_key: str | None = Header(None)) -> str:
    if not x_openai_key:
        raise HTTPException(status_code=401, detail="X-OpenAI-Key header required")
    return x_openai_key


# ----- Routes -----


@app.get("/health")
async def health():
    """Health check — extension pings this to confirm backend is alive."""
    return {"status": "ok"}


@app.get("/repos", response_model=list[RepoInfo])
async def get_repos(x_github_token: str | None = Header(None)):
    """Fetch the user's personal repos and starred repos from GitHub."""
    token = _require_github_token(x_github_token)

    gh = GitHubClient(token)
    try:
        personal = await asyncio.to_thread(gh.get_personal_repos)
        starred = await asyncio.to_thread(gh.get_starred_repos)

        repos = [RepoInfo(**r) for r in personal] + [RepoInfo(**r) for r in starred]
        return repos
    except Exception as e:
        logger.error(f"Error fetching repos: {e}")
        raise HTTPException(status_code=502, detail=f"GitHub API error: {str(e)}")
    finally:
        gh.close()


@app.post("/ingest", response_model=IngestResponse)
async def ingest(
    request: IngestRequest,
    x_github_token: str | None = Header(None),
    x_openai_key: str | None = Header(None),
):
    """Start ingestion for a single repository."""
    token = _require_github_token(x_github_token)
    openai_key = _require_openai_key(x_openai_key)

    job_id = create_ingest_job(request.repo_full_name)

    # Run ingestion in the background
    asyncio.create_task(
        run_ingestion(
            job_id=job_id,
            repo_full_name=request.repo_full_name,
            source_type=request.source_type.value,
            github_token=token,
            openai_api_key=openai_key,
            chroma_client=chroma_client,
            metadata_db=metadata_db,
        )
    )

    return IngestResponse(status="started", job_id=job_id)


@app.get("/ingest/status/{job_id}", response_model=IngestStatus)
async def ingest_status(job_id: str):
    """Check the progress of an ingestion job."""
    job = get_ingest_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    return IngestStatus(
        job_id=job.job_id,
        files_done=job.files_done,
        files_total=job.files_total,
        status=job.status,
        error=job.error,
    )


@app.post("/query", response_model=QueryResponse)
async def query(
    request: QueryRequest,
    x_openai_key: str | None = Header(None),
):
    """Run a semantic search query across indexed repos."""
    openai_key = _require_openai_key(x_openai_key)

    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    try:
        results = await search(
            query=request.query,
            source_filter=request.source_filter,
            openai_api_key=openai_key,
            chroma_client=chroma_client,
            n_results=5,
        )
        return QueryResponse(results=results)
    except Exception as e:
        logger.error(f"Query error: {e}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@app.delete("/index/{repo_full_name:path}")
async def delete_index(
    repo_full_name: str,
    x_github_token: str | None = Header(None),
):
    """Remove all indexed data for a repository."""
    _require_github_token(x_github_token)

    try:
        # Get all chunk IDs from metadata and delete from ChromaDB
        chunk_ids = metadata_db.delete_repo(repo_full_name)

        if chunk_ids:
            # Try to delete from both collections (chunks may be in either)
            for collection_name in ["personal_repos", "starred_repos"]:
                try:
                    collection = chroma_client.get_collection(name=collection_name)
                    collection.delete(ids=chunk_ids)
                except Exception:
                    pass  # Collection may not exist or IDs may not be in this collection

        return {"status": "deleted", "repo": repo_full_name, "chunks_removed": len(chunk_ids)}

    except Exception as e:
        logger.error(f"Error deleting index for {repo_full_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete index: {str(e)}")
