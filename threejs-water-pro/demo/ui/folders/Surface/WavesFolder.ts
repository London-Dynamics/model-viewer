import { getCascadeConfigsArray } from "threejs-water-pro";
import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

function updateCascadeConfig(ui: UIManager, index: number): void {
  const configs = getCascadeConfigsArray(ui.params.waves.fft.cascades);
  if (index < configs.length) {
    const config = configs[index];
    const scaledConfig = {
      ...config,
      scale: config.scale / ui.params.waves.fft.frequency,
      amplitudeScale: config.amplitudeScale * ui.params.waves.fft.amplitude,
    };
    ui.water.updateCascadeConfig(index, scaledConfig);
  }
}

function updateAllCascadeConfigs(ui: UIManager): void {
  const configs = getCascadeConfigsArray(ui.params.waves.fft.cascades);
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    const scaledConfig = {
      ...config,
      scale: config.scale / ui.params.waves.fft.frequency,
      amplitudeScale: config.amplitudeScale * ui.params.waves.fft.amplitude,
    };
    ui.water.updateCascadeConfig(i, scaledConfig);
  }
}

export function createWavesFolder(
  ui: UIManager,
  pane: Panel | Folder,
): void {
  const folder = pane.addFolder("Waves", { expanded: false });

  createFFTControls(ui, folder);
  createSwellsSubfolder(ui, folder);
}

function createFFTControls(ui: UIManager, folder: Folder): void {
  folder.addSlider("Wind Speed", {
    min: 1,
    max: 50,
    step: 0.1,
    object: ui.params.waves.fft,
    key: "windSpeed",
    onChange: () => {
      ui.water.waves.update(ui.params.waves.fft);
    },
  });

  folder.addSlider("Wind Direction", {
    min: 0,
    max: 360,
    step: 1,
    binding: () => (ui.params.waves.fft.windDirection * 180) / Math.PI,
    onChange: (v) => {
      ui.params.waves.fft.windDirection = (v * Math.PI) / 180;
      ui.water.waves.update(ui.params.waves.fft);
    },
  });

  folder.addSlider("Choppiness", {
    min: 0,
    max: 3,
    step: 0.01,
    object: ui.params.waves.fft,
    key: "choppiness",
    onChange: () => {
      ui.water.waves.update(ui.params.waves.fft);
    },
  });

  folder.addSlider("Speed", {
    min: 0,
    max: 10,
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
      updateAllCascadeConfigs(ui);
    },
  });

  folder.addSlider("Frequency", {
    min: 0.1,
    max: 10,
    step: 0.01,
    object: ui.params.waves.fft,
    key: "frequency",
    onChange: () => {
      updateAllCascadeConfigs(ui);
    },
  });

  folder.addSlider("Spectral Sharpness", {
    min: 0.3,
    max: 3.0,
    step: 0.05,
    object: ui.params.waves.fft,
    key: "spectralSharpness",
    onChange: () => {
      ui.water.waves.update(ui.params.waves.fft);
    },
  });

  folder.addSlider("Standing Wave Ratio", {
    min: 0,
    max: 1,
    step: 0.01,
    object: ui.params.waves.fft,
    key: "standingWaveRatio",
    onChange: () => {
      ui.water.waves.update(ui.params.waves.fft);
    },
  });

  createCascadeSubfolders(ui, folder);
}

function createSwellsSubfolder(ui: UIManager, parent: Folder): void {
  const swells = parent.addFolder("Swells", { expanded: false });

  swells.addSlider("Wavelength", {
    min: 10,
    max: 2000,
    step: 1,
    object: ui.water.gerstner,
    key: "wavelength",
  });

  swells.addSlider("Amplitude", {
    min: 0,
    max: 10,
    step: 0.01,
    object: ui.water.gerstner,
    key: "amplitude",
  });

  swells.addSlider("Wavelength Dispersion", {
    min: 1.0,
    max: 3.0,
    step: 0.01,
    object: ui.water.gerstner,
    key: "wavelengthSpread",
  });

  swells.addSlider("Direction Dispersion", {
    min: 0,
    max: 2.0,
    step: 0.01,
    object: ui.water.gerstner,
    key: "directionalSpread",
  });
}

function createCascadeSubfolders(ui: UIManager, parent: Folder): void {
  const ripplesFolder = parent.addFolder("Ripples", { expanded: false });

  ripplesFolder.addSlider("Scale", {
    min: 100,
    max: 500,
    step: 1,
    object: ui.params.waves.fft.cascades.ripples,
    key: "scale",
    onChange: () => {
      updateCascadeConfig(ui, 1);
    },
  });

  ripplesFolder.addSlider("Amplitude", {
    min: 0,
    max: 1,
    step: 0.01,
    object: ui.params.waves.fft.cascades.ripples,
    key: "amplitudeScale",
    onChange: () => {
      updateCascadeConfig(ui, 1);
    },
  });

  const wavesSubfolder = parent.addFolder("Waves", { expanded: false });

  wavesSubfolder.addSlider("Scale", {
    min: 500,
    max: 5000,
    step: 1,
    object: ui.params.waves.fft.cascades.waves,
    key: "scale",
    onChange: () => {
      updateCascadeConfig(ui, 0);
    },
  });

  wavesSubfolder.addSlider("Amplitude", {
    min: 0,
    max: 1,
    step: 0.01,
    object: ui.params.waves.fft.cascades.waves,
    key: "amplitudeScale",
    onChange: () => {
      updateCascadeConfig(ui, 0);
    },
  });
}
