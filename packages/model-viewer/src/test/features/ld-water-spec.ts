/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Vector3,
} from 'three';

import {$renderer, $scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {
  applyLDWaterCameraRange,
  applyLDWaterClipPlaneDistance,
  applyLDWaterElevation,
  applyLDWaterHeroCamera,
  attachLDWaterSky,
  createLDWaterPreset,
  ensureLDWaterModelNormals,
  hullForSource,
  ldWaterHeightOffset,
  placeLDWaterHull,
  registerLDWaterBuoyancy,
  sunFromSkyProClock,
} from '../../features/ld-water.js';
import {waitForEvent} from '../../utilities.js';
import {rafPasses} from '../helpers.js';

suite('LDWater', () => {
  let element: ModelViewerElement;

  setup(() => {
    element = new ModelViewerElement();
    document.body.insertBefore(element, document.body.firstChild);
  });

  teardown(() => {
    element.remove();
  });

  test('has disabled water defaults', () => {
    const waterElement = element as any;

    expect(waterElement.water).to.equal(false);
    expect(waterElement.waterPreset).to.equal('ld-boat');
    expect(waterElement.waterQuality).to.equal('high');
    expect(waterElement.waterView).to.equal('orbit');
    expect(waterElement.waterWaterline).to.equal(null);
    expect(waterElement.waterElevation).to.equal(0);
    expect(waterElement.waterSeed).to.equal(null);
    expect(waterElement.waterSkyImage).to.equal(null);
    expect(waterElement.waterBuoyancy).to.equal(false);
  });

  test('maps LD boat water onto the v3.5.1 hero', () => {
    const dusk = {
      clipmap: {baseSize: 200, levels: 5},
      waves: {
        fft: {
          amplitude: 1,
          windSpeed: 7,
          peakWavelength: 140,
          cascades: {maxScale: 1024},
        },
      },
      sky: {
        reflectionRoughness: 0.15,
        sun: {elevation: 6, azimuth: 44, diskEnabled: false},
      },
    };
    const waterModule = {
      getPresetParams: (name: string) => {
        expect(name).to.equal('dusk');
        return dusk;
      },
    };

    const preset = createLDWaterPreset('ld-boat', waterModule as any) as any;
    const sun = sunFromSkyProClock(16, 45);

    expect(preset).not.to.equal(dusk);
    expect(preset.clipmap.baseSize).to.equal(200);
    expect(preset.waves.fft.amplitude).to.equal(1);
    expect(preset.waves.fft.windSpeed).to.equal(6.7);
    expect(preset.waves.fft.peakWavelength).to.equal(22);
    expect(preset.waves.fft.cascades.maxScale).to.equal(1024);
    expect(preset.sky.sun.diskEnabled).to.equal(true);
    expect(preset.sky.sun.elevation).to.be.closeTo(sun.elevation, 0.001);
    expect(preset.sky.sun.azimuth).to.be.closeTo(sun.azimuth, 0.001);
    expect(sun.elevation).to.be.closeTo(13.138, 0.01);
    expect(dusk.waves.fft.peakWavelength).to.equal(140);
  });

  test('loads upstream demo water presets without changing their values', () => {
    const upstreamStorm = {
      clipmap: {baseSize: 900, levels: 5},
      waves: {
        fft: {amplitude: 3.2},
        gerstner: {wavelength: 640, amplitude: 4.5},
      },
    };
    const waterModule = {
      getPresetParams: (name: string) => {
        expect(name).to.equal('storm');
        return upstreamStorm;
      },
    };

    const preset = createLDWaterPreset('storm' as any, waterModule as any) as any;

    expect(preset).not.to.equal(upstreamStorm);
    expect(preset.clipmap.baseSize).to.equal(900);
    expect(preset.waves.fft.amplitude).to.equal(3.2);
    expect(preset.waves.gerstner.wavelength).to.equal(640);
  });

  test('uses the same hero recipe for the real-scale preset name', () => {
    const dusk = {
      waves: {fft: {amplitude: 1, windSpeed: 7, peakWavelength: 140}},
      sky: {sun: {elevation: 6, azimuth: 44, diskEnabled: false}},
    };
    const waterModule = {
      getPresetParams: (name: string) => {
        expect(name).to.equal('dusk');
        return structuredClone(dusk);
      },
    };

    const hero = createLDWaterPreset('ld-boat', waterModule as any) as any;
    const real = createLDWaterPreset('ld-boat-real-scale' as any, waterModule as any) as any;

    expect(real.waves.fft.windSpeed).to.equal(hero.waves.fft.windSpeed);
    expect(real.waves.fft.peakWavelength).to.equal(22);
    expect(real.waves.fft.amplitude).to.equal(1);
    expect(real.sky.sun.elevation).to.equal(hero.sky.sun.elevation);
  });

  test('registers a hull on its painted waterline', () => {
    const boat = new Mesh(new BoxGeometry(8, 2, 4), new MeshBasicMaterial());
    const root = new Object3D();
    root.add(boat);
    const calls: Array<{object: Mesh, options: any}> = [];
    const masks: Object3D[] = [];
    const waterSystem = {
      buoyancy: {
        addObject: (object: Mesh, options: any) => {
          calls.push({object, options});
          return 42;
        },
      },
      masking: {
        add: (object: Object3D) => {
          masks.push(object);
        },
      },
    };

    const placement = placeLDWaterHull(boat, 0.5, 'x');
    const id = registerLDWaterBuoyancy(waterSystem as any, boat, placement);

    expect(id).to.equal(42);
    expect(masks).to.deep.equal([boat]);
    expect(calls[0].options.multiPoint).to.equal(true);
    expect(calls[0].options.useBoundingBox).to.equal(false);
    expect(calls[0].options.heightOffset).to.equal(-0.5);
    expect(ldWaterHeightOffset(0)).to.equal(0);
    expect(calls[0].options.rotationInfluence).to.equal(0.35);
    expect(calls[0].options.sampleLength).to.be.closeTo(8 * 0.85, 0.02);
    expect(calls[0].options.sampleWidth).to.be.closeTo(4 * 0.8, 0.02);
    expect(placement.yaw).to.equal(-Math.PI / 2);
    expect(hullForSource('puzzle/17949ff9-26b2-7158-9112-42b65bcb9d37.glb')!.waterline)
        .to.equal(0.5);
    expect(hullForSource('49cdcf76-f547-483d-ce9b-dee55109f95e.glb')!.waterline)
        .to.equal(0.95);
    expect(hullForSource('dutch_ship_medium_2k.glb')!.waterline).to.equal(0);
  });

  test('attaches a v3.5.1 sky through setSky', () => {
    const texture = {};
    const renderer = {};
    const skyCalls: any[] = [];
    const setSkyCalls: any[] = [];
    const waterModule = {
      Sky: class {
        constructor(passedRenderer: unknown, params: any) {
          skyCalls.push({renderer: passedRenderer, params});
        }

        getMeshes() {
          return [new Object3D()];
        }
      },
    };
    const waterSystem = {
      lighting: {sun: {direction: new Vector3(1, 1, 0)}},
      setSky: (sky: unknown) => {
        setSkyCalls.push(sky);
      },
    };
    element.environmentImage = 'neutral';
    element.skyboxImage = 'legacy';

    const sky = attachLDWaterSky(
        waterSystem as any, renderer, waterModule as any, texture as any, 0.15);

    expect(skyCalls).to.have.lengthOf(1);
    expect(skyCalls[0].renderer).to.equal(renderer);
    expect(skyCalls[0].params.equirect).to.equal(texture);
    expect(skyCalls[0].params.reflectionBlurDistance).to.equal(undefined);
    expect(skyCalls[0].params.sunDirection).to.equal(waterSystem.lighting.sun.direction);
    expect(skyCalls[0].params.brightness).to.equal(1.18);
    expect(setSkyCalls).to.deep.equal([sky]);
    expect(skyCalls[0].params).to.not.equal(undefined);
    expect((sky as any).getMeshes()[0].parent).to.equal(null);
    expect(element.environmentImage).to.equal('neutral');
    expect(element.skyboxImage).to.equal('legacy');
  });

  test('leaves the water surface at y = 0', () => {
    expect(() => applyLDWaterElevation({}, -0.8)).not.to.throw();
  });

  test('frames two hulls from the same hero bearing', () => {
    const ri = new Mesh(new BoxGeometry(8, 3, 4), new MeshBasicMaterial());
    const aq = new Mesh(new BoxGeometry(4, 4, 14), new MeshBasicMaterial());
    new Object3D().add(ri);
    new Object3D().add(aq);
    const riPlacement = placeLDWaterHull(ri, 0.5, 'x');
    const aqPlacement = placeLDWaterHull(aq, 0.95, 'z');
    const camera = new PerspectiveCamera();
    applyLDWaterHeroCamera(camera, riPlacement, ri);
    const riDir = camera.position.clone().sub(riPlacement.worldCenter).normalize();
    applyLDWaterHeroCamera(camera, aqPlacement, aq);
    const aqDir = camera.position.clone().sub(
        new Vector3(
            aq.parent!.position.x,
            aq.parent!.position.y + aq.position.y +
                (aqPlacement.worldCenter.y - aqPlacement.heightOffset),
            aq.parent!.position.z)).normalize();
    expect(riDir.distanceTo(aqDir)).to.be.below(1e-6);
    expect(camera.fov).to.equal(50);
  });

  test('scales the water clip plane distance for real-scale camera distance', () => {
    const waterSystem = {clipPlaneDistance: 20};

    applyLDWaterClipPlaneDistance(waterSystem as any, 'ld-boat-real-scale' as any);

    expect(waterSystem.clipPlaneDistance).to.be.closeTo(1.333, 0.001);
  });

  test('keeps the reference water clip plane distance for the 15x page', () => {
    const waterSystem = {clipPlaneDistance: 1};

    applyLDWaterClipPlaneDistance(waterSystem as any, 'ld-boat');

    expect(waterSystem.clipPlaneDistance).to.equal(20);
  });

  test('expands the camera far plane for ocean rendering', () => {
    const camera = new PerspectiveCamera();
    camera.far = 100;

    applyLDWaterCameraRange(camera, 50000);

    expect(camera.far).to.equal(50000);
  });

  test('computes missing model normals before WebGPU water renders', () => {
    const root = new Object3D();
    const geometry = new BufferGeometry();
    geometry.setAttribute(
        'position',
        new BufferAttribute(
            new Float32Array([-1, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    root.add(mesh);

    ensureLDWaterModelNormals(root);

    expect(geometry.getAttribute('normal')).to.not.equal(undefined);
  });

  test('keeps water objects outside the main target', async () => {
    const scene = element[$scene] as any;
    const main = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    const water = new Mesh(new BoxGeometry(100, 1, 100), new MeshBasicMaterial());

    await scene.setObject(main);
    const dimensions = element.getDimensions().toString();
    scene.setWater(water);

    expect(scene.waterRoot.parent).to.equal(scene);
    expect(water.parent).to.equal(scene.waterRoot);
    expect(element.getDimensions().toString()).to.equal(dimensions);
    expect(scene.target.children).not.to.include(water);
  });

  test('removes water objects and runs their disposer', () => {
    const scene = element[$scene] as any;
    const water = new Mesh(new BoxGeometry(100, 1, 100), new MeshBasicMaterial());
    let disposed = false;

    scene.setWater(water, () => {
      disposed = true;
    });
    scene.clearWater();

    expect(scene.waterRoot.children).to.have.lengthOf(0);
    expect(water.parent).to.equal(null);
    expect(disposed).to.equal(true);
  });

  test('does not let water presets mutate environment attributes', async () => {
    const waterElement = element as any;
    element.environmentImage = 'neutral';
    element.skyboxImage = 'legacy';

    waterElement.waterPreset = 'ld-boat';
    waterElement.water = true;
    await element.updateComplete;

    expect(element.environmentImage).to.equal('neutral');
    expect(element.skyboxImage).to.equal('legacy');
  });

  test('requests WebGPU when water is enabled', async () => {
    let requestedBackend: string|null = null;
    const originalRequestBackend = element[$renderer].requestBackend;
    element[$renderer].requestBackend = async (backend: any) => {
      requestedBackend = backend;
      throw new Error('WebGPU is not available in this browser.');
    };
    const waterError = waitForEvent<CustomEvent>(element, 'water-error');

    try {
      (element as any).water = true;
      await element.updateComplete;
      await rafPasses();

      const event = await waterError;
      expect(requestedBackend).to.equal('webgpu');
      expect(event.detail.error.message).to.contain(
          'WebGPU is not available');
    } finally {
      element[$renderer].requestBackend = originalRequestBackend;
    }
  });

  test('disables soft shadows when water is enabled', async () => {
    const scene = element[$scene] as any;
    const originalRequestBackend = element[$renderer].requestBackend;
    scene.setShadowMode('soft-shadow');
    element[$renderer].requestBackend = async () => {
      throw new Error('WebGPU is not available in this browser.');
    };
    const waterError = waitForEvent<CustomEvent>(element, 'water-error');

    try {
      (element as any).water = true;
      await element.updateComplete;
      await rafPasses();
      await waterError;

      expect(scene.shadowMode).to.equal('none');
    } finally {
      element[$renderer].requestBackend = originalRequestBackend;
    }
  });

  test('honors an initial water attribute after connection', async () => {
    element.remove();

    element = new ModelViewerElement();
    const originalRequestBackend = element[$renderer].requestBackend;
    element[$renderer].requestBackend = async () => {
      throw new Error('WebGPU is not available in this browser.');
    };
    element.setAttribute('water', '');
    const waterError = waitForEvent<CustomEvent>(element, 'water-error');
    document.body.insertBefore(element, document.body.firstChild);

    try {
      await element.updateComplete;
      await rafPasses();

      const event = await waterError;
      expect((element as any).water).to.equal(true);
      expect(event.detail.error.message).to.contain('WebGPU');
    } finally {
      element[$renderer].requestBackend = originalRequestBackend;
    }
  });
});
