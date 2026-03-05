import * as vscode from "vscode";

/**
 * Get a GitHub OAuth session via VS Code's built-in authentication provider.
 * Prompts the user to sign in if no session exists.
 */
export async function getGitHubSession(): Promise<vscode.AuthenticationSession> {
    const session = await vscode.authentication.getSession(
        "github",
        ["repo", "read:user"],
        { createIfNone: true }
    );
    return session;
}

/**
 * Silently check for an existing GitHub session without prompting.
 */
export async function getGitHubSessionSilent(): Promise<vscode.AuthenticationSession | undefined> {
    return vscode.authentication.getSession("github", ["repo", "read:user"], {
        silent: true,
    });
}

/**
 * Listen for authentication session changes (sign-in / sign-out).
 */
export function onSessionChanged(
    callback: (e: vscode.AuthenticationSessionsChangeEvent) => void
): vscode.Disposable {
    return vscode.authentication.onDidChangeSessions((e) => {
        if (e.provider.id === "github") {
            callback(e);
        }
    });
}
