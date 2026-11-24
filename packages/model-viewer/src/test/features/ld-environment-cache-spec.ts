/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {Mesh, Object3D, Texture} from 'three';

import {$renderer, $scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {waitForEvent} from '../../utilities.js';
import {assetPath} from '../helpers.js';

const PRODUCT = assetPath('models/cube.gltf');
const ENVIRONMENT_A = assetPath('models/Astronaut.glb');
const ENVIRONMENT_B = assetPath('models/reflective-sphere.gltf');
const HDR_A = assetPath('environments/spruit_sunrise_1k_HDR.hdr');
const HDR_B = assetPath('environments/pillars_1k.hdr');
const SKY_A = assetPath('environments/spruit_sunrise_1k_LDR.jpg');
const SKY_B = assetPath('environments/neutral_HDR.jpg');

interface Preset {
  model: string;
  image: string;
  skybox: string;
}

const PRESET_A: Preset = {
  model: ENVIRONMENT_A,
  image: HDR_A,
  skybox: SKY_A
};
const PRESET_B: Preset = {
  model: ENVIRONMENT_B,
  image: HDR_B,
  skybox: SKY_B
};

function textureByteLength(texture: Texture|null|undefined): number {
  const image = texture?.image as {
    width?: number;
    height?: number;
    data?: {byteLength?: number}
  }
  |undefined;
  if (image == null) {
    return 0;
  }
  if (image.data != null && typeof image.data.byteLength === 'number') {
    return image.data.byteLength;
  }
  const width = image.width ?? 0;
  const height = image.height ?? 0;
  return width * height * 4;
}

function sceneSourceBytes(root: Object3D, seen: Set<Texture>): number {
  let bytes = 0;
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || mesh.material == null) {
      return;
    }
    const materials =
        Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      for (const key in material) {
        const value = (material as unknown as Record<string, unknown>)[key];
        if (value instanceof Texture && !seen.has(value)) {
          seen.add(value);
          bytes += textureByteLength(value);
        }
      }
    }
  });
  return bytes;
}

function memorySnapshot(element: ModelViewerElement) {
  const scene = element[$scene];
  const seen = new Set<Texture>();
  let sourceBytes = sceneSourceBytes(scene, seen);
  if (scene.environment instanceof Texture && !seen.has(scene.environment)) {
    sourceBytes += textureByteLength(scene.environment);
    seen.add(scene.environment);
  }
  if (scene.background instanceof Texture && !seen.has(scene.background)) {
    sourceBytes += textureByteLength(scene.background);
  }
  const info = element[$renderer].threeRenderer.info.memory;
  return {
    textures: info.textures,
    geometries: info.geometries,
    sourceMB: Math.round(sourceBytes / (1024 * 1024) * 10) / 10,
  };
}

async function settle(element: ModelViewerElement) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const renderer = element[$renderer].threeRenderer;
  const scene = element[$scene];
  renderer.render(scene, scene.camera);
  renderer.render(scene, scene.camera);
}

async function applyPreset(element: ModelViewerElement, preset: Preset) {
  const modelChanged = element.environmentModel !== preset.model;
  const imageChanged = element.environmentImage !== preset.image ||
      element.skyboxImage !== preset.skybox;
  const modelLoad = modelChanged ?
      waitForEvent(element, 'environment-model-load') :
      Promise.resolve();
  const imageLoad = imageChanged ? waitForEvent(element, 'environment-change') :
                                   Promise.resolve();
  element.environmentModel = preset.model;
  element.environmentImage = preset.image;
  element.skyboxImage = preset.skybox;
  await Promise.all([modelLoad, imageLoad]);
  await settle(element);
}

suite('environment cache disposal', function() {
  this.timeout(60000);
  let element: ModelViewerElement;
  let previousEnvironmentCache: number;
  let previousImageCache: number;

  setup(async () => {
    previousEnvironmentCache = ModelViewerElement.environmentCacheSize;
    previousImageCache = ModelViewerElement.environmentImageCacheSize;
    ModelViewerElement.environmentCacheSize = 0;
    ModelViewerElement.environmentImageCacheSize = 0;
    element = new ModelViewerElement();
    document.body.insertBefore(element, document.body.firstChild);
    const load = waitForEvent(element, 'load');
    element.src = PRODUCT;
    await load;
  });

  teardown(async () => {
    element.remove();
    ModelViewerElement.environmentCacheSize = previousEnvironmentCache;
    ModelViewerElement.environmentImageCacheSize = previousImageCache;
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  test(
      'repeated preset switches with empty caches return to one preset',
      async () => {
        await applyPreset(element, PRESET_A);
        const baseline = memorySnapshot(element);

        await applyPreset(element, PRESET_B);
        await applyPreset(element, PRESET_A);
        await applyPreset(element, PRESET_B);
        await applyPreset(element, PRESET_A);
        const after = memorySnapshot(element);

        const report = `baseline textures=${baseline.textures} geometries=${
            baseline.geometries} sourceMB=${
            baseline.sourceMB}; after textures=${after.textures} geometries=${
            after.geometries} sourceMB=${after.sourceMB}`;
        expect(after.textures, report).to.be.at.most(baseline.textures);
        expect(after.geometries, report).to.be.at.most(baseline.geometries);
        expect(after.sourceMB, report).to.be.at.most(baseline.sourceMB + 0.5);
      });
});
