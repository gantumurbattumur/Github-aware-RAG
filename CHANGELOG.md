# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [Unreleased]

### Added
- Secure OpenAI key handling via VS Code SecretStorage commands.
- CI workflow for extension compile, lint, and VSIX packaging checks.
- Backend sync guardrails with drift detection manifest.
- Publish metadata fields for extension discoverability.

### Changed
- Readme docs updated for publish readiness and release checklist.
- `github-rag.openaiApiKey` is now treated as legacy fallback setting.

## [0.0.1] - 2026-03-05

### Added
- Initial MVP release.
- Semantic search over personal and starred GitHub repositories.
- Local indexing with ChromaDB and SQLite metadata tracking.
