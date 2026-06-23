# LD undo / redo

Undo/redo for the LD modular editor lives in a dedicated history manager, wired into `LDModularMixin` on `<model-viewer>`. Use this doc when editing history behavior or adding undo support to new editor actions.

## Source files

| File | Role |
|---|---|
| [`undo-history.ts`](../../packages/model-viewer/src/features/ld-modular/undo-history.ts) | `UndoHistoryManager`, entry types, graveyard, batching, replay |
| [`index.ts`](../../packages/model-viewer/src/features/ld-modular/index.ts) | `UndoHistoryHost` implementation, public API, recording call sites |
| [`transform-events.ts`](../../packages/model-viewer/src/features/ld-modular/transform-events.ts) | `TransformValues`, `TransformSource`, display names, labels |
| [`ld-modular-undo-spec.ts`](../../packages/model-viewer/src/test/features/ld-modular-undo-spec.ts) | Unit/integration tests — extend when adding entry kinds or operations |

User-facing API docs: `packages/modelviewer.dev/data/docs.json` (`#ldHistory`). Examples: `ld_history`, `ld_transforms`, `ld_clipboard`, `ld_modular`.

## Architecture

```
User action / API call
        ↓
LDModularMixin records entry (unless isReplaying)
        ↓
UndoHistoryManager pushes to undo stack, clears redo stack
        ↓
history-change event (reason: record)
        ↓
undo() / redo() → apply inverse/forward via UndoHistoryHost → history-change (reason: undo|redo)
```

**`UndoHistoryManager`** owns undo/redo stacks, batching, pruning, and the **graveyard** (detached `Object3D` nodes kept alive until no stack entry references them).

**`UndoHistoryHost`** is the scene adapter — implemented inline in `_ensureUndoHistory()`:

- `getObjectByUuid` → `getPart(uuid)`
- `cloneTransformValues` / `applyTransformValues` → logical rotation + `applyTransformValuesToObject`
- `detachNode` / `reattachNode` → parent/sibling-index restore
- `captureStructureMemento` / `applyStructureMemento` → hierarchy + `userData` snapshots
- `dispatchHistoryChange` → `history-change` custom event
- `requestRender` → `$needsRender()`

Do **not** duplicate scene mutation logic inside `undo-history.ts`. New replay behavior belongs in the host callbacks or shared helpers (`applyTransformValuesToObject`, `captureStructureMementoFromNodes`).

## Entry kinds

| Kind | Record API | Undo | Redo | Use when |
|---|---|---|---|---|
| `transform` | `recordTransform` | Apply `before` transforms | Apply `after` transforms | Position/rotation/scale changes |
| `add` | `recordAdd` | Detach to graveyard | Reattach from graveyard | Placing a new part |
| `remove` | `recordRemove` | Reattach detached nodes | Detach again | Deleting part(s) |
| `structure` | `recordStructure` | Apply `before` mementos | Apply `after` mementos | Group/ungroup, snap, break link, paste group, multi-step batches |

**Transform entries** skip no-op changes (`transformsEqual` with position/rotation/scale epsilons). Labels default via `buildTransformLabel` (`Move` / `Rotate` / `Scale` + target name).

**Structure mementos** capture parent UUID, sibling index, transform, selected `userData` keys (`STRUCTURE_USER_DATA_KEYS` in `undo-history.ts`), and `exists`. Snapped groups recurse into children when capturing.

**Batching** (`beginBatch` / `endBatch`): multiple entries recorded during a batch merge into one `structure` entry whose `before`/`after` are flattened mementos. Single-entry batches stay as-is. Used for bulk place, multi-delete, multi-paste.

## Public API (`LDModularInterface`)

| Member | Notes |
|---|---|
| `maxUndoSteps` / `max-undo-steps` | Default `50`; oldest entries pruned (`reason: prune`), graveyard nodes disposed when unreferenced |
| `undo()` / `redo()` | Return `boolean`; no-op when stack empty |
| `canUndo()` / `canRedo()` | Stack presence |
| `clearUndoHistory()` | Clears both stacks and graveyard |
| `getHistoryState()` | Sync snapshot for initial toolbar state |
| `history-change` event | `detail: HistoryChangeDetail` — subscribe once instead of polling |

