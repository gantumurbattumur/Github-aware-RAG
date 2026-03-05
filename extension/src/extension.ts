import * as vscode from "vscode";
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { getGitHubSession, onSessionChanged } from "./auth";
import { BackendClient } from "./backendClient";
import { SearchPanelProvider } from "./panels/SearchPanel";

let serverProcess: ChildProcess | undefined;
let outputChannel: vscode.OutputChannel;
const OPENAI_API_KEY_SECRET = "github-rag.openaiApiKey";

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
        backendClient,
        () => getOpenAIApiKey(context)
    );

    await migrateLegacyOpenAIKeyIfNeeded(context);

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

    context.subscriptions.push(
        vscode.commands.registerCommand("github-rag.setOpenAIApiKey", async () => {
            const value = await vscode.window.showInputBox({
                prompt: "Enter your OpenAI API key",
                placeHolder: "sk-...",
                password: true,
                ignoreFocusOut: true,
            });

            if (!value?.trim()) {
                return;
            }

            await context.secrets.store(OPENAI_API_KEY_SECRET, value.trim());
            outputChannel.appendLine("[Secrets] OpenAI API key saved in SecretStorage");
            vscode.window.showInformationMessage("GitHub RAG: OpenAI API key saved securely.");
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("github-rag.clearOpenAIApiKey", async () => {
            const confirmation = await vscode.window.showWarningMessage(
                "Remove saved OpenAI API key from SecretStorage?",
                { modal: true },
                "Remove"
            );

            if (confirmation !== "Remove") {
                return;
            }

            await context.secrets.delete(OPENAI_API_KEY_SECRET);
            outputChannel.appendLine("[Secrets] OpenAI API key removed from SecretStorage");
            vscode.window.showInformationMessage("GitHub RAG: OpenAI API key removed.");
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

async function getOpenAIApiKey(context: vscode.ExtensionContext): Promise<string> {
    const secret = await context.secrets.get(OPENAI_API_KEY_SECRET);
    if (secret?.trim()) {
        return secret.trim();
    }

    const config = vscode.workspace.getConfiguration("github-rag");
    const legacyValue = config.get<string>("openaiApiKey") || "";
    if (!legacyValue.trim()) {
        return "";
    }

    await context.secrets.store(OPENAI_API_KEY_SECRET, legacyValue.trim());
    outputChannel.appendLine("[Secrets] Migrated OpenAI API key from settings to SecretStorage");
    return legacyValue.trim();
}

async function migrateLegacyOpenAIKeyIfNeeded(context: vscode.ExtensionContext): Promise<void> {
    const stored = await context.secrets.get(OPENAI_API_KEY_SECRET);
    if (stored?.trim()) {
        return;
    }

    const config = vscode.workspace.getConfiguration("github-rag");
    const legacyValue = config.get<string>("openaiApiKey") || "";
    if (!legacyValue.trim()) {
        return;
    }

    await context.secrets.store(OPENAI_API_KEY_SECRET, legacyValue.trim());
    outputChannel.appendLine("[Secrets] Migrated legacy github-rag.openaiApiKey setting to SecretStorage");
}

// ----- Backend process management -----

async function startBackend(
    context: vscode.ExtensionContext,
    port: number
): Promise<void> {
    const config = vscode.workspace.getConfiguration("github-rag");
    const configuredPythonPath = config.get<string>("pythonPath") || ".venv/bin/python";
    const backendDir = resolveBackendDirectory(context);
    const pythonPath = resolvePythonPath(configuredPythonPath, backendDir);

    if (!fs.existsSync(path.join(backendDir, "main.py"))) {
        throw new Error(`Backend files not found in ${backendDir}`);
    }

    if (!fs.existsSync(pythonPath)) {
        outputChannel.appendLine(`[Backend] Python interpreter not found: ${pythonPath}`);
        if (configuredPythonPath === ".venv/bin/python") {
            outputChannel.appendLine("[Backend] Bootstrapping local backend environment via uv sync --frozen...");
            await ensureBackendEnvironment(backendDir);
        }
    }

    if (!fs.existsSync(pythonPath)) {
        throw new Error(
            `Python interpreter not found: ${pythonPath}. ` +
            `Set github-rag.pythonPath to a valid interpreter, or install uv and run 'uv sync --frozen' in ${backendDir}`
        );
    }

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

function resolveBackendDirectory(context: vscode.ExtensionContext): string {
    const bundledBackend = path.join(context.extensionPath, "backend");
    const monorepoBackend = path.join(context.extensionPath, "..", "backend");

    if (fs.existsSync(path.join(bundledBackend, "main.py"))) {
        return bundledBackend;
    }

    if (fs.existsSync(path.join(monorepoBackend, "main.py"))) {
        return monorepoBackend;
    }

    return bundledBackend;
}

function resolvePythonPath(configValue: string, backendDir: string): string {
    if (path.isAbsolute(configValue)) {
        return configValue;
    }
    return path.join(backendDir, configValue);
}

async function ensureBackendEnvironment(backendDir: string): Promise<void> {
    const uvResult = await runCommand("uv", ["--version"], backendDir);
    if (uvResult.exitCode !== 0) {
        throw new Error("uv is required for first-time backend setup, but it was not found on PATH");
    }

    const syncResult = await runCommand("uv", ["sync", "--frozen"], backendDir);
    if (syncResult.exitCode !== 0) {
        throw new Error(
            `Failed to set up backend environment via uv sync. ${syncResult.stderr || syncResult.stdout}`
        );
    }
}

async function runCommand(
    command: string,
    args: string[],
    cwd: string
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const proc = spawn(command, args, {
            cwd,
            env: { ...process.env, PYTHONUNBUFFERED: "1" },
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (data: Buffer) => {
            stdout += data.toString();
            const text = data.toString().trim();
            if (text) {
                outputChannel.appendLine(`[Setup stdout] ${text}`);
            }
        });

        proc.stderr?.on("data", (data: Buffer) => {
            stderr += data.toString();
            const text = data.toString().trim();
            if (text) {
                outputChannel.appendLine(`[Setup stderr] ${text}`);
            }
        });

        proc.on("error", (error) => {
            resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${error.message}` });
        });

        proc.on("close", (exitCode) => {
            resolve({ exitCode, stdout, stderr });
        });
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
