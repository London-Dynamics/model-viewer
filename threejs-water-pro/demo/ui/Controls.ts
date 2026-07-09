import type {
  PresetName,
  QualityLevel,
  Sky,
  WaterPreset,
  WaterSystem,
} from "threejs-water-pro";
import { Panel } from "./SimpleUI";
import type { UIManager } from "./UIManager";

declare const __APP_VERSION__: string;
import {
  createAudioFolder,
  createBoatFolder,
  createBuoyancyFolder,
  createCameraFolder,
  createCausticsFolder,
  createClipPlaneFolder,
  createColorsFolder,
  createDebugFolder,
  createDistortionFolder,
  createFoamFolder,
  createSprayFolder,
  createGeometryFolder,
  createMeniscusFolder,
  createMultiplayerFolder,
  createParticlesFolder,
  createPerformanceFolder,
  createPostProcessingFolder,
  createRainFolder,
  createReflectionsFolder,
  createSeaFloorFolder,
  createSkyFolder,
  createSSSFolder,
  createSunShaftsFolder,
  createSurfaceFogFolder,
  createTerrainFolder,
  createWakeFolder,
  createWavesFolder,
} from "./folders";

/** Convert a THREE.Color to a hex string like "#rrggbb". */
function colorToHex(c: { getHexString(): string }): string {
  return "#" + c.getHexString();
}

/**
 * Build a complete WaterPreset snapshot from live water system values.
 *
 * Some parameters are owned by `params` (sky, waves.fft, cascades, clipmap,
 * oceanFloor, fresnel.underwater, postProcessing, caustics, foam textures).
 * Others live on water system shader classes (color, foam uniforms,
 * fresnel.surface, ssr, sss, sparkle, fog, gerstner, sunShafts, spray).
 * This function reads from the correct source for each.
 *
 * Used both by the "Save Preset" button and the autosave loop — the
 * autosave deep-merges the result back into `params` so user edits made
 * via instance-bound UI controls (`object: ui.water.spray, …`) survive a
 * page refresh.
 */
