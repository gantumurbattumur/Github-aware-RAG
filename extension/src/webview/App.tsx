import React, { useState, useEffect, useCallback } from "react";
import { vscode } from "./index";
import SearchBar from "./components/SearchBar";
import ResultCard from "./components/ResultCard";
import RepoList from "./components/RepoList";

interface QueryResult {
    repo: string;
    file_path: string;
    snippet: string;
    explanation: string;
    github_url: string;
    score: number;
    source_type: string;
}

interface RepoInfo {
    full_name: string;
    description: string | null;
    source_type: "personal" | "starred";
    html_url: string;
    language: string | null;
    updated_at: string;
}

interface IngestProgress {
    job_id: string;
    files_done: number;
    files_total: number;
    status: "running" | "done" | "error";
    error?: string;
}

type SourceFilter = "all" | "personal" | "starred";

export default function App() {
    const [authenticated, setAuthenticated] = useState(false);
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<SourceFilter>("all");
    const [results, setResults] = useState<QueryResult[]>([]);
    const [repos, setRepos] = useState<RepoInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastSearchedQuery, setLastSearchedQuery] = useState("");
    const [indexingRepos, setIndexingRepos] = useState<Record<string, IngestProgress>>({});
    const [indexedRepos, setIndexedRepos] = useState<Set<string>>(new Set());

    // Handle messages from the extension host
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const msg = event.data;
            switch (msg.type) {
                case "init":
                    setAuthenticated(msg.authenticated);
                    if (msg.authenticated) {
                        vscode.postMessage({ type: "getRepos" });
                    }
                    break;
                case "repos":
                    setRepos(msg.data);
                    break;
                case "results":
                    setResults(msg.data);
                    setLoading(false);
                    break;
                case "ingestStarted":
                    setIndexingRepos((prev) => ({
                        ...prev,
                        [msg.repo]: { job_id: msg.jobId, files_done: 0, files_total: 0, status: "running" },
                    }));
                    break;
                case "ingestProgress":
                    setIndexingRepos((prev) => ({ ...prev, [msg.repo]: msg.data }));
                    if (msg.data.status === "done") {
                        setIndexedRepos((prev) => new Set(prev).add(msg.repo));
                        // Remove from indexing after a brief delay
                        setTimeout(() => {
                            setIndexingRepos((prev) => {
                                const next = { ...prev };
                                delete next[msg.repo];
                                return next;
                            });
                        }, 1500);
                    }
                    break;
                case "indexDeleted":
                    setIndexedRepos((prev) => {
                        const next = new Set(prev);
                        next.delete(msg.repo);
                        return next;
                    });
                    break;
                case "error":
                    setError(msg.error);
                    setLoading(false);
                    break;
                case "triggerReindex":
                    // Could show a UI to pick which repo to reindex
                    break;
            }
        };

        window.addEventListener("message", handler);

        // Tell the extension we're ready
        vscode.postMessage({ type: "ready" });

        return () => window.removeEventListener("message", handler);
    }, []);

    const handleSearch = useCallback(
        (searchQuery: string) => {
            const normalizedQuery = searchQuery.trim();
            if (!normalizedQuery) return;
            setLoading(true);
            setError(null);
            setResults([]);
            setLastSearchedQuery(normalizedQuery);
            vscode.postMessage({ type: "query", query: normalizedQuery, filter });
        },
        [filter]
    );

    const handleRefresh = useCallback(() => {
        const queryToRun = query.trim() || lastSearchedQuery;
        if (!queryToRun) {
            return;
        }
        handleSearch(queryToRun);
    }, [query, lastSearchedQuery, handleSearch]);

    const handleClearResults = useCallback(() => {
        setResults([]);
        setError(null);
        setLoading(false);
        setLastSearchedQuery("");
    }, []);

    const handleIngest = useCallback((repoFullName: string, sourceType: "personal" | "starred") => {
        vscode.postMessage({ type: "ingest", repo: repoFullName, sourceType });
    }, []);

    const handleDeleteIndex = useCallback((repoFullName: string) => {
        vscode.postMessage({ type: "deleteIndex", repo: repoFullName });
    }, []);

    const handleCopy = useCallback((text: string) => {
        vscode.postMessage({ type: "copySnippet", text });
    }, []);

    const handleOpenGitHub = useCallback((url: string) => {
        vscode.postMessage({ type: "openGitHub", url });
    }, []);

    const filteredResults =
        filter === "all"
            ? results
            : results.filter((result) => result.source_type === filter);

    if (!authenticated) {
        return (
            <div style={styles.container}>
                <div style={styles.welcome}>
                    <h2 style={styles.title}>GitHub RAG</h2>
                    <p style={styles.subtitle}>
                        Search across your coding history using natural language.
                    </p>
                    <p style={styles.hint}>
                        Please sign in with GitHub to get started. VS Code should prompt you automatically.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div style={styles.container}>
            <SearchBar
                query={query}
                filter={filter}
                loading={loading}
                canRefresh={!!(query.trim() || lastSearchedQuery)}
                canClear={results.length > 0 || !!error || !!lastSearchedQuery}
                onQueryChange={setQuery}
                onFilterChange={setFilter}
                onSearch={handleSearch}
                onRefresh={handleRefresh}
                onClear={handleClearResults}
            />

            {error && <div style={styles.error}>{error}</div>}

            {filteredResults.length > 0 && (
                <div style={styles.section}>
                    <div style={styles.sectionHeader}>RESULTS</div>
                    {filteredResults.map((result, idx) => (
                        <ResultCard
                            key={`${result.repo}-${result.file_path}-${idx}`}
                            result={result}
                            onCopy={handleCopy}
                            onOpenGitHub={handleOpenGitHub}
                        />
                    ))}
                </div>
            )}

            {loading && (
                <div style={styles.loading}>Searching...</div>
            )}

            {!loading && lastSearchedQuery && !error && filteredResults.length === 0 && (
                <div style={styles.empty}>
                    {results.length === 0
                        ? "No results found. Try a different query."
                        : `No ${filter} results for this query.`}
                </div>
            )}

            <div style={styles.section}>
                <RepoList
                    repos={repos}
                    indexedRepos={indexedRepos}
                    indexingRepos={indexingRepos}
                    onIngest={handleIngest}
                    onDelete={handleDeleteIndex}
                />
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    container: {
        padding: "8px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    welcome: {
        textAlign: "center",
        padding: "32px 16px",
    },
    title: {
        margin: "0 0 8px",
        fontSize: "16px",
        fontWeight: 600,
    },
    subtitle: {
        margin: "0 0 16px",
        opacity: 0.8,
    },
    hint: {
        margin: 0,
        opacity: 0.6,
        fontSize: "12px",
    },
    section: {
        marginTop: "4px",
    },
    sectionHeader: {
        fontSize: "11px",
        fontWeight: 600,
        textTransform: "uppercase" as const,
        opacity: 0.6,
        marginBottom: "6px",
        letterSpacing: "0.5px",
    },
    error: {
        padding: "8px",
        borderRadius: "4px",
        backgroundColor: "var(--vscode-inputValidation-errorBackground)",
        border: "1px solid var(--vscode-inputValidation-errorBorder)",
        fontSize: "12px",
    },
    loading: {
        textAlign: "center",
        padding: "16px",
        opacity: 0.7,
    },
    empty: {
        textAlign: "center",
        padding: "16px",
        opacity: 0.5,
        fontSize: "12px",
    },
};
