const DUCK_URL =
  '../../shared-assets/models/glTF-Sample-Assets/Models/Duck/glTF/Duck.gltf';
const WINDOW_URL =
  'http://assets.v2.londondynamics.com/00000000-0000-0000-0000-000000000000/8189a62c-6567-407a-a9a3-9164426a9f12/Window.glb';

const WINDOW_SNAP_POINTS = [
  {
    id: 'wall-anchor-window',
    transform: {position: [0, 0, 0], rotation: [0, 0, 0]},
    allowedSurfaces: ['wall'],
    surfaceSnap: {
      offset: 0.02,
      edgeClearance: {
        horizontal: {
          min: 0.1,
        },
      },
      normal: 'inward',
      align: 'keep-upright',
    },
    verticalConstraint: {
      reference: 'bottom',
      minFromFloor: 0.8,
    },
  },
];

const WINDOW_BOUNDS = {
  min: [
    -0.6118119359016418, -1.3969838619232178e-8, -0.05527731031179428,
  ],
  max: [0.6118119955062866, 1.4524229764938354, 0.1190357431769371],
};

const SEED_ITEMS = [
  {
    id: 'clip-duck-floor',
    part: {type: 'scene', id: 'duck', name: 'Floor duck'},
    transform: {
      position: [0, 0, 0.6],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  },
];

/**
 * @param {object} config
 */
export function wireClipboardDemo(config) {
  const start = () => {
    const viewer = document.getElementById(config.viewerId);
    if (!viewer) return;

    const undoBtn = document.getElementById(config.undoId);
    const redoBtn = document.getElementById(config.redoId);
    const historyEl = document.getElementById(config.historyId);
    const clipboardEl = document.getElementById(config.clipboardId);
    const selectionEl = document.getElementById(config.selectionId);
    const copyBtn = config.copyId
      ? document.getElementById(config.copyId)
      : null;
    const pasteBtn = config.pasteId
      ? document.getElementById(config.pasteId)
      : null;
    const clearBtn = config.clearId
      ? document.getElementById(config.clearId)
      : null;
    const duplicateBtn = config.duplicateId
      ? document.getElementById(config.duplicateId)
      : null;
    const cancelBtn = config.cancelId
      ? document.getElementById(config.cancelId)
      : null;

    const applyHistoryUi = (state) => {
      if (!undoBtn || !redoBtn || !historyEl) return;
      undoBtn.disabled = !state.canUndo;
      redoBtn.disabled = !state.canRedo;
      undoBtn.textContent = state.undoLabel
        ? `Undo: ${state.undoLabel}`
        : 'Undo';
      redoBtn.textContent = state.redoLabel
        ? `Redo: ${state.redoLabel}`
        : 'Redo';
      historyEl.textContent = [
        `undo: ${state.undoSize}`,
        `redo: ${state.redoSize}`,
      ].join(' | ');
    };

    const applyClipboardUi = (state) => {
      if (!clipboardEl) return;
      if (state.pasteSession?.active) {
        clipboardEl.textContent = `placing copy… ${
          state.pasteSession.validTarget ? 'valid' : 'invalid'
        }`;
        return;
      }
      clipboardEl.textContent = state.hasClipboard
        ? 'clipboard: ready'
        : 'clipboard: empty';
    };

    const applySelectionUi = () => {
      if (!selectionEl) return;
      const selected = viewer.getSelectedObjects?.() ?? [];
      if (selected.length === 0) {
        selectionEl.textContent = 'selection: none';
        return;
      }
      const names = selected.map(
        (obj) => obj.userData?.name || obj.name || obj.uuid
      );
      selectionEl.textContent = `selection: ${names.join(', ')}`;
    };

    if (typeof viewer.getHistoryState === 'function') {
      applyHistoryUi(viewer.getHistoryState());
    }
    if (typeof viewer.getClipboardState === 'function') {
      applyClipboardUi(viewer.getClipboardState());
    }
    applySelectionUi();

    viewer.addEventListener('history-change', (e) => applyHistoryUi(e.detail));
    viewer.addEventListener('clipboard-change', (e) =>
      applyClipboardUi(e.detail)
    );
    viewer.addEventListener('selection-change', () => applySelectionUi());

    undoBtn?.addEventListener('click', () => viewer.undo());
    redoBtn?.addEventListener('click', () => viewer.redo());

    copyBtn?.addEventListener('click', () => viewer.copyPart?.());
    pasteBtn?.addEventListener('click', () => {
      void viewer.paste?.();
    });
    clearBtn?.addEventListener('click', () => viewer.clearClipboard?.());

    duplicateBtn?.addEventListener('click', () => {
      const selected = viewer.getSelectedObjects?.() ?? [];
      if (selected.length !== 1) return;
      viewer.copyPart?.(selected[0].uuid, {interactive: true});
    });

    cancelBtn?.addEventListener('click', () => viewer.cancelPaste?.());

    if (config.keyboardShortcuts) {
      viewer.addEventListener('keydown', (e) => {
        if (!(e.metaKey || e.ctrlKey)) return;
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === 'c' || e.key === 'C') {
          e.preventDefault();
          viewer.copyPart?.();
        }
        if (e.key === 'v' || e.key === 'V') {
          e.preventDefault();
          void viewer.paste?.();
        }
      });
    }

    const getHighResUrl = async (item) => {
      if (item?.part?.id === 'duck') return DUCK_URL;
      return undefined;
    };

    let seeded = false;
    const seedScene = async () => {
      if (seeded || typeof viewer.placeManyGlb !== 'function') return;
      seeded = true;
      try {
        await viewer.placeManyGlb(SEED_ITEMS, {getHighResUrl});
        if (typeof viewer.placeGlb === 'function') {
          await viewer.placeGlb(WINDOW_URL, {
            part: {
              type: 'scene',
              id: 'window',
              name: 'Wall window',
              snapPoints: WINDOW_SNAP_POINTS,
              bounds: WINDOW_BOUNDS,
            },
            position: [0, 1.2, -2.45],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          });
        }
      } catch (err) {
        seeded = false;
        console.warn('clipboard demo seed failed', err);
      }
    };

    viewer.addEventListener('load', () => {
      void seedScene();
    });
    if (viewer.loaded) {
      void seedScene();
    }
  };

  if (customElements.get('model-viewer')) {
    start();
  } else {
    customElements.whenDefined('model-viewer').then(start);
  }
}
