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
  attachLDWaterSky,
  createLDWaterPreset,
  ensureLDWaterModelNormals,
  registerLDWaterBuoyancy,
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
    expect(waterElement.waterQuality).to.equal('medium');
    expect(waterElement.waterElevation).to.equal(0);
    expect(waterElement.waterSeed).to.equal(null);
    expect(waterElement.waterSkyImage).to.equal(null);
    expect(waterElement.waterBuoyancy).to.equal(false);
  });

  test('keeps LD boat water close to upstream sunset energy', () => {
    const upstreamSunset = {
      clipmap: {baseSize: 800, levels: 5},
      waves: {
        fft: {
          amplitude: 1.56,
          frequency: 1.04,
          animationSpeed: 3.4,
          windSpeed: 17.9,
          choppiness: 2.63,
          cascades: {
            ripples: {scale: 379, amplitudeScale: 0.04},
            waves: {scale: 2088, amplitudeScale: 0.33},
          },
        },
        gerstner: {
          wavelength: 852,
          amplitude: 2.06,
        },
      },
    };
    const waterModule = {
      getPresetParams: (name: string) => {
        expect(name).to.equal('sunset');
        return upstreamSunset;
      },
    };

    const preset = createLDWaterPreset('ld-boat', waterModule as any) as any;

    expect(preset).not.to.equal(upstreamSunset);
    expect(preset.clipmap.baseSize).to.equal(800);
    expect(preset.waves.fft.amplitude).to.equal(1.56);
    expect(preset.waves.fft.windSpeed).to.equal(17.9);
    expect(preset.waves.fft.choppiness).to.equal(2.63);
    expect(preset.waves.fft.cascades.ripples.scale).to.equal(379);
    expect(preset.waves.fft.cascades.waves.scale).to.equal(2088);
    expect(preset.waves.gerstner.amplitude).to.equal(2.06);
    expect(preset.waves.gerstner.wavelength).to.equal(852);
    expect(upstreamSunset.waves.gerstner.wavelength).to.equal(852);
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

  test('creates a real-scale LD boat preset without scaling post effects into artifacts', () => {
    const upstreamSunset = {
      clipmap: {baseSize: 800, levels: 5},
      foam: {
        surface: {size: 261},
        waves: {size: 481},
        shoreline: {size: 101, range: 43},
      },
      fog: {
        fadeEnd: 10000,
        fadeStart: 2850,
        skyBlendDistance: 2700,
      },
      fresnel: {
        surface: {fadeStart: 2000},
      },
      oceanFloor: {
        depth: 100,
        displacementScale: 140,
        displacementStrength: 8,
        tileSize: 400,
        caustics: {scale: 150},
      },
      postProcessing: {
        rain: {
          fadeDistance: 40,
          rippleFadeEnd: 500,
          rippleSize: 2.5,
          streakLength: 1,
          streakWidth: 0.01,
        },
        underwaterParticles: {
          farDistance: 209,
          maxSize: 0.5,
          minSize: 0.1,
          nearDistance: 9,
        },
      },
      sky: {
        reflectionBlurDistance: 1500,
        source: {type: 'hdri', url: 'sky.jpg'},
      },
      sparkle: {
        fadeDistance: 1440,
        minDistance: 0,
      },
      spray: {
        size: 49.9,
        submersionDepth: 2,
      },
      waves: {
        fft: {
          amplitude: 1.56,
          frequency: 1.04,
          animationSpeed: 3.4,
          windSpeed: 17.9,
          choppiness: 2.63,
          cascades: {
            ripples: {scale: 379, amplitudeScale: 0.04},
            waves: {scale: 2088, amplitudeScale: 0.33},
          },
        },
        gerstner: {
          wavelength: 852,
          amplitude: 2.06,
          wavelengthSpread: 1.61,
          directionalSpread: 0.8,
        },
      },
    };
    const waterModule = {
      getPresetParams: (name: string) => {
        expect(name).to.equal('sunset');
        return upstreamSunset;
      },
    };

    const preset =
        createLDWaterPreset('ld-boat-real-scale' as any, waterModule as any) as
        any;

    expect(preset.clipmap.baseSize).to.be.closeTo(53.333, 0.001);
    expect(preset.foam.surface.size).to.be.closeTo(17.4, 0.001);
    expect(preset.foam.waves.size).to.be.closeTo(32.067, 0.001);
    expect(preset.foam.shoreline.range).to.be.closeTo(2.867, 0.001);
    expect(preset.fog.fadeStart).to.equal(2850);
    expect(preset.fresnel.surface.fadeStart).to.equal(2000);
    expect(preset.oceanFloor.depth).to.be.closeTo(6.667, 0.001);
    expect(preset.oceanFloor.displacementStrength).to.be.closeTo(0.533, 0.001);
    expect(preset.oceanFloor.caustics.scale).to.equal(10);
    expect(preset.postProcessing.rain.rippleSize).to.equal(2.5);
    expect(preset.postProcessing.underwaterParticles.enabled).to.equal(false);
    expect(preset.postProcessing.underwaterParticles.maxSize).to.equal(0.5);
    expect(preset.sky.reflectionBlurDistance).to.equal(1500);
    expect(preset.spray.submersionDepth).to.equal(2);
    expect(preset.waves.fft.amplitude).to.be.closeTo(0.208, 0.001);
    expect(preset.waves.fft.windSpeed).to.equal(17.9);
    expect(preset.waves.fft.choppiness).to.equal(2.63);
    expect(preset.waves.fft.cascades.ripples.scale)
        .to.be.closeTo(25.267, 0.001);
    expect(preset.waves.fft.cascades.waves.scale)
        .to.be.closeTo(139.2, 0.001);
    expect(preset.waves.gerstner.amplitude).to.be.closeTo(0.275, 0.001);
    expect(preset.waves.gerstner.wavelength).to.be.closeTo(56.8, 0.001);
  });

  test('registers a real-scale Centurion hull with buoyancy', () => {
    const boat = new Mesh(new BoxGeometry(7.627, 1, 2.971), new MeshBasicMaterial());
    const calls: Array<{object: Mesh, options: any}> = [];
    const masks: Mesh[] = [];
    const waterSystem = {
      buoyancy: {
        addObject: (object: Mesh, options: any) => {
          calls.push({object, options});
          return 42;
        },
      },
      masking: {
        add: (object: Mesh) => {
          masks.push(object);
        },
      },
    };

    const id = registerLDWaterBuoyancy(waterSystem as any, boat);

    expect(id).to.equal(42);
    expect(calls).to.have.lengthOf(1);
    expect(calls[0].object).to.equal(boat);
    expect(masks).to.deep.equal([boat]);
    expect(calls[0].options.multiPoint).to.equal(true);
    expect(calls[0].options.useBoundingBox).to.equal(false);
    expect(calls[0].options.sampleLength).to.equal(7.627);
    expect(calls[0].options.sampleWidth).to.equal(2.971);
    expect(calls[0].options.sampleOffset).to.deep.equal(new Vector3(0, 0, 0));
    expect(calls[0].options.heightOffset).to.equal(-5.9);
    expect(calls[0].options.rotationInfluence).to.equal(0.45);
  });

  test('registers a scale-equivalent Centurion hull with real-scale buoyancy', () => {
    const boat = new Mesh(new BoxGeometry(7.627, 1, 2.971), new MeshBasicMaterial());
    const calls: Array<{object: Mesh, options: any}> = [];
    const masks: Mesh[] = [];
    const waterSystem = {
      buoyancy: {
        addObject: (object: Mesh, options: any) => {
          calls.push({object, options});
          return 42;
        },
      },
      masking: {
        add: (object: Mesh) => {
          masks.push(object);
        },
      },
    };

    const id =
        registerLDWaterBuoyancy(waterSystem as any, boat, 'ld-boat-real-scale' as any);

    expect(id).to.equal(42);
    expect(calls).to.have.lengthOf(1);
    expect(masks).to.deep.equal([boat]);
    expect(calls[0].options.sampleLength).to.equal(7.627);
    expect(calls[0].options.sampleWidth).to.equal(2.971);
    expect(calls[0].options.heightOffset).to.be.closeTo(-0.393, 0.001);
  });

  test('attaches an opt-in water sky without changing environment attributes', () => {
    const texture = {};
    const scene = new Object3D();
    const skyMesh = new Object3D();
    const skyCalls: any[] = [];
    const setSkyCalls: any[] = [];
    const waterModule = {
      Sky: class {
        constructor(params: any) {
          skyCalls.push(params);
        }

        getMeshes() {
          return [skyMesh];
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
        waterSystem as any, scene, waterModule as any, texture as any);

    expect(skyCalls).to.have.lengthOf(1);
    expect(skyCalls[0].equirect).to.equal(texture);
    expect(skyCalls[0].sunDirection).to.equal(waterSystem.lighting.sun.direction);
    expect(setSkyCalls).to.deep.equal([sky]);
    expect(skyMesh.parent).to.equal(scene);
    expect(element.environmentImage).to.equal('neutral');
    expect(element.skyboxImage).to.equal('legacy');
  });

  test('applies water elevation to the water system', () => {
    let elevation: number|null = null;

    applyLDWaterElevation({
      setElevation: (value: number) => {
        elevation = value;
      },
    } as any, -0.8);

    expect(elevation).to.equal(-0.8);
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
