# Agents

## Cursor Cloud specific instructions

### Overview
This is the **model-viewer** monorepo — a web component library for displaying interactive 3D models (glTF/GLB). It is a London Dynamics fork published as `@london-dynamics/model-viewer`. The repo uses **npm workspaces** with 5 packages under `packages/`.

### Node.js version
The project requires **Node.js 18** (see `.nvmrc`). Load it via:
```
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"
```

### Key commands
See the root `README.md` for all commands. Quick reference:
- **Install deps**: `npm install` (uses npm workspaces; runs `prepare` scripts that create symlinks and fetch git submodules)
- **Build**: `npm run build` (builds all workspaces)
- **Test**: `npm run test` or `npm run test:ci` (runs tests across workspaces)
- **Serve docs**: `npm run serve` (serves static files on port 8080; browse `/packages/modelviewer.dev/` for docs, `/packages/space-opera/editor/` for the editor)
- **Lint**: `npm run lint` (currently a no-op — `.eslintignore` excludes all packages)

### Known issues at HEAD
- `packages/model-viewer` has a **pre-existing build failure**: `src/features/ld-environment.ts` was deleted but still imported in `src/model-viewer.ts`. This prevents `tsc` from completing for this package. The other 4 packages (`model-viewer-effects`, `modelviewer.dev`, `render-fidelity-tools`, `space-opera`) build and test normally.
- The `lib/` directory in `model-viewer` is committed with stale compiled output, so the web test runner can run some tests, but many fail because `lib/features/ld-environment.js` is missing.

### Testing notes
- Tests use `@web/test-runner` with **Playwright** browsers (Chromium, Firefox, WebKit).
- **WebKit does not work** on Ubuntu 24.04 in this environment due to ICU library version mismatch (`uidna_nameToUnicode_70` symbol missing). Use Chromium (and optionally Firefox) for tests.
- To run tests for a single package: `npm run test --workspace=<package-name>` or `cd packages/<name> && npx web-test-runner --playwright --browsers chromium`
- Puppeteer is a dependency of `render-fidelity-tools`. Set `PUPPETEER_SKIP_DOWNLOAD=1` during `npm install` to avoid a long/hanging browser download; the Puppeteer browsers from a previous install are cached at `~/.cache/puppeteer/`.

### Serving the app
`npm run serve` starts `http-server` at the repo root on port 8080. Key routes:
- Docs site: `http://localhost:8080/packages/modelviewer.dev/`
- Loading examples: `http://localhost:8080/packages/modelviewer.dev/examples/loading/`
- Model editor: `http://localhost:8080/packages/space-opera/editor/`

### Pre-commit hook
The repo has a Husky pre-commit hook (`scripts/pre-commit.sh`) that auto-formats staged `.ts` files with `clang-format`. Husky v7 may not auto-install hooks; you may need to run `npx husky install` once.
