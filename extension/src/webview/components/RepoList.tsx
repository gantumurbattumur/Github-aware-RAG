import React from "react";

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

interface RepoListProps {
    repos: RepoInfo[];
    indexedRepos: Set<string>;
    indexingRepos: Record<string, IngestProgress>;
    onIngest: (repoFullName: string, sourceType: "personal" | "starred") => void;
    onDelete: (repoFullName: string) => void;
}

export default function RepoList({
    repos,
    indexedRepos,
    indexingRepos,
    onIngest,
    onDelete,
}: RepoListProps) {
    if (repos.length === 0) {
        return (
            <div style={styles.empty}>
                <div style={styles.sectionHeader}>YOUR REPOS</div>
                <p style={styles.hint}>Loading repos...</p>
            </div>
        );
    }

    const personal = repos.filter((r) => r.source_type === "personal");
    const starred = repos.filter((r) => r.source_type === "starred");

    return (
        <div>
            <div style={styles.sectionHeader}>
                YOUR REPOS
                <span style={styles.count}>({repos.length})</span>
            </div>

            {personal.length > 0 && (
                <div style={styles.group}>
                    <div style={styles.groupLabel}>Personal</div>
                    {personal.map((repo) => (
                        <RepoRow
                            key={repo.full_name}
                            repo={repo}
                            isIndexed={indexedRepos.has(repo.full_name)}
                            progress={indexingRepos[repo.full_name]}
                            onIngest={onIngest}
                            onDelete={onDelete}
                        />
                    ))}
                </div>
            )}

            {starred.length > 0 && (
                <div style={styles.group}>
                    <div style={styles.groupLabel}>Starred</div>
                    {starred.map((repo) => (
                        <RepoRow
                            key={repo.full_name}
                            repo={repo}
                            isIndexed={indexedRepos.has(repo.full_name)}
                            progress={indexingRepos[repo.full_name]}
                            onIngest={onIngest}
                            onDelete={onDelete}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function RepoRow({
    repo,
    isIndexed,
    progress,
    onIngest,
    onDelete,
}: {
    repo: RepoInfo;
    isIndexed: boolean;
    progress?: IngestProgress;
    onIngest: (name: string, type: "personal" | "starred") => void;
    onDelete: (name: string) => void;
}) {
    const isIndexing = progress && progress.status === "running";

    let statusIcon = "○";
    let statusText = "not indexed";
    if (isIndexed) {
        statusIcon = "✅";
        statusText = "indexed";
    } else if (isIndexing) {
        statusIcon = "⏳";
        statusText = `indexing ${progress.files_done}/${progress.files_total}`;
    } else if (progress?.status === "error") {
        statusIcon = "❌";
        statusText = "error";
    } else if (progress?.status === "done") {
        statusIcon = "✅";
        statusText = "indexed";
    }

    return (
        <div style={styles.row}>
            <span style={styles.statusIcon}>{statusIcon}</span>
            <div style={styles.repoInfo}>
                <div style={styles.repoName}>{repo.full_name.split("/")[1]}</div>
                {repo.language && <span style={styles.lang}>{repo.language}</span>}
            </div>
            <span style={styles.statusText}>{statusText}</span>
            <div style={styles.rowActions}>
                {!isIndexed && !isIndexing && (
                    <button
                        style={styles.smallBtn}
                        onClick={() => onIngest(repo.full_name, repo.source_type)}
                        title="Index this repo"
                    >
                        Index
                    </button>
                )}
                {isIndexed && (
                    <button
                        style={styles.smallBtn}
                        onClick={() => onDelete(repo.full_name)}
                        title="Remove index"
                    >
                        Remove
                    </button>
                )}
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    sectionHeader: {
        fontSize: "11px",
        fontWeight: 600,
        textTransform: "uppercase" as const,
        opacity: 0.6,
        marginBottom: "6px",
        letterSpacing: "0.5px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
    },
    count: {
        fontWeight: 400,
        opacity: 0.5,
    },
    group: {
        marginBottom: "8px",
    },
    groupLabel: {
        fontSize: "11px",
        opacity: 0.5,
        margin: "4px 0 2px 0",
        fontStyle: "italic",
    },
    row: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "3px 4px",
        borderRadius: "3px",
        fontSize: "12px",
    },
    statusIcon: {
        fontSize: "12px",
        flexShrink: 0,
        width: "16px",
        textAlign: "center",
    },
    repoInfo: {
        flex: 1,
        display: "flex",
        alignItems: "center",
        gap: "4px",
        overflow: "hidden",
    },
    repoName: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    lang: {
        fontSize: "10px",
        opacity: 0.5,
    },
    statusText: {
        fontSize: "10px",
        opacity: 0.5,
        flexShrink: 0,
    },
    rowActions: {
        flexShrink: 0,
    },
    smallBtn: {
        padding: "1px 6px",
        border: "none",
        borderRadius: "2px",
        backgroundColor: "var(--vscode-button-secondaryBackground)",
        color: "var(--vscode-button-secondaryForeground)",
        fontSize: "10px",
        cursor: "pointer",
        fontFamily: "var(--vscode-font-family)",
    },
    empty: {},
    hint: {
        fontSize: "12px",
        opacity: 0.5,
        margin: "8px 0",
    },
};
