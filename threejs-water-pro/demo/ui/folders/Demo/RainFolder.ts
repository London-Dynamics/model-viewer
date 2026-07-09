import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createRainFolder(ui: UIManager, pane: Panel | Folder): Folder {
  const folder = pane.addFolder("Rain", { expanded: false });

  folder.addCheckbox("Enabled", {
    object: ui.water.rain.particles,
    key: "enabled",
    onChange: (v) => {
      ui.water.rain.ripples.enabled = v as boolean;
    },
  });

  const dropsFolder = folder.addFolder("Drops", { expanded: false });

  dropsFolder.addSlider("Intensity", {
    min: 0,
    max: 1,
    step: 0.01,
    object: ui.water.rain.particles,
    key: "intensity",
  });

  dropsFolder.addSlider("Opacity", {
    min: 0,
    max: 1,
    step: 0.01,
    object: ui.water.rain.particles,
    key: "opacity",
  });

  dropsFolder.addSlider("Speed", {
    min: 0.1,
    max: 5,
    step: 0.1,
    object: ui.water.rain.particles,
    key: "speed",
  });

  dropsFolder.addSlider("Streak Length", {
    min: 0.1,
    max: 5,
    step: 0.05,
    object: ui.water.rain.particles,
    key: "streakLength",
  });

  dropsFolder.addSlider("Streak Width", {
    min: 0.001,
    max: 0.05,
    step: 0.001,
    object: ui.water.rain.particles,
    key: "streakWidth",
  });

  dropsFolder.addSlider("Fade Distance", {
    min: 0,
    max: 50,
    step: 1,
    object: ui.water.rain.particles,
    key: "fadeDistance",
  });

  dropsFolder.addColor("Color", {
    binding: () => "#" + ui.water.rain.particles.color.getHexString(),
    onChange: (v) => {
      ui.water.rain.particles.color = v;
    },
  });

  const ripplesFolder = folder.addFolder("Ripples", { expanded: false });

  ripplesFolder.addSlider("Intensity", {
    min: 0,
    max: 1,
    step: 0.05,
    object: ui.water.rain.ripples,
    key: "strength",
  });

  ripplesFolder.addSlider("Size", {
    min: 1,
    max: 10,
    step: 0.5,
    object: ui.water.rain.ripples,
    key: "size",
  });

  ripplesFolder.addSlider("Density", {
    min: 0,
    max: 2,
    step: 0.05,
    object: ui.water.rain.ripples,
    key: "density",
  });

  ripplesFolder.addSlider("Decay", {
    min: 0.5,
    max: 5,
    step: 0.1,
    object: ui.water.rain.ripples,
    key: "decay",
  });

  ripplesFolder.addSlider("Fade End", {
    min: 50,
    max: 2000,
    step: 50,
    object: ui.water.rain.ripples,
    key: "fadeEnd",
  });

  return folder;
}
