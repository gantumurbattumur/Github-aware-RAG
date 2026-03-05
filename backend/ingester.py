"""
Ingestion pipeline: fetch files from GitHub → chunk → embed → store in ChromaDB.
Tracks progress via IngestJob objects.
"""

import asyncio
import uuid
import logging

import chromadb
from openai import OpenAI

from github_client import GitHubClient
from chunker import chunk_file
from metadata_db import MetadataDB
from models import IngestStatusEnum

logger = logging.getLogger(__name__)


class IngestJob:
    """Tracks the state of an ingestion job."""

    def __init__(self, job_id: str, repo_full_name: str):
        self.job_id = job_id
        self.repo_full_name = repo_full_name
        self.files_done = 0
        self.files_total = 0
        self.status: IngestStatusEnum = IngestStatusEnum.running
        self.error: str | None = None


# In-memory job tracker — sufficient for local single-user use
active_jobs: dict[str, IngestJob] = {}


def create_ingest_job(repo_full_name: str) -> str:
    """Create a new ingestion job and return its ID."""
    job_id = str(uuid.uuid4())[:8]
    job = IngestJob(job_id, repo_full_name)
    active_jobs[job_id] = job
    return job_id


def get_ingest_job(job_id: str) -> IngestJob | None:
    """Get an ingestion job by ID."""
    return active_jobs.get(job_id)


async def run_ingestion(
    job_id: str,
    repo_full_name: str,
    source_type: str,
    github_token: str,
    openai_api_key: str,
    chroma_client: chromadb.ClientAPI,
    metadata_db: MetadataDB,
) -> None:
    """
    Main ingestion pipeline. Runs in a background asyncio task.

    Steps:
    1. List files in the repo via GitHub API
    2. Check metadata DB for unchanged files (skip them)
    3. Fetch changed/new files
    4. Chunk each file
    5. Embed chunks using OpenAI
    6. Upsert into ChromaDB
    7. Update metadata DB
    """
    job = active_jobs.get(job_id)
    if not job:
        return

    gh = GitHubClient(github_token)
    openai_client = OpenAI(api_key=openai_api_key)

    try:
        # Select the correct collection
        collection_name = "personal_repos" if source_type == "personal" else "starred_repos"
        collection = chroma_client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )

        # Step 1: List files
        logger.info(f"[Ingest {job_id}] Listing files for {repo_full_name}...")
        files = await asyncio.to_thread(
            gh.get_repo_files, repo_full_name, source_type
        )
        job.files_total = len(files)
        logger.info(f"[Ingest {job_id}] Found {len(files)} files to process")

        # Step 2: Check which files need re-indexing
        existing_shas = metadata_db.get_repo_files(repo_full_name)
        files_to_process = []
        files_unchanged = []

        for f in files:
            stored_sha = existing_shas.get(f["path"])
            if stored_sha == f["sha"]:
                files_unchanged.append(f["path"])
                job.files_done += 1
            else:
                files_to_process.append(f)

        logger.info(
            f"[Ingest {job_id}] {len(files_unchanged)} unchanged, "
            f"{len(files_to_process)} to process"
        )

        # Step 3-7: Process files that need updating
        for i, file_info in enumerate(files_to_process):
            file_path = file_info["path"]

            try:
                # Fetch content
                content, sha = await asyncio.to_thread(
                    gh.get_file_content, repo_full_name, file_path
                )

                if not content:
                    job.files_done += 1
                    continue

                # Delete old chunks for this file if they exist
                old_chunk_ids = metadata_db.get_chunk_ids(repo_full_name, file_path)
                if old_chunk_ids:
                    try:
                        collection.delete(ids=old_chunk_ids)
                    except Exception as e:
                        logger.warning(f"Failed to delete old chunks for {file_path}: {e}")

                # Build GitHub URL
                default_branch = "main"  # simplification; could be fetched from repo
                github_url = f"https://github.com/{repo_full_name}/blob/{default_branch}/{file_path}"

                # Chunk the file
                chunks = chunk_file(
                    content=content,
                    repo_full_name=repo_full_name,
                    file_path=file_path,
                    source_type=source_type,
                    last_commit_sha=sha,
                    github_url=github_url,
                )

                if chunks:
                    # Embed chunks
                    texts = [c["text"] for c in chunks]
                    embeddings = await _embed_texts(openai_client, texts)

                    # Upsert into ChromaDB
                    chunk_ids = [c["id"] for c in chunks]
                    metadatas = [c["metadata"] for c in chunks]

                    collection.upsert(
                        ids=chunk_ids,
                        embeddings=embeddings,
                        documents=texts,
                        metadatas=metadatas,
                    )

                    # Update metadata DB
                    metadata_db.upsert_file(repo_full_name, file_path, sha, chunk_ids)
                else:
                    metadata_db.upsert_file(repo_full_name, file_path, sha, [])

            except Exception as e:
                logger.error(f"[Ingest {job_id}] Error processing {file_path}: {e}")
                # Continue with next file instead of failing entire job

            job.files_done += 1

        # Handle files that were deleted from the repo
        current_paths = {f["path"] for f in files}
        for stored_path in existing_shas:
            if stored_path not in current_paths:
                old_ids = metadata_db.get_chunk_ids(repo_full_name, stored_path)
                if old_ids:
                    try:
                        collection.delete(ids=old_ids)
                    except Exception:
                        pass

        job.status = IngestStatusEnum.done
        logger.info(f"[Ingest {job_id}] Completed successfully for {repo_full_name}")

    except Exception as e:
        job.status = IngestStatusEnum.error
        job.error = str(e)
        logger.error(f"[Ingest {job_id}] Failed: {e}")

    finally:
        gh.close()


async def _embed_texts(openai_client: OpenAI, texts: list[str]) -> list[list[float]]:
    """
    Embed a batch of texts using OpenAI text-embedding-3-small.
    Runs in a thread to avoid blocking the event loop.
    """
    def _do_embed():
        response = openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=texts,
        )
        return [item.embedding for item in response.data]

    return await asyncio.to_thread(_do_embed)
