"""
Configuration constants and paths for the GitHub RAG backend.
"""

from pathlib import Path

# ----- Storage paths -----
DATA_DIR = Path.home() / ".github-rag"
CHROMA_DIR = DATA_DIR / "chroma_db"
METADATA_DB_PATH = DATA_DIR / "metadata.db"

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
CHROMA_DIR.mkdir(parents=True, exist_ok=True)

# ----- Chunking -----
CHUNK_SIZE = 512  # tokens
CHUNK_OVERLAP = 64  # tokens

# ----- GitHub API -----
BATCH_SIZE = 20  # files per batch
BATCH_DELAY = 1.0  # seconds between batches
MAX_FILE_SIZE = 500_000  # 500KB
RATE_LIMIT_WARNING_THRESHOLD = 500

# ----- Directories to skip (always) -----
SKIP_DIRS = {
    "node_modules",
    ".git",
    "dist",
    "build",
    "__pycache__",
    ".next",
    ".nuxt",
    "coverage",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    "vendor",
    "venv",
    ".venv",
    "env",
    ".env",
    "target",       # Rust/Java build output
    "out",
}

# ----- Files to skip (always) -----
SKIP_FILES = {
    "package-lock.json",
    "yarn.lock",
    "poetry.lock",
    "pnpm-lock.yaml",
    "Pipfile.lock",
    "Cargo.lock",
    "composer.lock",
    "Gemfile.lock",
}

# ----- Binary / non-text extensions to skip -----
BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg",
    ".webp", ".tiff", ".tif",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".mp3", ".mp4", ".avi", ".mov", ".mkv", ".wav", ".flac",
    ".zip", ".tar", ".gz", ".bz2", ".rar", ".7z",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".exe", ".dll", ".so", ".dylib", ".bin",
    ".pyc", ".pyo", ".class", ".o", ".obj",
    ".sqlite", ".db",
    ".DS_Store",
}

# ----- Directories that are indexed for personal repos -----
# Files at root level (README, config files) are always included.
# These are the subdirectories we recurse into for personal repos.
PERSONAL_INDEX_DIRS = {
    "src", "lib", "app", "api", "pages", "routes",
    "components", "services", "utils", "helpers",
    "middleware", "models", "controllers", "handlers",
    "hooks", "providers", "config", "core",
}

# ----- For starred repos, we index more broadly -----
# We index all source files + README + docs (full depth)
STARRED_INDEX_DIRS = {
    "src", "lib", "app", "api", "docs", "doc",
    "examples", "packages", "modules",
}

# ----- Root files that are always indexed -----
ROOT_INCLUDE_PATTERNS = {
    "README.md", "README.rst", "README.txt", "README",
    ".env.example", "Makefile", "Dockerfile",
}
