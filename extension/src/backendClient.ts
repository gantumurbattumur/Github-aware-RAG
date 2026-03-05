/**
 * HTTP client for communicating with the FastAPI backend.
 * All requests go to http://127.0.0.1:<port> with auth headers.
 */

export interface RepoInfo {
    full_name: string;
    description: string | null;
    source_type: "personal" | "starred";
    html_url: string;
    language: string | null;
    updated_at: string;
}

export interface IngestResponse {
    status: string;
    job_id: string;
}

export interface IngestStatus {
    job_id: string;
    files_done: number;
    files_total: number;
    status: "running" | "done" | "error";
    error?: string;
}

export interface QueryResult {
    repo: string;
    file_path: string;
    snippet: string;
    explanation: string;
    github_url: string;
    score: number;
    source_type: string;
}

export interface QueryResponse {
    results: QueryResult[];
}

export class BackendClient {
    private baseUrl: string;

    constructor(port: number) {
        this.baseUrl = `http://127.0.0.1:${port}`;
    }

    private async request<T>(
        path: string,
        options: {
            method?: string;
            headers?: Record<string, string>;
            body?: unknown;
        } = {}
    ): Promise<T> {
        const { method = "GET", headers = {}, body } = options;

        const res = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                "Content-Type": "application/json",
                ...headers,
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "Unknown error");
            throw new Error(`Backend ${method} ${path} failed (${res.status}): ${text}`);
        }

        return res.json() as Promise<T>;
    }

    /** Check if the backend is alive */
    async health(): Promise<{ status: string }> {
        return this.request("/health");
    }

    /** Fetch personal + starred repos from GitHub via the backend */
    async getRepos(githubToken: string): Promise<RepoInfo[]> {
        return this.request("/repos", {
            headers: { "X-GitHub-Token": githubToken },
        });
    }

    /** Start ingestion for a single repo */
    async ingest(
        githubToken: string,
        openaiKey: string,
        repoFullName: string,
        sourceType: "personal" | "starred"
    ): Promise<IngestResponse> {
        return this.request("/ingest", {
            method: "POST",
            headers: {
                "X-GitHub-Token": githubToken,
                "X-OpenAI-Key": openaiKey,
            },
            body: { repo_full_name: repoFullName, source_type: sourceType },
        });
    }

    /** Check ingestion progress */
    async getIngestStatus(jobId: string): Promise<IngestStatus> {
        return this.request(`/ingest/status/${jobId}`);
    }

    /** Run a semantic query */
    async query(
        githubToken: string,
        openaiKey: string,
        queryText: string,
        sourceFilter: "all" | "personal" | "starred" = "all"
    ): Promise<QueryResponse> {
        return this.request("/query", {
            method: "POST",
            headers: {
                "X-GitHub-Token": githubToken,
                "X-OpenAI-Key": openaiKey,
            },
            body: { query: queryText, source_filter: sourceFilter },
        });
    }

    /** Delete all indexed data for a repo */
    async deleteIndex(
        githubToken: string,
        repoFullName: string
    ): Promise<{ status: string }> {
        return this.request(`/index/${encodeURIComponent(repoFullName)}`, {
            method: "DELETE",
            headers: { "X-GitHub-Token": githubToken },
        });
    }
}
