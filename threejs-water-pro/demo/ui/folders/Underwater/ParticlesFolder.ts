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

  folder.addSlider("Far Distance", {
    min: 100,
    max: 1000,
    step: 1,
    binding: () => ui.params.postProcessing.underwaterParticles.farDistance,
    onChange: (v) => {
      ui.params.postProcessing.underwaterParticles.farDistance = v;
      ui.water.particles.updateParams({ farDistance: v });
    },
  });

  folder.addSlider("Max Size", {
    min: 0.1,
    max: 2.0,
    step: 0.05,
    binding: () => ui.params.postProcessing.underwaterParticles.maxSize,
    onChange: (v) => {
      ui.params.postProcessing.underwaterParticles.maxSize = v;
      ui.water.particles.updateParams({ maxSize: v });
    },
  });

  folder.addSlider("Min Size", {
    min: 0.01,
    max: 1.0,
    step: 0.01,
    binding: () => ui.params.postProcessing.underwaterParticles.minSize,
    onChange: (v) => {
      ui.params.postProcessing.underwaterParticles.minSize = v;
      ui.water.particles.updateParams({ minSize: v });
    },
  });

  folder.addSlider("Near Distance", {
    min: 1,
    max: 100,
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
