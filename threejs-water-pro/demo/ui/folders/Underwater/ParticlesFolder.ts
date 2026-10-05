// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createParticlesFolder(
  ui: UIManager,
  parent: Panel | Folder,
): void {
  const folder = parent.addFolder("Particles", { expanded: false });

  folder.addCheckbox("Enabled", {
    binding: () => ui.water.particles.enabled,
    onChange: (v) => {
      ui.params.postProcessing.underwaterParticles.enabled = v;
      ui.water.particles.enabled = v;
    },
  });

  folder.addColor("Color", {
    binding: () => ui.params.postProcessing.underwaterParticles.color,
    onChange: (v) => {
      ui.params.postProcessing.underwaterParticles.color = v;
      ui.water.particles.updateParams({ color: v });
    },
  });

  folder.addSlider("Count", {
    min: 0,
    max: 2500,
    step: 10,
    binding: () => ui.params.postProcessing.underwaterParticles.count,
    onChange: (v) => {
      ui.params.postProcessing.underwaterParticles.count = v;
      ui.water.particles.updateParams({ count: v });
    },
  });

  folder.addSlider("Far Distance (m)", {
    min: 5,
    max: 200,
    step: 1,
    binding: () => ui.params.postProcessing.underwaterParticles.farDistance,
    onChange: (v) => {
      ui.params.postProcessing.underwaterParticles.farDistance = v;
      ui.water.particles.updateParams({ farDistance: v });
    },
  });

  folder.addSlider("Max Size (m)", {
    min: 0.1,
    max: 0.5,
    step: 0.05,
    binding: () => ui.params.postProcessing.underwaterParticles.maxSize,
    onChange: (v) => {
      ui.params.postProcessing.underwaterParticles.maxSize = v;
      ui.water.particles.updateParams({ maxSize: v });
    },
  });

  folder.addSlider("Min Size (m)", {
    min: 0.01,
    max: 0.2,
    step: 0.01,
    binding: () => ui.params.postProcessing.underwaterParticles.minSize,
    onChange: (v) => {
      ui.params.postProcessing.underwaterParticles.minSize = v;
      ui.water.particles.updateParams({ minSize: v });
    },
  });

  folder.addSlider("Near Distance (m)", {
    min: 1,
    max: 20,
    step: 1,
    binding: () => ui.params.postProcessing.underwaterParticles.nearDistance,
    onChange: (v) => {
      ui.params.postProcessing.underwaterParticles.nearDistance = v;
      ui.water.particles.updateParams({ nearDistance: v });
    },
  });

  folder.addSlider("Opacity", {
    min: 0,
    max: 1,
    step: 0.05,
    binding: () => ui.params.postProcessing.underwaterParticles.opacity,
    onChange: (v) => {
      ui.params.postProcessing.underwaterParticles.opacity = v;
      ui.water.particles.updateParams({ opacity: v });
    },
  });
}
