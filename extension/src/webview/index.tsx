import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Acquire VS Code API — must be called exactly once
declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

export const vscode = acquireVsCodeApi();

const container = document.getElementById("root");
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}
