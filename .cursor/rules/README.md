# Cursor rules index

| Rule | Scope | Purpose |
|---|---|---|
| [`repo-bootstrap.mdc`](repo-bootstrap.mdc) | `alwaysApply: true` | Overview, Node 18, key commands |
| [`ld-example-setup.mdc`](ld-example-setup.mdc) | `packages/modelviewer.dev/examples/ld_*/**` | Head assets, `body.ld`, UI conventions |
| [`ld-example-layout.mdc`](ld-example-layout.mdc) | `packages/modelviewer.dev/examples/ld_*/**` | Control docks, HUD readouts |
| [`ld-example-components.mdc`](ld-example-components.mdc) | `examples/ld_*/**`, `ld-ui.css` | Component classes; points to reference doc |
| [`docs-and-examples-registry.mdc`](docs-and-examples-registry.mdc) | `docs.json`, `examples.json`, docs/examples | Registry upkeep, ordering, cross-linking |
| [`model-viewer-ld-features.mdc`](model-viewer-ld-features.mdc) | `src/features/**`, `model-viewer.ts` | LD feature implementation, mixin registration |
| [`development-environment.mdc`](development-environment.mdc) | tests, web-test configs, CI workflows | Test runner, hooks, known issues |
| [`ci-release.mdc`](ci-release.mdc) | release workflow, `package.json` version | npm publish, tags, docs deploy |
| [`undo-redo.mdc`](undo-redo.mdc) | `undo-history.ts`, `ld-modular`, undo examples/tests | LD modular undo/redo architecture and extension rules |

Reference docs (not auto-loaded): [`.cursor/docs/`](../docs/) — includes [undo-redo.md](../docs/undo-redo.md)
