"""
Pydantic request/response models for the FastAPI backend.
"""

from pydantic import BaseModel
from enum import Enum


class SourceType(str, Enum):
    personal = "personal"
    starred = "starred"


class SourceFilter(str, Enum):
    all = "all"
    personal = "personal"
    starred = "starred"


# ----- Repos -----

class RepoInfo(BaseModel):
    full_name: str
    description: str | None = None
    source_type: SourceType
    html_url: str
    language: str | None = None
    updated_at: str


# ----- Ingestion -----

class IngestRequest(BaseModel):
    repo_full_name: str
    source_type: SourceType


class IngestResponse(BaseModel):
    status: str
    job_id: str


class IngestStatusEnum(str, Enum):
    running = "running"
    done = "done"
    error = "error"


class IngestStatus(BaseModel):
    job_id: str
    files_done: int
    files_total: int
    status: IngestStatusEnum
    error: str | None = None


# ----- Query -----

class QueryRequest(BaseModel):
    query: str
    source_filter: SourceFilter = SourceFilter.all


class QueryResult(BaseModel):
    repo: str
    file_path: str
    snippet: str
    explanation: str
    github_url: str
    score: float
    source_type: str


class QueryResponse(BaseModel):
    results: list[QueryResult]
