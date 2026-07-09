import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

function syncShipBuoyancy(ui: UIManager): void {
  const params = ui.params.buoyancy.ship;
  const shipBuoyancyId = ui.app.shipBuoyancyId;
  if (shipBuoyancyId >= 0) {
    ui.water.buoyancy.updateObjectConfig(shipBuoyancyId, {
      heightOffset: params.heightOffset,
      rotationInfluence: params.tiltAmount,
      heightSmoothing: params.heightSmoothing,
      rotationSmoothing: params.tiltSmoothing,
    });
  }
}

function syncBuoyBuoyancy(ui: UIManager): void {
  const params = ui.params.buoyancy.buoy;
  for (const id of ui.app.islandBuoyIds) {
    ui.water.buoyancy.updateObjectConfig(id, {
      heightOffset: params.heightOffset,
      rotationInfluence: params.tiltAmount,
      heightSmoothing: params.heightSmoothing,
      rotationSmoothing: params.tiltSmoothing,
    });
  }
}

function updateBuoyancyObjectsVisibility(ui: UIManager, showObjects: boolean): void {
  const models = ui.app.models;
  const water = ui.water;
  const params = ui.params;

  params.buoyancy.ship.enabled = showObjects;
  params.buoyancy.buoy.enabled = showObjects;

  models.shipModel.visible = showObjects;
  for (const buoy of models.islandBuoys) {
    buoy.visible = showObjects;
  }

  if (models.shipWaterMask) {
    if (showObjects) {
      if (!water.masking.has(models.shipWaterMask)) {
        water.masking.add(models.shipWaterMask);
      }
    } else {
      water.masking.remove(models.shipWaterMask);
    }
  }
}

export function createBuoyancyFolder(
  ui: UIManager,
  pane: Panel | Folder,
): Folder {
  const folder = pane.addFolder("Buoyancy", { expanded: false });

  folder.addCheckbox("Show Objects", {
    binding: () => ui.params.buoyancy.ship.enabled,
    onChange: (v) => {
      updateBuoyancyObjectsVisibility(ui, v);
    },
  });

  folder.addCheckbox("Show Sample Points", {
    binding: () => ui.params.buoyancy.ship.showSamplePoints,
    onChange: (v) => {
      ui.params.buoyancy.ship.showSamplePoints = v;
      ui.params.buoyancy.buoy.showSamplePoints = v;
      ui.app.buoyancyDebugVisualizer.setEnabled(v);
    },
  });

  const buoyFolder = folder.addFolder("Buoy", { expanded: false });

  buoyFolder.addCheckbox("Multi-Point Sampling", {
    binding: () => ui.params.buoyancy.buoy.multiPoint,
    onChange: (v) => {
      ui.params.buoyancy.buoy.multiPoint = v;
      for (const id of ui.app.islandBuoyIds) {
        ui.water.buoyancy.updateObjectConfig(id, { multiPoint: v });
      }
    },
  });

  buoyFolder.addSlider("Height Offset", {
    min: -5,
    max: 5,
    step: 0.1,
    binding: () => ui.params.buoyancy.buoy.heightOffset,
    onChange: (v) => {
      ui.params.buoyancy.buoy.heightOffset = v;
      syncBuoyBuoyancy(ui);
    },
  });

  buoyFolder.addSlider("Tilt Amount", {
    min: 0,
    max: 1,
    step: 0.01,
    binding: () => ui.params.buoyancy.buoy.tiltAmount,
    onChange: (v) => {
      ui.params.buoyancy.buoy.tiltAmount = v;
      syncBuoyBuoyancy(ui);
    },
  });

  buoyFolder.addSlider("Height Smoothing", {
    min: 0.0,
    max: 1.0,
    step: 0.01,
    binding: () => ui.params.buoyancy.buoy.heightSmoothing,
    onChange: (v) => {
      ui.params.buoyancy.buoy.heightSmoothing = v;
      syncBuoyBuoyancy(ui);
    },
  });

  buoyFolder.addSlider("Tilt Smoothing", {
    min: 0.0,
    max: 1,
    step: 0.01,
    binding: () => ui.params.buoyancy.buoy.tiltSmoothing,
    onChange: (v) => {
      ui.params.buoyancy.buoy.tiltSmoothing = v;
      syncBuoyBuoyancy(ui);
    },
  });

  const shipFolder = folder.addFolder("Ship", { expanded: false });

  shipFolder.addCheckbox("Multi-Point Sampling", {
    binding: () => ui.params.buoyancy.ship.multiPoint,
    onChange: (v) => {
      ui.params.buoyancy.ship.multiPoint = v;
      const shipBuoyancyId = ui.app.shipBuoyancyId;
      if (shipBuoyancyId >= 0) {
        ui.water.buoyancy.updateObjectConfig(shipBuoyancyId, { multiPoint: v });
      }
    },
  });

  shipFolder.addSlider("Height Offset", {
    min: -10,
    max: 10,
    step: 0.1,
    binding: () => ui.params.buoyancy.ship.heightOffset,
    onChange: (v) => {
      ui.params.buoyancy.ship.heightOffset = v;
      syncShipBuoyancy(ui);
    },
  });

  shipFolder.addSlider("Tilt Amount", {
    min: 0,
    max: 1,
    step: 0.01,
    binding: () => ui.params.buoyancy.ship.tiltAmount,
    onChange: (v) => {
      ui.params.buoyancy.ship.tiltAmount = v;
      syncShipBuoyancy(ui);
    },
  });

  shipFolder.addSlider("Height Smoothing", {
    min: 0.0,
    max: 1.0,
    step: 0.01,
    binding: () => ui.params.buoyancy.ship.heightSmoothing,
    onChange: (v) => {
      ui.params.buoyancy.ship.heightSmoothing = v;
      syncShipBuoyancy(ui);
    },
  });

  shipFolder.addSlider("Tilt Smoothing", {
    min: 0.02,
    max: 2.0,
    step: 0.01,
    binding: () => ui.params.buoyancy.ship.tiltSmoothing,
    onChange: (v) => {
      ui.params.buoyancy.ship.tiltSmoothing = v;
      syncShipBuoyancy(ui);
    },
  });

  return folder;
}
