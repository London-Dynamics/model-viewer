# Agents

## LD example UI guidelines

LD examples under `packages/modelviewer.dev/examples/ld_*/` use a shared component stylesheet based on [Tailwind UI](https://tailwindui.com/) patterns.

### Required assets

Every LD example page should include in `<head>`:

```html
<link type="text/css" href="../../styles/examples.css" rel="stylesheet" />
<link type="text/css" href="../../styles/docs.css" rel="stylesheet" />
<style type="text/tailwindcss"></style>
<script src="../../styles/ld-ui-loader.js" data-href="../../styles/ld-ui.css"></script>
<script src="https://unpkg.com/@tailwindcss/browser@4"></script>
```

Set `<body class="ld">` so default docs-site button/select/grid overrides in `examples.css` do not clash with Tailwind controls.

The empty `<style type="text/tailwindcss">` plus `ld-ui-loader.js` is required because the Tailwind Play CDN only processes inline `text/tailwindcss` blocks — it does not compile external `<link>` tags or `@import` file paths. The loader synchronously fetches `ld-ui.css` into that block before the Play CDN script runs.

### When to use

Use `ld-*` classes whenever an LD example includes interactive controls for testing (sliders, buttons, forms, toggles) or viewport status readouts.

Prefer `ld-*` classes over long inline Tailwind utility strings. Add new component classes to [`packages/modelviewer.dev/styles/ld-ui.css`](packages/modelviewer.dev/styles/ld-ui.css) when a pattern repeats across examples.

### Conventions

- **Tailwind UI** is the visual source of truth
- **Light mode only** — no `dark:*` classes
- **Blue accents** (`blue-600`, `blue-500`) for focus and active states — never indigo
- **No Heroicons** — use unicode (e.g. `▾` for select chevrons) or emoji for icons
- **Range sliders** — use `.ld-range`; do not restyle unless there is a repo-wide design change

### Layout patterns

**Control docks** (bottom panels with form controls):

```html
<div class="ld-panel">
  <div class="ld-card">
    <div class="ld-card-body">
      <h3 class="ld-panel-title">Control Panel</h3>
      <div class="ld-sections">…</div>
    </div>
  </div>
</div>
```

**Status readouts** (semi-transparent HUD overlays in viewport corners):

```html
<div class="ld-hud ld-hud-top-right">undo: 0 | redo: 0</div>
<div class="ld-hud ld-hud-top-left ld-hud-passive">transform: idle</div>
```

Add `.ld-hud-passive` when the overlay must not block viewport interaction. Add `.ld-hud-narrow` to cap width (`max-w-xs`).

### Class reference

| Class | Purpose |
|---|---|
| `.ld-panel` | Bottom overlay wrapper |
| `.ld-card` / `.ld-card-body` / `.ld-card-toolbar` | White card shell and padding variants |
| `.ld-sections` / `.ld-section-title` | Divided sections inside a card |
| `.ld-axis-grid` / `.ld-field-row` / `.ld-field` | Grid and row layout for controls |
| `.ld-hud` + `.ld-hud-top-left` etc. | Viewport status readout overlays |
| `.ld-hud-passive` / `.ld-hud-narrow` | HUD modifiers |
| `.ld-panel-title` / `.ld-label` / `.ld-label-muted` / `.ld-helper-text` | Typography |
| `.ld-button` / `.ld-button-primary` / `.ld-button-danger` / `.ld-button-ghost` | Buttons |
| `.ld-button-sm` / `.ld-button-pill` | Compact and pill-shaped buttons |
| `.ld-switch` + `.ld-switch-thumb` | `role="switch"` toggle buttons |
| `.ld-switch-row` | Horizontal switch + label row |
| `.ld-sections-loose` / `.ld-field-row-between` | Spacious sections / spaced control rows |
| `.ld-button-group` + `.ld-button-group-btn-*` | Segmented button groups |
| `.ld-input` / `.ld-input-number` / `.ld-textarea` | Text inputs |
| `.ld-select-wrap` + `.ld-select` + `.ld-select-chevron` | Select with chevron |
| `.ld-toggle` + `.ld-toggle-thumb` + `.ld-toggle-input` | Toggle switch (checkbox) |
| `.ld-range` | Range slider track |
| `.ld-color-input` | Color picker |
| `.ld-badge` / `.ld-divider` | Status pill / horizontal rule |

**Select with chevron:**

```html
<div class="ld-select-wrap">
  <select class="ld-select" id="my-select">…</select>
  <span class="ld-select-chevron" aria-hidden="true">▾</span>
</div>
```

**Switch button (`role="switch"`):**

```html
<button type="button" class="ld-switch" role="switch" aria-checked="false">
  <span class="ld-switch-thumb" aria-hidden="true"></span>
</button>
```

**Toggle switch:**

```html
<div class="ld-toggle">
  <span class="ld-toggle-thumb"></span>
  <input type="checkbox" class="ld-toggle-input" aria-label="Use setting" />
</div>
```

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
