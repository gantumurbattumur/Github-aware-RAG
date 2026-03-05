import React from "react";

interface QueryResult {
    repo: string;
    file_path: string;
    snippet: string;
    explanation: string;
    github_url: string;
    score: number;
    source_type: string;
}

interface ResultCardProps {
    result: QueryResult;
    onCopy: (text: string) => void;
    onOpenGitHub: (url: string) => void;
}

export default function ResultCard({ result, onCopy, onOpenGitHub }: ResultCardProps) {
    return (
        <div style={styles.card}>
            <div style={styles.header}>
                <span style={styles.repoIcon}>📁</span>
                <span style={styles.repoName}>{result.repo}</span>
                <span style={styles.badge}>{result.source_type}</span>
            </div>
            <div style={styles.filePath}>{result.file_path}</div>
            <pre style={styles.snippet}>{result.snippet}</pre>
            {result.explanation && (
                <div style={styles.explanation}>{result.explanation}</div>
            )}
            <div style={styles.actions}>
                <button
                    style={styles.actionButton}
                    onClick={() => onCopy(result.snippet)}
                    title="Copy snippet to clipboard"
                >
                    Copy snippet
                </button>
                <button
                    style={styles.actionButton}
                    onClick={() => onOpenGitHub(result.github_url)}
                    title="Open file on GitHub"
                >
                    Open on GitHub
                </button>
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    card: {
        padding: "8px 10px",
        marginBottom: "8px",
        borderRadius: "4px",
        backgroundColor: "var(--vscode-editor-background)",
        border: "1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent))",
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        marginBottom: "4px",
    },
    repoIcon: {
        fontSize: "13px",
    },
    repoName: {
        fontWeight: 600,
        fontSize: "13px",
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    badge: {
        fontSize: "10px",
        padding: "1px 6px",
        borderRadius: "8px",
        backgroundColor: "var(--vscode-badge-background)",
        color: "var(--vscode-badge-foreground)",
        textTransform: "lowercase" as const,
    },
    filePath: {
        fontSize: "11px",
        opacity: 0.7,
        marginBottom: "6px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    snippet: {
        margin: "0 0 6px",
        padding: "6px 8px",
        borderRadius: "3px",
        backgroundColor: "var(--vscode-textCodeBlock-background)",
        fontSize: "12px",
        fontFamily: "var(--vscode-editor-font-family, monospace)",
        overflow: "auto",
        maxHeight: "150px",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
    },
    explanation: {
        fontSize: "11px",
        opacity: 0.8,
        marginBottom: "6px",
        fontStyle: "italic",
    },
    actions: {
        display: "flex",
        gap: "6px",
    },
    actionButton: {
        padding: "3px 8px",
        border: "none",
        borderRadius: "2px",
        backgroundColor: "var(--vscode-button-secondaryBackground)",
        color: "var(--vscode-button-secondaryForeground)",
        fontSize: "11px",
        cursor: "pointer",
        fontFamily: "var(--vscode-font-family)",
    },
};
