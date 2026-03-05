import * as vscode from "vscode";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import { getGitHubSession, onSessionChanged } from "./auth";
import { BackendClient } from "./backendClient";
import { SearchPanelProvider } from "./panels/SearchPanel";

let serverProcess: ChildProcess | undefined;
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    outputChannel = vscode.window.createOutputChannel("GitHub RAG");
    context.subscriptions.push(outputChannel);

    const config = vscode.workspace.getConfiguration("github-rag");
    const port = config.get<number>("backendPort") || 8747;

    // Create the backend HTTP client
    const backendClient = new BackendClient(port);

    // Create the sidebar webview provider
    const searchPanelProvider = new SearchPanelProvider(
        context.extensionUri,
        backendClient
    );

    // Register the webview view provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SearchPanelProvider.viewType,
            searchPanelProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // Register the openPanel command — reveals the sidebar
    context.subscriptions.push(
        vscode.commands.registerCommand("github-rag.openPanel", () => {
            vscode.commands.executeCommand("githubRag.searchView.focus");
        })
    );

    // Register the reindex command
    context.subscriptions.push(
        vscode.commands.registerCommand("github-rag.reindex", () => {
            searchPanelProvider.postMessage({ type: "triggerReindex" });
        })
    );

    // ----- Authenticate with GitHub -----
    try {
        const session = await getGitHubSession();
        searchPanelProvider.setGitHubToken(session.accessToken);
        outputChannel.appendLine(`[Auth] Signed in as ${session.account.label}`);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputChannel.appendLine(`[Auth] GitHub sign-in declined or failed: ${msg}`);
        vscode.window.showWarningMessage(
            "GitHub RAG: Sign in with GitHub to get started. Use the command palette → 'GitHub RAG: Open Search Panel'."
        );
    }

    // Listen for auth changes (re-login, sign-out)
    context.subscriptions.push(
        onSessionChanged(async () => {
            try {
                const session = await getGitHubSession();
                searchPanelProvider.setGitHubToken(session.accessToken);
                searchPanelProvider.postMessage({ type: "init", authenticated: true });
                outputChannel.appendLine(`[Auth] Session updated: ${session.account.label}`);
            } catch {
                searchPanelProvider.setGitHubToken("");
                searchPanelProvider.postMessage({ type: "init", authenticated: false });
            }
        })
    );

    // ----- Start the Python backend -----
    try {
        await startBackend(context, port);
        outputChannel.appendLine(`[Backend] Server is running on port ${port}`);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputChannel.appendLine(`[Backend] Failed to start: ${msg}`);
        vscode.window.showErrorMessage(
            `GitHub RAG: Failed to start backend server. ${msg}. Check the "GitHub RAG" output channel for details.`
        );
    }
}

export function deactivate(): void {
    stopBackend();
}

// ----- Backend process management -----

async function startBackend(
    context: vscode.ExtensionContext,
    port: number
): Promise<void> {
    const config = vscode.workspace.getConfiguration("github-rag");
    const pythonPath = config.get<string>("pythonPath") || ".venv/bin/python";
    const backendDir = path.join(context.extensionPath, "..", "backend");

    outputChannel.appendLine(`[Backend] Starting: ${pythonPath} -m uvicorn main:app --host 127.0.0.1 --port ${port}`);
    outputChannel.appendLine(`[Backend] Working directory: ${backendDir}`);

    return new Promise<void>((resolve, reject) => {
        serverProcess = spawn(
            pythonPath,
            ["-u", "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(port)],
            {
                cwd: backendDir,
                env: { ...process.env, PYTHONUNBUFFERED: "1" },
                stdio: ["pipe", "pipe", "pipe"],
            }
        );

        let startupResolved = false;

        serverProcess.stdout?.on("data", (data: Buffer) => {
            const text = data.toString().trim();
            if (text) {
                outputChannel.appendLine(`[Backend stdout] ${text}`);
            }
        });

        serverProcess.stderr?.on("data", (data: Buffer) => {
            const text = data.toString().trim();
            if (text) {
                outputChannel.appendLine(`[Backend stderr] ${text}`);
            }
        });

        serverProcess.on("error", (err) => {
            if (!startupResolved) {
                startupResolved = true;
                reject(new Error(`Failed to spawn Python process: ${err.message}`));
            }
        });

        serverProcess.on("exit", (code, signal) => {
            outputChannel.appendLine(
                `[Backend] Process exited (code=${code}, signal=${signal})`
            );
            serverProcess = undefined;
            if (!startupResolved) {
                startupResolved = true;
                reject(new Error(`Backend exited prematurely with code ${code}`));
            }
        });

        // Poll /health to detect readiness (more reliable than parsing stdout)
        const backendClient = new BackendClient(port);
        const maxAttempts = 30;
        let attempt = 0;

        const pollHealth = () => {
            attempt++;
            backendClient
                .health()
                .then(() => {
                    if (!startupResolved) {
                        startupResolved = true;
                        resolve();
                    }
                })
                .catch(() => {
                    if (attempt < maxAttempts && !startupResolved) {
                        setTimeout(pollHealth, 500);
                    } else if (!startupResolved) {
                        startupResolved = true;
                        reject(new Error("Backend did not respond to /health within 15 seconds"));
                    }
                });
        };

        // Start polling after a brief delay to let the process start
        setTimeout(pollHealth, 500);
    });
}

function stopBackend(): void {
    if (serverProcess) {
        outputChannel?.appendLine("[Backend] Sending SIGTERM...");
        serverProcess.kill("SIGTERM");

        const proc = serverProcess;
        setTimeout(() => {
            if (proc && !proc.killed) {
                outputChannel?.appendLine("[Backend] Forcing SIGKILL...");
                proc.kill("SIGKILL");
            }
        }, 5000);

        serverProcess = undefined;
    }
}
