"""
SQLite metadata database for tracking indexed file SHAs.
Used for stale chunk invalidation — only re-embed files whose SHA has changed.
"""

import sqlite3
import json
from pathlib import Path
from config import METADATA_DB_PATH


class MetadataDB:
    """Manages the SQLite metadata store at ~/.github-rag/metadata.db"""

    def __init__(self, db_path: Path | None = None):
        self.db_path = db_path or METADATA_DB_PATH
        self._init_db()

    def _init_db(self) -> None:
        """Create the metadata table if it doesn't exist."""
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS file_metadata (
                    repo_full_name TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    last_commit_sha TEXT NOT NULL,
                    chunk_ids TEXT NOT NULL DEFAULT '[]',
                    PRIMARY KEY (repo_full_name, file_path)
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_repo
                ON file_metadata (repo_full_name)
            """)

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(str(self.db_path))

    def get_file_sha(self, repo_full_name: str, file_path: str) -> str | None:
        """Get the stored SHA for a file, or None if not tracked."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT last_commit_sha FROM file_metadata WHERE repo_full_name = ? AND file_path = ?",
                (repo_full_name, file_path),
            ).fetchone()
            return row[0] if row else None

    def get_chunk_ids(self, repo_full_name: str, file_path: str) -> list[str]:
        """Get the stored chunk IDs for a file."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT chunk_ids FROM file_metadata WHERE repo_full_name = ? AND file_path = ?",
                (repo_full_name, file_path),
            ).fetchone()
            return json.loads(row[0]) if row else []

    def upsert_file(
        self, repo_full_name: str, file_path: str, sha: str, chunk_ids: list[str]
    ) -> None:
        """Insert or update a file's metadata."""
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO file_metadata (repo_full_name, file_path, last_commit_sha, chunk_ids)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (repo_full_name, file_path)
                DO UPDATE SET last_commit_sha = excluded.last_commit_sha,
                              chunk_ids = excluded.chunk_ids
                """,
                (repo_full_name, file_path, sha, json.dumps(chunk_ids)),
            )

    def delete_repo(self, repo_full_name: str) -> list[str]:
        """
        Delete all metadata for a repo. Returns all chunk IDs that were stored
        (so they can be removed from ChromaDB).
        """
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT chunk_ids FROM file_metadata WHERE repo_full_name = ?",
                (repo_full_name,),
            ).fetchall()

            all_chunk_ids: list[str] = []
            for row in rows:
                all_chunk_ids.extend(json.loads(row[0]))

            conn.execute(
                "DELETE FROM file_metadata WHERE repo_full_name = ?",
                (repo_full_name,),
            )
            return all_chunk_ids

    def get_repo_files(self, repo_full_name: str) -> dict[str, str]:
        """Get a dict of {file_path: sha} for all tracked files in a repo."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT file_path, last_commit_sha FROM file_metadata WHERE repo_full_name = ?",
                (repo_full_name,),
            ).fetchall()
            return {row[0]: row[1] for row in rows}

    def get_indexed_repos(self) -> list[str]:
        """Return all repository names that currently have indexed metadata."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT DISTINCT repo_full_name FROM file_metadata ORDER BY repo_full_name ASC"
            ).fetchall()
            return [row[0] for row in rows]
