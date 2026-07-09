import { WaterApp } from "./WaterApp";
import { UIManager } from "./ui/UIManager";
import { createUI } from "./ui/Controls";

async function init() {
  const app = await WaterApp.create();
  const ui = new UIManager(app);
  createUI(ui);
}

init();
