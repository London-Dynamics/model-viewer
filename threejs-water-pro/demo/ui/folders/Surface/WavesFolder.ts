// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

function applyMaxScale(ui: UIManager): void {
  ui.water.setMaxScale(ui.params.waves.fft.cascades.maxScale);
}

export function createWavesFolder(ui: UIManager, pane: Panel | Folder): void {
  const folder = pane.addFolder("Waves", { expanded: false });

  createFFTControls(ui, folder);
}

function createFFTControls(ui: UIManager, folder: Folder): void {
  folder.addSlider("Wind Speed (m/s)", {
    min: 0.1,
    max: 25,
    step: 0.1,
    object: ui.params.waves.fft,
    key: "windSpeed",
    onChange: () => {
      ui.water.waves.update(ui.params.waves.fft);
    },
  });

  folder.addSlider("Wind Direction (°)", {
    min: 0,
    max: 360,
    step: 1,
    binding: () => (ui.params.waves.fft.windDirection * 180) / Math.PI,
    onChange: (v) => {
      ui.params.waves.fft.windDirection = (v * Math.PI) / 180;
      ui.water.waves.update(ui.params.waves.fft);
    },
  });

  folder.addSlider("Speed", {
    min: 0,
    max: 3,
    step: 0.1,
    object: ui.params.waves.fft,
    key: "animationSpeed",
    onChange: () => {
      ui.water.waves.update(ui.params.waves.fft);
    },
  });

  folder.addSlider("Amplitude", {
    min: 0,
    max: 2,
    step: 0.01,
    object: ui.params.waves.fft,
    key: "amplitude",
    onChange: () => {
      ui.water.waves.update(ui.params.waves.fft);
    },
  });

  createFFTSubfolder(ui, folder);
}

function createFFTSubfolder(ui: UIManager, parent: Folder): void {
  const fft = parent.addFolder("FFT", { expanded: false });

  // Largest tile size. Every cascade after the first derives its tile size
  // from this and the cascades before it (see `deriveCascadeScale`), so one
  // slider sizes the whole FFT set.
  fft.addSlider("Max Scale (m)", {
    min: 128,
    max: 4096,
    step: 1,
    object: ui.params.waves.fft.cascades,
    key: "maxScale",
    onChange: () => {
      applyMaxScale(ui);
    },
  });

  fft.addSlider("Peak Wavelength (m)", {
    min: 5,
    max: 500,
    step: 1,
    binding: () => ui.params.waves.fft.peakWavelength,
    onChange: (v) => {
      ui.params.waves.fft.peakWavelength = v;
      ui.water.waves.update(ui.params.waves.fft);
    },
  });

  fft.addSlider("Choppiness", {
    min: 0,
    max: 3,
    step: 0.01,
    object: ui.params.waves.fft,
    key: "choppiness",
    onChange: () => {
      ui.water.waves.update(ui.params.waves.fft);
    },
  });

  fft.addSlider("Spectral Sharpness", {
    min: 0.3,
    max: 3.0,
    step: 0.01,
    object: ui.params.waves.fft,
    key: "spectralSharpness",
    onChange: () => {
      ui.water.waves.update(ui.params.waves.fft);
    },
  });

  fft.addSlider("Standing Wave Ratio", {
    min: 0,
    max: 1,
    step: 0.01,
    object: ui.params.waves.fft,
    key: "standingWaveRatio",
    onChange: () => {
      ui.water.waves.update(ui.params.waves.fft);
    },
  });
}
