import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createDebugFolder(ui: UIManager, pane: Panel | Folder): Folder {
  const folder = pane.addFolder("Debug", { expanded: false });

  const forceWebGL = localStorage.getItem("forceWebGL") === "true";
  ui.params.debug.forceWebGL = forceWebGL;

  folder.addCheckbox("Force WebGL", {
    value: forceWebGL,
    binding: () => ui.params.debug.forceWebGL,
    onChange: (v) => {
      ui.params.debug.forceWebGL = v;
      localStorage.setItem("forceWebGL", String(v));
      window.location.reload();
    },
  });

  return folder;
}
