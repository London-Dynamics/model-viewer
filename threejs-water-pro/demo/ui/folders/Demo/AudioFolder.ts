import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createAudioFolder(
  ui: UIManager,
  pane: Panel | Folder,
): Folder {
  const folder = pane.addFolder("Audio", { expanded: false });

  folder.addSlider("Volume", {
    value: ui.audioManager.getVolume(),
    min: 0,
    max: 1,
    step: 0.05,
    onChange: (v) => ui.audioManager.setVolume(v),
  });

  folder.addCheckbox("Muted", {
    value: ui.audioManager.isMuted(),
    onChange: (v) => ui.audioManager.setMuted(v),
  });

  return folder;
}
