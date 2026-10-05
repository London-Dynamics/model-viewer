// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

const TICKS_PER_HOUR_AT_60HZ = 8192 * 60;

export function createMultiplayerFolder(
  ui: UIManager,
  pane: Panel | Folder,
): Folder {
  const folder = pane.addFolder("Multiplayer", { expanded: false });

  // Collected after declaration; the checkbox onChange closure references the
  // array, so the entries it sees are the ones present at click time.
  const tickControls: { hidden: boolean }[] = [];

  folder.addCheckbox("Deterministic", {
    object: ui.water,
    key: "deterministic",
    onChange: (value) => {
      const off = !value;
      for (const c of tickControls) c.hidden = off;
      if (value) {
        targetSlider.setValueSilent(ui.water.tick);
      }
    },
  });

  const liveTickDisplay = folder.addDisplay("Live Tick", {
    value: ui.water.deterministic ? String(ui.water.tick) : "—",
  });

  let targetTick = ui.water.deterministic ? ui.water.tick : 0;

  const targetSlider = folder.addSlider("Target Tick", {
    value: targetTick,
    min: 0,
    max: TICKS_PER_HOUR_AT_60HZ,
    step: 1,
    onChange: (v) => {
      targetTick = Math.round(v);
    },
  });

  const syncToTargetButton = folder.addButton("Sync to Target Tick", {
    onClick: () => {
      ui.water.syncToTick(targetTick);
      targetSlider.setValueSilent(ui.water.tick);
    },
  });

  const syncToSystemTimeButton = folder.addButton("Sync to System Time", {
    onClick: () => {
      // POSIX time derived tick. Two clients with NTP-aligned wall-clocks
      // compute the same target tick. The library folds the resulting large
      // integer internally for GPU precision; the caller doesn't have to
      // worry about epoch choice for that.
      const posixTick = Math.floor(Date.now() / 1000 / ui.water.stepSize);
      ui.water.syncToTick(posixTick);
    },
  });

  tickControls.push(
    liveTickDisplay,
    targetSlider,
    syncToTargetButton,
    syncToSystemTimeButton,
  );

  // Initial visibility for the non-deterministic case (the checkbox's
  // onChange only fires on user input, not on mount).
  if (!ui.water.deterministic) {
    for (const c of tickControls) c.hidden = true;
  }

  const updateLiveTick = (): void => {
    if (ui.water.deterministic) {
      liveTickDisplay.value = String(ui.water.tick);
    }
    requestAnimationFrame(updateLiveTick);
  };
  requestAnimationFrame(updateLiveTick);

  return folder;
}
