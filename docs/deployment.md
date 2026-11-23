# Documentation deployment (GitHub Pages)

GitHub Pages is used **only for the project documentation**. The Pages workflow does not install Node.js, build or vendor the application, copy application files, or publish the browser app.

The documentation is built with MkDocs and deployed on every push to `main` through `.github/workflows/pages.yml`.

## Published site

- **Documentation:** [https://mrhunsaker.github.io/TactiDiagram/](https://mrhunsaker.github.io/TactiDiagram/)

There is no hosted application at `/app/`. The application source remains in this repository and is run locally by the transcriber or developer. GitHub Pages deployment must not be treated as an application release or distribution mechanism.

## Documentation build

The workflow performs only these steps:

1. Check out the repository.
2. Set up Python.
3. Install the documentation dependencies from `requirements-docs.txt`.
4. Run `mkdocs build --site-dir _site`.
5. Upload the generated documentation site and deploy it to GitHub Pages.

No application dependencies, model weights, vendored browser libraries, or files from `src/` are added to the Pages artifact.

## Preview documentation locally

Edit the Markdown files in `docs/` and, if needed, add pages to `nav` in `mkdocs.yml`.

```bash
pip install -r requirements-docs.txt
mkdocs serve     # http://localhost:8000
```

To verify a production build:

```bash
mkdocs build --site-dir _site
```

## Run the application

The application is separate from the documentation deployment. To run it locally, follow [Getting started](getting-started.md); to install it as a desktop application, follow [Desktop app and packaging](desktop-gui.md). The Pages workflow does not host, publish, or update an application instance.

## Application releases

Application distribution happens through [GitHub Releases](https://github.com/mrhunsaker/TactiDiagram/releases), not Pages. Release tags use the strict `vYYYY.MM.DD` format (for example `v2026.11.22`). The tag is authoritative: the workflow validates it, opens an automated pull request to update `package.json` and `package-lock.json` on the default branch to the corresponding `YYYY.MM.DD` version when they differ, and stamps that version into the artifacts before attaching them to the release. Configure a repository Actions secret named `RELEASE_PR_TOKEN` with a fine-grained token that has Contents (read/write) and Pull requests (read/write) access; the workflow uses it to create or update the synchronization pull request. Merge that PR to keep the default branch metadata aligned. Windows releases include both a portable ZIP and an NSIS installer: the workflow builds the Neutralino executable and `resources.neu` payload, installs NSIS on the Windows runner, compiles `packaging/windows/TactiDiagram.nsi` with the matching `APP_VERSION`, and attaches `TactiDiagram-Setup.exe`. Pull requests run a Windows installer compile check but never publish a release. Everything else on the site remains documentation only.