`HistoryChangeDetail` includes `reason` (`record` | `undo` | `redo` | `clear` | `prune`), stack sizes, labels, `nextUndo` / `nextRedo` summaries, and `isReplaying` (always `false` in events; use manager's `isReplaying` only internally).

History is **cleared on disconnect** (`disconnectedCallback` sets `_undoHistory = null`).

## Operations that already record

| Operation | Entry kind | Recording site |
|---|---|---|
| Drag / rotation disc / API `setPosition` etc. | `transform` | Transform sessions → `_recordTransformSessionFromObject` / `_recordSelectionTransformSession` on `transformend` |
| Rotation animations | `transform` | Animation tick opens session with `source: 'animation'` |
| `alignObjects` | `transform` | Selection transform session with custom `historyLabel` |
| `placeGlb` / paste (single) | `add` | `_recordPlacementAdd` |
| `placeManyGlb` | `add` (batched) | `beginBatch` … `endBatch` |
| `deleteNode` | `remove` | `detachToGraveyard` + `recordRemove` |
| `removeSelectedObjects` (multi) | `remove` (batched) | `beginBatch` … `endBatch` |
| `groupSelectedObjects` | `structure` | `_recordStructureChange` |
| `ungroupSnappedGroup` | `structure` | `_recordStructureChange` (unless `skipHistory`) |
| Snap connection | `structure` | `_recordStructureChange` after `completeSnapConnection` |
| Break link | `structure` | `_recordStructureChange` (ungroup uses `skipHistory: true` then one combined entry) |
| Paste group | `structure` | `_recordStructureChange` |
| Paste selection (multi) | `add` (batched) | `beginBatch` … `endBatch` |

## Rules for editing undo/redo

### 1. Guard replay

Never push history while replaying:

```ts
if (this._ensureUndoHistory().isReplaying) return;
```

`record*` methods already check this; call sites that mutate the scene directly must too (see `deleteNode`).

### 2. Pick the right entry kind

- **Only transforms changed** → use a transform session (preferred) or `recordTransform` with explicit before/after snapshots.
- **Object added to scene** → `recordAdd` after the node is parented.
- **Object removed** → `detachToGraveyard` then `recordRemove` (keeps geometry for redo).
- **Hierarchy, grouping, snap metadata, or multiple coupled changes** → `_recordStructureChange(beforeNodes, afterNodes, label)` with nodes from `_collectStructureNodes(...)`.
- **Several independent operations in one user gesture** → `beginBatch` / `endBatch`.

Do not record mid-gesture pointer updates — only on session end (`_endTransformSession`, `_endSelectionTransformSession`).

### 3. Structure changes: capture before mutating

```ts
const beforeNodes = this._collectStructureNodes(...seeds);
// … mutate scene …
this._recordStructureChange(beforeNodes, this._collectStructureNodes(...seeds), 'Human label');
```

For nested internal steps that should collapse into one user-visible undo step, use `skipHistory: true` on the inner call and record once at the end (see break-link flow).

### 4. Labels

User-visible strings on toolbar buttons (`undoLabel` / `redoLabel`). Prefer `getObjectDisplayName(obj)` for single targets; use action verbs (`Group 3 objects`, `Break link`, `Align left`).

### 5. Extending structure mementos

If a new feature relies on `userData` not in `STRUCTURE_USER_DATA_KEYS`, add the key to that list in `undo-history.ts` with appropriate cloning (arrays/objects deep-copied like existing keys). Without this, undo will not restore the metadata.

### 6. Graveyard lifecycle

- Deleted nodes go to graveyard via `detachToGraveyard`.
- Pruning oldest undo entries or `clear()` disposes graveyard nodes no longer referenced by either stack.
- Do not hold external references to graveyard nodes.

### 7. Keep manager scene-agnostic

Changes to `UndoHistoryManager` should stay generic. Scene-specific restore logic goes in `_applyStructureMemento`, `_reattachNodeFromUndo`, or new host methods if needed.

## Adding undo to a new feature

1. Identify the user-visible **atomic action** (one undo step per gesture/command).
2. Choose entry kind (table above).
3. In `LDModularMixin`, record at the point the action is **committed** (not on every frame).
4. If the action is invoked during undo/redo, rely on `isReplaying` guards — replay should not nest new entries.
5. Add a test in `ld-modular-undo-spec.ts` covering undo and redo restoration.
6. If public-facing, update `docs.json` and an `ld_*` example with `history-change` UI (see below).
7. Emit `transformstart` / `transformend` when the action is transform-like so hosts can show gizmos/outlines consistently (`alignObjects` pattern).

## UI integration (examples)

Standard toolbar pattern:

```js
function applyHistoryUi(state) {
  undoBtn.disabled = !state.canUndo;
  redoBtn.disabled = !state.canRedo;
  undoBtn.textContent = state.undoLabel ? `Undo: ${state.undoLabel}` : 'Undo';
  redoBtn.textContent = state.redoLabel ? `Redo: ${state.redoLabel}` : 'Redo';
  hud.textContent = `undo: ${state.undoSize} | redo: ${state.redoSize}`;
}

viewer.addEventListener('history-change', (e) => applyHistoryUi(e.detail));
applyHistoryUi(viewer.getHistoryState()); // seed before first event
undoBtn.addEventListener('click', () => viewer.undo());
redoBtn.addEventListener('click', () => viewer.redo());
```

HUD classes: `.ld-hud` + `.ld-hud-top-right` (see `ld-example-layout.mdc`).

Shared helper: [`clipboard-demo.js`](../../packages/modelviewer.dev/examples/ld_clipboard/clipboard-demo.js) `wireHistoryUi(config)`.

Keyboard shortcuts are **not** built into `<model-viewer>`; hosts wire Ctrl/Cmd+Z themselves.

## Testing checklist

- [ ] One undo step per user action (not per frame)
- [ ] `undo()` restores prior state; `redo()` restores again
- [ ] `history-change` fires with correct `reason` and labels
- [ ] Replay does not grow undo stack (`replay does not push new undo entries` test)
- [ ] `maxUndoSteps` pruning disposes unreferenced graveyard nodes
- [ ] `clearUndoHistory` resets stacks without reverting scene

Run: `cd packages/model-viewer && npx web-test-runner --playwright --browsers chromium "src/test/features/ld-modular-undo-spec.ts"`

## What undo does **not** cover

- Space Opera Redux editor state (camera/material panels use local “revert” icons, unrelated to LD history)
- Base glTF `src` reload (history cleared on disconnect)
- Material/texture edits unless explicitly wired through modular scene operations
