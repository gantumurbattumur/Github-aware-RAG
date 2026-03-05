// @ts-check
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    outfile: "dist/extension.js",
    external: ["vscode"],
    minify: production,
    sourcemap: !production,
    logLevel: "info",
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
    entryPoints: ["src/webview/index.tsx"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2021",
    outfile: "dist/webview.js",
    minify: production,
    sourcemap: !production,
    logLevel: "info",
    loader: {
        ".tsx": "tsx",
        ".ts": "ts",
        ".css": "css",
    },
};

async function main() {
    if (watch) {
        const [extCtx, webCtx] = await Promise.all([
            esbuild.context(extensionConfig),
            esbuild.context(webviewConfig),
        ]);
        await Promise.all([extCtx.watch(), webCtx.watch()]);
        console.log("[watch] Build started — watching for changes...");
    } else {
        await Promise.all([
            esbuild.build(extensionConfig),
            esbuild.build(webviewConfig),
        ]);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