export function extractPresetParams(
  water: WaterSystem,
  sky: Sky,
  params: WaterPreset,
): WaterPreset {
  const w = water;
  const p = params;

  return {
    caustics: JSON.parse(JSON.stringify(p.caustics)),
    clipmap: JSON.parse(JSON.stringify(p.clipmap)),
    color: {
      absorptionColor: colorToHex(w.color.absorptionColor),
      transmissionColor: colorToHex(w.color.transmissionColor),
      waterColor: colorToHex(w.color.waterColor),
    },
    foam: {
      surface: {
        enabled: w.foam.surface.enabled,
        opacity: w.foam.surface.opacity,
        color: colorToHex(w.foam.surface.color),
        size: w.foam.surface.size,
        coverage: w.foam.surface.coverage,
        texture: p.foam.surface.texture,
      },
      waves: {
        enabled: w.foam.waves.enabled,
        opacity: w.foam.waves.opacity,
        color: colorToHex(w.foam.waves.color),
        size: w.foam.waves.size,
        coverage: w.foam.waves.coverage,
        crestCoverage: w.foam.waves.crestCoverage,
        peakIntensity: w.foam.waves.peakIntensity,
        windStretch: w.foam.waves.windStretch,
        waveWeight: w.foam.waves.waveWeight,
        rippleWeight: w.foam.waves.rippleWeight,
        texture: p.foam.waves.texture,
        persistence: JSON.parse(JSON.stringify(p.foam.waves.persistence)),
      },
      shoreline: {
        enabled: w.foam.shoreline.enabled,
        opacity: w.foam.shoreline.opacity,
        size: w.foam.shoreline.size,
        coverage: w.foam.shoreline.coverage,
        range: w.foam.shoreline.range,
        color: colorToHex(w.foam.shoreline.color),
        texture: p.foam.shoreline.texture,
      },
    },
    fog: {
      color: colorToHex(w.fog.color),
      enabled: w.fog.enabled,
      fadeEnd: w.fog.fadeEnd,
      fadePower: w.fog.fadePower,
      fadeStart: w.fog.fadeStart,
      skyBlendDistance: w.fog.skyBlendDistance,
    },
    fresnel: {
      surface: {
        fadePower: w.fresnel.fadePower,
        fadeStart: w.fresnel.fadeStart,
        iorRatio: w.fresnel.iorRatio,
        normalStrength: w.fresnel.normalStrength,
        refractionStrength: w.fresnel.refractionStrength,
      },
      underwater: JSON.parse(JSON.stringify(p.fresnel.underwater)),
    },
    oceanFloor: {
      ...JSON.parse(JSON.stringify(p.oceanFloor)),
      caustics: {
        depthAttenuation: w.floor.caustics.depthAttenuation,
        enabled: w.floor.caustics.enabled,
        intensity: w.floor.caustics.intensity,
        scale: w.floor.caustics.scale,
        waveDistortion: w.floor.caustics.waveDistortion,
      },
      sunShafts: {
        enabled: w.sunShafts.enabled,
        intensity: w.sunShafts.intensity,
      },
    },
    postProcessing: {
      ...JSON.parse(JSON.stringify(p.postProcessing)),
      rain: {
        color: "#" + w.rain.particles.color.getHexString(),
        enabled: w.rain.particles.enabled,
        fadeDistance: w.rain.particles.fadeDistance,
        intensity: w.rain.particles.intensity,
        opacity: w.rain.particles.opacity,
        rippleDecay: w.rain.ripples.decay,
        rippleDensity: w.rain.ripples.density,
        rippleFadeEnd: w.rain.ripples.fadeEnd,
        rippleSize: w.rain.ripples.size,
        rippleStrength: w.rain.ripples.strength,
        speed: w.rain.particles.speed,
        streakLength: w.rain.particles.streakLength,
        streakWidth: w.rain.particles.streakWidth,
      },
    },
    lighting: {
      ambient: {
        skyColor: colorToHex(w.lighting.ambient.skyColor),
        groundColor: colorToHex(w.lighting.ambient.groundColor),
        intensity: w.lighting.ambient.intensity,
      },
    },
    sky: {
      ...JSON.parse(JSON.stringify(p.sky)),
      brightness: sky.brightnessUniform.value,
      reflectionBlurDistance: sky.reflectionBlurDistanceUniform.value,
      reflectionDistanceBlur: sky.reflectionDistanceBlurUniform.value,
      reflectionRoughness: sky.reflectionRoughnessUniform.value,
    },
    sparkle: {
      enabled: w.sparkle.enabled,
      fadeDistance: w.sparkle.fadeDistance,
      intensity: w.sparkle.intensity,
      minDistance: w.sparkle.minDistance,
      power: w.sparkle.power,
    },
    spray: w.spray
      ? {
          bottomFadeStart: w.spray.bottomFadeStart,
          bottomFadeStop: w.spray.bottomFadeStop,
          duration: w.spray.duration,
          enabled: w.spray.enabled,
          fadeOutTime: w.spray.fadeOutTime,
          opacity: w.spray.opacity,
          respawnTime: w.spray.respawnTime,
          size: w.spray.size,
          spawnJitterTime: w.spray.spawnJitterTime,
          stretchX: w.spray.stretchX,
          stretchY: w.spray.stretchY,
          submersionDepth: w.spray.submersionDepth,
          velocityHeightFactor: w.spray.velocityHeightFactor,
          velocityScaleFactor: w.spray.velocityScaleFactor,
          velocityThreshold: w.spray.velocityThreshold,
        }
      : {
          bottomFadeStart: 0.0,
          bottomFadeStop: 0.15,
          duration: 1.5,
          enabled: false,
          fadeOutTime: 0.5,
          opacity: 0.4,
          respawnTime: 1.0,
          size: 27.5,
          spawnJitterTime: 0.0,
          stretchX: 1.88,
          stretchY: 1.0,
          submersionDepth: 0.5,
          velocityHeightFactor: 0.0,
          velocityScaleFactor: 0.0,
          velocityThreshold: 3.9,
        },
    ssr: {
      enabled: w.ssr.enabled,
      strength: w.ssr.strength,
    },
    sss: {
      enabled: w.sss.enabled,
      intensity: w.sss.intensity,
      power: w.sss.power,
    },
    wake: {
      foamBreakThreshold: w.wake.foamBreakThreshold,
      foamPersistence: w.wake.foamPersistence,
      foamStrength: w.wake.foamStrength,
      friction: w.wake.friction,
    },
    waves: {
      fft: JSON.parse(JSON.stringify(p.waves.fft)),
      gerstner: {
        wavelength: w.gerstner.wavelength,
        amplitude: w.gerstner.amplitude,
        wavelengthSpread: w.gerstner.wavelengthSpread,
        directionalSpread: w.gerstner.directionalSpread,
      },
    },
  };
}

