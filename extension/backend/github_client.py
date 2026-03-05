"""
GitHub API client wrapper using PyGithub.
Handles rate limiting, retries, and file traversal.
"""

import time
import logging
from datetime import datetime, timezone
from collections.abc import Callable
from pathlib import PurePosixPath

from github import Github, Auth, GithubException, RateLimitExceededException
from github.Repository import Repository
from github.ContentFile import ContentFile

from config import (
    SKIP_DIRS,
    SKIP_FILES,
    BINARY_EXTENSIONS,
    MAX_FILE_SIZE,
    BATCH_SIZE,
    BATCH_DELAY,
    PERSONAL_INDEX_DIRS,
    STARRED_INDEX_DIRS,
    ROOT_INCLUDE_PATTERNS,
    RATE_LIMIT_WARNING_THRESHOLD,
)

logger = logging.getLogger(__name__)


class GitHubClient:
    """Wrapper around PyGithub with rate limit handling."""

    def __init__(self, token: str):
        auth = Auth.Token(token)
        self.github = Github(auth=auth, per_page=100)
        self._user = None

    def close(self) -> None:
        self.github.close()

    @property
    def user(self):
        if self._user is None:
            self._user = self.github.get_user()
        return self._user

    def get_rate_limit_remaining(self) -> int:
        """Get remaining API calls in the current rate limit window."""
        return self.github.get_rate_limit().core.remaining

    def check_rate_limit(self) -> None:
        """Log a warning if rate limit is getting low."""
        remaining = self.get_rate_limit_remaining()
        if remaining < RATE_LIMIT_WARNING_THRESHOLD:
            reset_time = self.github.get_rate_limit().core.reset
            logger.warning(
                f"GitHub API rate limit low: {remaining} remaining. "
                f"Resets at {reset_time}"
            )

    def get_personal_repos(self) -> list[dict]:
        """Get the authenticated user's own repositories."""
        repos = []
        for repo in self.user.get_repos(type="owner", sort="updated", direction="desc"):
            if repo.fork:
                continue
            repos.append(self._repo_to_dict(repo, "personal"))
        return repos

    def get_starred_repos(self) -> list[dict]:
        """Get the authenticated user's starred repositories."""
        repos = []
        for repo in self.user.get_starred():
            repos.append(self._repo_to_dict(repo, "starred"))
        return repos

    def _repo_to_dict(self, repo: Repository, source_type: str) -> dict:
        return {
            "full_name": repo.full_name,
            "description": repo.description or "",
            "source_type": source_type,
            "html_url": repo.html_url,
            "language": repo.language,
            "updated_at": repo.updated_at.isoformat() if repo.updated_at else "",
        }

    def get_repo_files(
        self, repo_full_name: str, source_type: str
    ) -> list[dict]:
        """
        Get a list of indexable files in a repo.
        Returns list of {"path": str, "sha": str, "size": int}.

        For personal repos: index files in PERSONAL_INDEX_DIRS + root-level files.
        For starred repos: index more broadly (STARRED_INDEX_DIRS + root).
        """
        repo = self.github.get_repo(repo_full_name)
        index_dirs = PERSONAL_INDEX_DIRS if source_type == "personal" else STARRED_INDEX_DIRS
        files: list[dict] = []

        try:
            self._traverse_repo(repo, "", index_dirs, files, is_root=True)
        except RateLimitExceededException:
            logger.error("Rate limit exceeded while listing files")
            raise
        except GithubException as e:
            logger.error(f"GitHub API error listing files for {repo_full_name}: {e}")
            raise

        return files

    def _traverse_repo(
        self,
        repo: Repository,
        path: str,
        index_dirs: set[str],
        files: list[dict],
        is_root: bool = False,
    ) -> None:
        """Recursively traverse repo contents, respecting skip/include rules."""
        try:
            contents = repo.get_contents(path)
        except GithubException as e:
            logger.warning(f"Could not read {repo.full_name}/{path}: {e}")
            return

        if not isinstance(contents, list):
            contents = [contents]

        for item in contents:
            name = item.name
            item_path = item.path

            if item.type == "dir":
                # Skip excluded directories
                if name in SKIP_DIRS:
                    continue

                if is_root:
                    # At the root, only recurse into allowed dirs
                    if name in index_dirs or name.lower() in {"docs", "doc"}:
                        self._traverse_repo(repo, item_path, index_dirs, files)
                else:
                    # Inside an allowed dir, recurse freely (but still skip excluded dirs)
                    self._traverse_repo(repo, item_path, index_dirs, files)

            elif item.type == "file":
                if self._should_index_file(name, item_path, item.size, is_root):
                    files.append({
                        "path": item_path,
                        "sha": item.sha,
                        "size": item.size,
                    })

    def _should_index_file(
        self, name: str, path: str, size: int, is_root: bool
    ) -> bool:
        """Check if a file should be indexed."""
        # Skip by name
        if name in SKIP_FILES:
            return False

        # Skip by extension
        ext = PurePosixPath(name).suffix.lower()
        if ext in BINARY_EXTENSIONS:
            return False

        # Skip files that are too large
        if size > MAX_FILE_SIZE:
            return False

        # At root level, only include known root files
        if is_root:
            return name in ROOT_INCLUDE_PATTERNS or ext in {
                ".py", ".ts", ".js", ".tsx", ".jsx", ".go", ".rs",
                ".java", ".rb", ".php", ".yaml", ".yml", ".toml",
                ".json", ".md", ".sh", ".bash",
            }

        return True

    def get_file_content(self, repo_full_name: str, file_path: str) -> tuple[str, str]:
        """
        Fetch a single file's content from the GitHub API.
        Returns (content_string, sha).
        """
        repo = self.github.get_repo(repo_full_name)

        try:
            content_file: ContentFile = repo.get_contents(file_path)  # type: ignore
        except GithubException as e:
            logger.error(f"Failed to fetch {repo_full_name}/{file_path}: {e}")
            raise

        try:
            content = content_file.decoded_content.decode("utf-8")
        except (UnicodeDecodeError, AttributeError):
            # Binary file that slipped through — skip
            logger.warning(f"Cannot decode {repo_full_name}/{file_path} as UTF-8, skipping")
            return "", content_file.sha

        return content, content_file.sha

    def get_file_contents_batch(
        self,
        repo_full_name: str,
        file_paths: list[str],
        on_progress: Callable[[int, int], None] | None = None,
    ) -> list[tuple[str, str, str]]:
        """
        Fetch multiple files with rate limit handling and batching.
        Returns list of (file_path, content, sha).
        Calls on_progress(files_done, files_total) after each batch.
        """
        results: list[tuple[str, str, str]] = []
        total = len(file_paths)

        for i in range(0, total, BATCH_SIZE):
            batch = file_paths[i : i + BATCH_SIZE]

            for file_path in batch:
                try:
                    content, sha = self.get_file_content(repo_full_name, file_path)
                    if content:  # skip empty / binary files
                        results.append((file_path, content, sha))
                except RateLimitExceededException:
                    logger.warning("Rate limit hit — waiting for reset...")
                    reset_time = self.github.get_rate_limit().core.reset
                    now = datetime.now(timezone.utc)
                    wait_seconds = max(
                        int((reset_time - now).total_seconds()),
                        60,
                    )
                    time.sleep(wait_seconds)
                    # Retry the file
                    try:
                        content, sha = self.get_file_content(repo_full_name, file_path)
                        if content:
                            results.append((file_path, content, sha))
                    except Exception as e:
                        logger.error(f"Failed to fetch {file_path} after rate limit wait: {e}")
                except GithubException as e:
                    if e.status == 429:
                        logger.warning("429 Too Many Requests — backing off...")
                        time.sleep(60)
                    else:
                        logger.error(f"Error fetching {file_path}: {e}")

            done = min(i + len(batch), total)
            if on_progress:
                on_progress(done, total)

            # Delay between batches to avoid hitting rate limits
            if i + BATCH_SIZE < total:
                self.check_rate_limit()
                time.sleep(BATCH_DELAY)

        return results
