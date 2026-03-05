import React, { useCallback } from "react";

type SourceFilter = "all" | "personal" | "starred";

interface SearchBarProps {
    query: string;
    filter: SourceFilter;
    loading: boolean;
    onQueryChange: (q: string) => void;
    onFilterChange: (f: SourceFilter) => void;
    onSearch: (q: string) => void;
}

export default function SearchBar({
    query,
    filter,
    loading,
    onQueryChange,
    onFilterChange,
    onSearch,
}: SearchBarProps) {
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter" && !loading) {
                onSearch(query);
            }
        },
        [query, loading, onSearch]
    );

    return (
        <div style={styles.wrapper}>
            <div style={styles.inputRow}>
                <input
                    type="text"
                    placeholder="Search your repos..."
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={loading}
                    style={styles.input}
                />
            </div>
            <div style={styles.filterRow}>
                <span style={styles.filterLabel}>Filter:</span>
                {(["all", "personal", "starred"] as SourceFilter[]).map((f) => (
                    <button
                        key={f}
                        onClick={() => onFilterChange(f)}
                        style={{
                            ...styles.filterButton,
                            ...(filter === f ? styles.filterButtonActive : {}),
                        }}
                    >
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                ))}
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    wrapper: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
    },
    inputRow: {
        display: "flex",
    },
    input: {
        flex: 1,
        padding: "6px 10px",
        border: "1px solid var(--vscode-input-border, transparent)",
        borderRadius: "2px",
        backgroundColor: "var(--vscode-input-background)",
        color: "var(--vscode-input-foreground)",
        fontFamily: "var(--vscode-font-family)",
        fontSize: "13px",
        outline: "none",
    },
    filterRow: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
    },
    filterLabel: {
        fontSize: "11px",
        opacity: 0.6,
        marginRight: "4px",
    },
    filterButton: {
        padding: "2px 8px",
        border: "1px solid var(--vscode-button-secondaryBorder, var(--vscode-input-border, transparent))",
        borderRadius: "2px",
        backgroundColor: "var(--vscode-button-secondaryBackground)",
        color: "var(--vscode-button-secondaryForeground)",
        fontSize: "11px",
        cursor: "pointer",
        fontFamily: "var(--vscode-font-family)",
    },
    filterButtonActive: {
        backgroundColor: "var(--vscode-button-background)",
        color: "var(--vscode-button-foreground)",
        border: "1px solid var(--vscode-button-background)",
    },
};
