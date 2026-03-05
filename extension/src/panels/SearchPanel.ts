import * as vscode from "vscode";
import { BackendClient } from "../backendClient";

/**
 * Generates a random nonce for Content Security Policy.
 */
function getNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}

/**
 * WebviewViewProvider for the GitHub RAG sidebar panel.
 * All backend communication is relayed through here (message relay pattern).
 */
export class SearchPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "githubRag.searchView";

    private _view?: vscode.WebviewView;
    private _githubToken: string = "";
    private _openaiKey: string = "";

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _backendClient: BackendClient
    ) { }

    /** Update the stored GitHub token (called on auth change) */
    public setGitHubToken(token: string): void {
        this._githubToken = token;
    }

    /** Post a message to the webview (if visible) */
    public postMessage(message: unknown): void {
        this._view?.webview.postMessage(message);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, "dist")],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the React webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            try {
                await this._handleMessage(message);
            } catch (err: unknown) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                console.error(`[SearchPanel] Error handling message ${message.type}:`, errorMsg);
                this.postMessage({
                    type: "error",
                    requestType: message.type,
                    error: errorMsg,
                });
            }
        });
    }

    private async _handleMessage(message: { type: string;[key: string]: unknown }): Promise<void> {
        // Read OpenAI key from settings on each request (user may update it)
        const config = vscode.workspace.getConfiguration("github-rag");
        this._openaiKey = config.get<string>("openaiApiKey") || "";

        switch (message.type) {
            case "getRepos": {
                const repos = await this._backendClient.getRepos(this._githubToken);
                this.postMessage({ type: "repos", data: repos });
                break;
            }

            case "query": {
                const query = message.query as string;
                const filter = (message.filter as string) || "all";

                if (!this._openaiKey) {
                    this.postMessage({
                        type: "error",
                        requestType: "query",
                        error: "OpenAI API key not configured. Set it in Settings → GitHub RAG → OpenAI API Key.",
                    });
                    return;
                }

                const response = await this._backendClient.query(
                    this._githubToken,
                    this._openaiKey,
                    query,
                    filter as "all" | "personal" | "starred"
                );
                this.postMessage({ type: "results", data: response.results });
                break;
            }

            case "ingest": {
                const repo = message.repo as string;
                const sourceType = message.sourceType as "personal" | "starred";

                if (!this._openaiKey) {
                    this.postMessage({
                        type: "error",
                        requestType: "ingest",
                        error: "OpenAI API key not configured. Set it in Settings → GitHub RAG → OpenAI API Key.",
                    });
                    return;
                }

                const res = await this._backendClient.ingest(
                    this._githubToken,
                    this._openaiKey,
                    repo,
                    sourceType
                );
                this.postMessage({ type: "ingestStarted", jobId: res.job_id, repo });

                // Start polling for progress
                this._pollIngestStatus(res.job_id, repo);
                break;
            }

            case "deleteIndex": {
                const repo = message.repo as string;
                await this._backendClient.deleteIndex(this._githubToken, repo);
                this.postMessage({ type: "indexDeleted", repo });
                break;
            }

            case "copySnippet": {
                const text = message.text as string;
                await vscode.env.clipboard.writeText(text);
                vscode.window.showInformationMessage("Snippet copied to clipboard");
                break;
            }

            case "openGitHub": {
                const url = message.url as string;
                await vscode.env.openExternal(vscode.Uri.parse(url));
                break;
            }

            case "ready": {
                // Webview loaded — send initial state
                this.postMessage({ type: "init", authenticated: !!this._githubToken });
                break;
            }
        }
    }

    private async _pollIngestStatus(jobId: string, repo: string): Promise<void> {
        const poll = async () => {
            try {
                const status = await this._backendClient.getIngestStatus(jobId);
                this.postMessage({ type: "ingestProgress", data: status, repo });

                if (status.status === "running") {
                    setTimeout(poll, 1500);
                }
            } catch {
                // Backend may be down — stop polling
            }
        };
        setTimeout(poll, 1000);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "dist", "webview.js")
        );

        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <title>GitHub RAG</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      color: var(--vscode-foreground);
      background-color: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    #root {
      height: 100vh;
      overflow-y: auto;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
