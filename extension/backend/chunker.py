"""
Text chunking logic using LangChain's RecursiveCharacterTextSplitter.
"""

import hashlib
from pathlib import PurePosixPath

from langchain_text_splitters import RecursiveCharacterTextSplitter

from config import CHUNK_SIZE, CHUNK_OVERLAP


# Language-specific separators for better splitting
LANGUAGE_SEPARATORS: dict[str, list[str]] = {
    "python": ["\nclass ", "\ndef ", "\n\ndef ", "\n\n", "\n", " "],
    "javascript": ["\nfunction ", "\nconst ", "\nlet ", "\nclass ", "\nexport ", "\n\n", "\n", " "],
    "typescript": ["\nfunction ", "\nconst ", "\nlet ", "\nclass ", "\nexport ", "\ninterface ", "\ntype ", "\n\n", "\n", " "],
    "go": ["\nfunc ", "\ntype ", "\n\n", "\n", " "],
    "rust": ["\nfn ", "\npub fn ", "\nimpl ", "\nstruct ", "\nenum ", "\nmod ", "\n\n", "\n", " "],
    "java": ["\npublic ", "\nprivate ", "\nprotected ", "\nclass ", "\ninterface ", "\n\n", "\n", " "],
    "ruby": ["\ndef ", "\nclass ", "\nmodule ", "\n\n", "\n", " "],
}

# Map file extensions to language keys
EXT_TO_LANGUAGE: dict[str, str] = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".rb": "ruby",
}


def _detect_language(file_path: str) -> str:
    """Detect the programming language from the file extension."""
    ext = PurePosixPath(file_path).suffix.lower()
    return EXT_TO_LANGUAGE.get(ext, "")


def _make_chunk_id(repo_full_name: str, file_path: str, chunk_index: int) -> str:
    """Generate a deterministic, unique chunk ID."""
    raw = f"{repo_full_name}:{file_path}:{chunk_index}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def chunk_file(
    content: str,
    repo_full_name: str,
    file_path: str,
    source_type: str,
    last_commit_sha: str,
    github_url: str,
) -> list[dict]:
    """
    Split file content into chunks with metadata.

    Returns a list of dicts, each with:
      - id: unique chunk identifier
      - text: chunk content
      - metadata: dict with repo, file, language, etc.
    """
    if not content.strip():
        return []

    language = _detect_language(file_path)

    # Choose separators based on language
    separators = LANGUAGE_SEPARATORS.get(language)

    if separators:
        splitter = RecursiveCharacterTextSplitter(
            separators=separators,
            chunk_size=CHUNK_SIZE,
            chunk_overlap=CHUNK_OVERLAP,
            length_function=len,  # character-level; approximates tokens
            is_separator_regex=False,
        )
    else:
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE,
            chunk_overlap=CHUNK_OVERLAP,
            length_function=len,
        )

    texts = splitter.split_text(content)

    chunks = []
    for i, text in enumerate(texts):
        chunk_id = _make_chunk_id(repo_full_name, file_path, i)
        chunks.append({
            "id": chunk_id,
            "text": text,
            "metadata": {
                "repo_full_name": repo_full_name,
                "file_path": file_path,
                "language": language or PurePosixPath(file_path).suffix.lstrip("."),
                "source_type": source_type,
                "github_url": github_url,
                "last_commit_sha": last_commit_sha,
                "chunk_index": i,
            },
        })

    return chunks
