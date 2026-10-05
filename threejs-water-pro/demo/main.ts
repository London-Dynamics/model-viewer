// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import { WaterApp } from "./WaterApp";
import { UIManager } from "./ui/UIManager";
import { createUI } from "./ui/Controls";

async function init() {
  const app = await WaterApp.create();
  // Console-debugging handle for the running app.
  (window as unknown as { __waterApp: WaterApp }).__waterApp = app;
  const ui = new UIManager(app);
  createUI(ui);
}

init();