export function createUI(ui: UIManager, title?: string): Panel {
  const panel = new Panel({
    title: title ?? "Three.js Water Pro",
    version: __APP_VERSION__,
    container: document.body,
    position: { top: 10, right: 10 },
  });

  // ════════════════════════════════════════
  // TOP-LEVEL CONTROLS
  // ════════════════════════════════════════
  const presetSelect = panel.addSelect("Preset", {
    value: ui.app.params.activePreset,
    options: [
      { label: "Arctic", value: "arctic" },
      { label: "Black Flag", value: "blackFlag" },
      { label: "Dusk", value: "dusk" },
      { label: "Foggy", value: "foggy" },
      { label: "Moonlit", value: "moonlit" },
      { label: "Sea of Thieves", value: "seaOfThieves" },
      { label: "Storm", value: "storm" },
      { label: "Sunset", value: "sunset" },
    ],
    onChange: async (v) => {
      presetSelect.clearDirty();
      await ui.applyPreset(v as PresetName);
      panel.refresh();
    },
  });

  const qualitySelect = panel.addSelect("Quality", {
    value: ui.performanceParams.quality,
    options: [
      { label: "Low", value: "low" },
      { label: "Medium", value: "medium" },
      { label: "High", value: "high" },
      { label: "Ultra", value: "ultra" },
    ],
    onChange: async (v) => {
      qualitySelect.clearDirty();
      ui.performanceParams.quality = v as QualityLevel;
      await ui.updateQualityLevel();
      panel.refresh();
    },
  });

  panel.addSeparator();

  // ════════════════════════════════════════
  // FEATURE FOLDERS (alphabetical: Sky, Surface, Underwater)
  // ════════════════════════════════════════
  const markDirty = (): void => {
    presetSelect.markDirty();
    qualitySelect.markDirty();
  };

  const surfaceFolder = panel.addFolder("Surface", {
    expanded: true,
    onControlChange: markDirty,
  });

  createBuoyancyFolder(ui, surfaceFolder);
  createColorsFolder(ui, surfaceFolder);
  createFoamFolder(ui, surfaceFolder);
  createSurfaceFogFolder(ui, surfaceFolder);
  createGeometryFolder(ui, surfaceFolder);
  createReflectionsFolder(ui, surfaceFolder);
  createSprayFolder(ui, surfaceFolder);
  createSSSFolder(ui, surfaceFolder);
  createWakeFolder(ui, surfaceFolder);
  createWavesFolder(ui, surfaceFolder);

  const underwaterFolder = panel.addFolder("Underwater", {
    expanded: true,
    onControlChange: markDirty,
  });

  underwaterFolder.addCheckbox("Enabled", {
    object: ui.water.underwater,
    key: "enabled",
    onChange: (v) => {
      ui.app.visibility.setUnderwaterContent(v as boolean);
    },
  });

  underwaterFolder.addColor("Tint Color", {
    object: ui.water.underwater,
    key: "tintColor",
  });

  createCausticsFolder(ui, underwaterFolder);
  createClipPlaneFolder(ui, underwaterFolder, ui.isWebGL);
  createDistortionFolder(ui, underwaterFolder);
  createMeniscusFolder(ui, underwaterFolder);
  createParticlesFolder(ui, underwaterFolder);
  createSeaFloorFolder(ui, underwaterFolder);
  createSunShaftsFolder(ui, underwaterFolder);
  createTerrainFolder(ui, underwaterFolder);

  const skyFolder = panel.addFolder("Sky", {
    expanded: false,
    onControlChange: markDirty,
  });

  createSkyFolder(ui, skyFolder);

  const weatherFolder = panel.addFolder("Weather", {
    expanded: false,
    onControlChange: markDirty,
  });

  createRainFolder(ui, weatherFolder);

  const demoFolder = panel.addFolder("Demo", { expanded: true });

  createAudioFolder(ui, demoFolder);
  createBoatFolder(ui, demoFolder);
  createCameraFolder(ui, demoFolder);
  createDebugFolder(ui, demoFolder);
  createMultiplayerFolder(ui, demoFolder);
  createPerformanceFolder(ui, demoFolder);
  createPostProcessingFolder(ui, demoFolder);

  panel.addSeparator();

  panel.addButton("Print Settings to Console", {
    onClick: () => {
      const preset = extractPresetParams(ui.water, ui.app.sky, ui.params);
      const settings = JSON.stringify(preset, null, 2);
      console.log("=== WATER PRESET SETTINGS ===");
      console.log(settings);
      console.log("=============================");
    },
  });

  panel.addButton("Download Preset", {
    onClick: () => {
      const preset = extractPresetParams(ui.water, ui.app.sky, ui.params);
      const settings = JSON.stringify(preset, null, 2);
      const blob = new Blob([settings], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "water-preset.json";
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  panel.addButton("Load Preset", {
    onClick: () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text) as WaterPreset;
          presetSelect.markDirty();
          await ui.applyPreset(parsed);
          panel.refresh();
        } catch (err) {
          console.error("[Load Preset] Failed to load preset:", err);
          window.alert(
            "Failed to load preset. The file is not valid preset JSON.",
          );
        }
      });
      input.click();
    },
  });

  return panel;
}
