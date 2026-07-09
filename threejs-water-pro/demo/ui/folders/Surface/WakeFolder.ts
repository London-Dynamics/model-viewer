import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

/**
 * Controls for the dispersive iWave wake field.
 *
 * Field-global sliders (resolution, world size, friction, foam) bind to the
 * wake system directly. Resolution changes rebuild the field. The per-ship
 * sliders (hull depth, radius) bind to the demo ship's generator via
 * `updateGenerator`.
 */
export function createWakeFolder(ui: UIManager, pane: Panel | Folder): Folder {
  const folder = pane.addFolder("Wake", { expanded: false });

  // Locally-held per-generator state, mirrored to both ship generators (bow +
  // stern) on change. `strength` is the UI name for the generator's `depth` —
  // it scales the wake amplitude.
  const generator = {
    strength: 10.0,
    radius: 36.5,
  };

  const updateShipGenerators = (): void => {
    const ids = ui.app.shipWakeIds;
    if (ids.length === 0) return;
    // index 0 = bow (+Z); index 1 = stern (−Z) when present.
    ui.water.wake.updateGenerator(ids[0], {
      depth: generator.strength,
      radius: generator.radius,
    });
    if (ids.length > 1) {
      ui.water.wake.updateGenerator(ids[1], {
        depth: generator.strength,
        radius: generator.radius,
      });
    }
  };

  // Field-global state, seeded from the wake system's current values.
  // (Resolution uses a dropdown bound directly to the wake system.) Wake foam
  // is rendered through the surface WaveFoam pipeline — see the Foam folder.
  const field = {
    worldSize: ui.water.wake.worldSize,
    friction: ui.water.wake.friction,
    foamPersistence: ui.water.wake.foamPersistence,
    foamStrength: ui.water.wake.foamStrength,
    foamBreakThreshold: ui.water.wake.foamBreakThreshold,
  };

  folder.addCheckbox("Enabled", {
    object: ui.water.wake,
    key: "enabled",
  });
  folder.addCheckbox("Show Generators", {
    binding: () => ui.app.wakeDebugVisualizer.isEnabled(),
    onChange: (v) => {
      ui.app.wakeDebugVisualizer.setEnabled(v);
    },
  });
  folder.addSelect("Resolution", {
    binding: () => String(ui.water.wake.resolution),
    options: [
      { label: "256", value: "256" },
      { label: "512", value: "512" },
      { label: "1024", value: "1024" },
    ],
    onChange: (v) => {
      ui.water.wake.resolution = Number(v);
    },
  });
  folder.addSlider("World Size (m)", {
    object: field,
    key: "worldSize",
    min: 50,
    max: 1000,
    step: 10,
    onChange: (v) => {
      ui.water.wake.worldSize = v;
    },
  });

  folder.addSlider("Strength", {
    object: generator,
    key: "strength",
    min: 0.0,
    max: 100.0,
    step: 0.5,
    onChange: updateShipGenerators,
  });

  folder.addSlider("Radius (m)", {
    object: generator,
    key: "radius",
    min: 0.5,
    max: 200.0,
    step: 0.5,
    onChange: updateShipGenerators,
  });

  folder.addSlider("Friction (γ)", {
    object: field,
    key: "friction",
    min: 0.05,
    max: 2.0,
    step: 0.01,
    onChange: (v) => {
      ui.water.wake.friction = v;
    },
  });
  folder.addSlider("Foam Persistence", {
    object: field,
    key: "foamPersistence",
    min: 0.9,
    max: 0.999,
    step: 0.001,
    onChange: (v) => {
      ui.water.wake.foamPersistence = v;
    },
  });
  folder.addSlider("Foam Strength", {
    object: field,
    key: "foamStrength",
    min: 0.0,
    max: 1.0,
    step: 0.02,
    onChange: (v) => {
      ui.water.wake.foamStrength = v;
    },
  });
  folder.addSlider("Foam Break Threshold", {
    object: field,
    key: "foamBreakThreshold",
    min: 0.0,
    max: 0.5,
    step: 0.01,
    onChange: (v) => {
      ui.water.wake.foamBreakThreshold = v;
    },
  });

  return folder;
}
