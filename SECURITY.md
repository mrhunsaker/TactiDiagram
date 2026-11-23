# Security Policy

## Supported versions

Only the latest version on `main` is supported; releases are frequent.

## Reporting a vulnerability

TactiDiagram is a static, client-only application, which keeps the attack surface small: no server, no accounts, no user data storage. Issues that would still matter include XSS through file content rendered in previews, path handling in the dev server (`scripts/serve.mjs`), and dependency vulnerabilities in the vendored model runtimes.

- **Do not open a public issue** for a suspected vulnerability.
- Email [github@main.hunsakerweb.com](mailto:github@main.hunsakerweb.com), or use GitHub's private security advisory feature on this repository.
- Include a description, reproduction steps, and affected files. Please allow a reasonable time for a fix before any public disclosure.

## Dependency notes

Model weights and browser libraries are fetched at build time by `scripts/vendor.mjs` from pinned upstream locations (Hugging Face, ModelScope/RapidOCR, npm packages) and served from the site itself; no user data is sent to those sources at runtime. Report concerns about a vendored component via any of the routes above.

Vendored code and model assets (`src/vendor/**`, `src/models/**`), plus generated precomputed diagrams, are excluded from Code scanning via `.github/codeql-config.yml`; findings in those dependency sources should be raised with the upstream project or via the routes above. The vendor script also patches out the one `Math.random()` usage in the vendored Tesseract.js bundle (a non-cryptographic task-ID generator); the patch reruns on every `npm run vendor`.
