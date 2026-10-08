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
  alignLDWaterCaptureViewport,
  resolveLDWaterCaptureViewport,
  applyWaterSunPolicy,
  directionFromSkySun,
  ldWaterCaptureMatchesBeautyFragment,
  parseSkySunTime,
  applyLDWaterCameraRange,
  applyLDWaterClipPlaneDistance,
  applyLDWaterElevation,
  attachLDWaterSky,
  createLDWaterPreset,
  ensureLDWaterModelNormals,
  ldWaterHeightOffset,
  LDWaterDrive,
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

  test('full-buffer captures use the beauty viewport', () => {
    const viewport = {
      x: 0,
      y: 0,
      z: 1071,
      w: 759,
      set(x: number, y: number, width: number, height: number) {
        this.x = x;
        this.y = y;
        this.z = width;
        this.w = height;
      },
    };
    const changed = alignLDWaterCaptureViewport(
      {width: 1071, height: 759, viewport},
      {x: 0, y: 0, z: 846, w: 600},
      1071,
      759
    );

    expect(changed).to.equal(true);
    expect(viewport.z).to.equal(846);
    expect(viewport.w).to.equal(600);
  });

  test('scales 0.79 and 0.5 sample the beauty fragment, not a zoomed copy', () => {
    const renderer = element[$renderer] as unknown as {scaleStep: number, scaleFactor: number};
    const frames = [
      {step: 1, scale: 0.79, viewW: 846, viewH: 600},
      {step: 3, scale: 0.5, viewW: 536, viewH: 380},
    ];
    const bufferW = 1071;
    const bufferH = 759;

    try {
      for (const frame of frames) {
        renderer.scaleStep = frame.step;
        expect(renderer.scaleFactor).to.be.closeTo(frame.scale, 1e-6);

        const viewport = {
          x: 0,
          y: 0,
          z: bufferW,
          w: bufferH,
          set(x: number, y: number, width: number, height: number) {
            this.x = x;
            this.y = y;
            this.z = width;
            this.w = height;
          },
        };
        const changed = alignLDWaterCaptureViewport(
          {width: bufferW, height: bufferH, viewport},
          {x: 0, y: 0, z: frame.viewW, w: frame.viewH},
          bufferW,
          bufferH
        );
        expect(changed).to.equal(true);
        expect(viewport.z).to.equal(frame.viewW);
        expect(viewport.w).to.equal(frame.viewH);

        const fragX = frame.viewW * 0.5;
        const fragY = frame.viewH * 0.5;
        const center = ldWaterCaptureMatchesBeautyFragment(
          fragX,
          fragY,
          bufferW,
          bufferH,
          viewport
        );
        const corner = ldWaterCaptureMatchesBeautyFragment(
          frame.viewW - 0.5,
          frame.viewH - 0.5,
          bufferW,
          bufferH,
          viewport
        );
        const outside = ldWaterCaptureMatchesBeautyFragment(
          frame.viewW + 8,
          frame.viewH * 0.5,
          bufferW,
          bufferH,
          viewport
        );
        expect(center).to.equal(true);
        expect(corner).to.equal(true);
        expect(outside).to.equal(false);

        const zoomX = (fragX / frame.viewW) * bufferW;
        const zoomY = (fragY / frame.viewH) * bufferH;
        const offset = Math.hypot(zoomX - fragX, zoomY - fragY);
        expect(offset).to.be.greaterThan(bufferW * 0.1);
      }

      const full = ldWaterCaptureMatchesBeautyFragment(
        bufferW * 0.5,
        bufferH * 0.5,
        bufferW,
        bufferH,
        {x: 0, y: 0, z: bufferW, w: bufferH}
      );
      expect(full).to.equal(false);
    } finally {
      renderer.scaleStep = 0;
      expect(renderer.scaleFactor).to.equal(1);
    }
  });

  test('a full-buffer canvas viewport still samples the beauty slice', () => {
    // Page-environment PMREM calls setSize and resets the canvas viewport
    // to the drawing buffer. The old hook copied that viewport, so scales
    // 0.79 and 0.5 captured the full buffer and the lake showed a second
    // boat. The saved beauty rect has to win. Dilation is not a boat count.
    const bufferW = 1071;
    const bufferH = 759;
    const frames = [
      {viewW: 846, viewH: 600},
      {viewW: 536, viewH: 380},
    ];
    const clobbered = {x: 0, y: 0, z: bufferW, w: bufferH};

    for (const frame of frames) {
      const beauty = {x: 0, y: 0, z: frame.viewW, w: frame.viewH};
      const viewport = {
        x: 0,
        y: 0,
        z: bufferW,
        w: bufferH,
        set(x: number, y: number, width: number, height: number) {
          this.x = x;
          this.y = y;
          this.z = width;
          this.w = height;
        },
      };
      const resolved = resolveLDWaterCaptureViewport(beauty, clobbered);
      const changed = alignLDWaterCaptureViewport(
        {width: bufferW, height: bufferH, viewport},
        resolved,
        bufferW,
        bufferH
      );
      expect(changed).to.equal(true);
      expect(viewport.z).to.equal(frame.viewW);
      expect(viewport.w).to.equal(frame.viewH);
      expect(ldWaterCaptureMatchesBeautyFragment(
        frame.viewW * 0.5,
        frame.viewH * 0.5,
        bufferW,
        bufferH,
        viewport
      )).to.equal(true);

      const stale = {
        x: 0,
        y: 0,
        z: bufferW,
        w: bufferH,
        set(x: number, y: number, width: number, height: number) {
          this.x = x;
          this.y = y;
          this.z = width;
          this.w = height;
        },
      };
      const ignored = alignLDWaterCaptureViewport(
        {width: bufferW, height: bufferH, viewport: stale},
        resolveLDWaterCaptureViewport(null, clobbered),
        bufferW,
        bufferH
      );
      expect(ignored).to.equal(false);
      expect(stale.z).to.equal(bufferW);
      expect(ldWaterCaptureMatchesBeautyFragment(
        frame.viewW * 0.5,
        frame.viewH * 0.5,
        bufferW,
        bufferH,
        stale
      )).to.equal(false);
    }
  });

  test('scaled water passes keep their viewport', () => {
    const viewport = {
      x: 0,
      y: 0,
      z: 267,
      w: 189,
      set() {
        throw new Error('scaled pass viewport should stay put');
      },
    };
    const changed = alignLDWaterCaptureViewport(
      {width: 267, height: 189, viewport},
      {x: 0, y: 0, z: 846, w: 600},
      1071,
      759
    );

    expect(changed).to.equal(false);
    expect(viewport.z).to.equal(267);
  });

  test('has disabled water defaults', () => {
    const waterElement = element as any;

    expect(waterElement.water).to.equal(false);
    expect(waterElement.waterPreset).to.equal('ld-boat');
    expect(waterElement.waterQuality).to.equal('high');
    expect(waterElement.waterWaterline).to.equal(0);
    expect(waterElement.waterBow).to.equal(undefined);
    expect(waterElement.waterView).to.equal(undefined);
    expect(waterElement.waterElevation).to.equal(0);
    expect(waterElement.waterSeed).to.equal(null);
    expect(waterElement.waterBuoyancy).to.equal(false);
    expect(waterElement.waterDrive).to.equal(false);
  });

  test('water-drive is the optional WASD helm', async () => {
    const waterElement = element as any;
    element.setAttribute('water-drive', '');
    await waterElement.updateComplete;
    expect(waterElement.waterDrive).to.equal(true);

    element.removeAttribute('water-drive');
    await waterElement.updateComplete;
    expect(waterElement.waterDrive).to.equal(false);
  });

  test('drives along glTF +Z and yaws with A at speed', () => {
    const model = new Object3D();
    const drive = new LDWaterDrive();
    drive.bind(model);
    drive.setKey('w', true);
    for (let i = 0; i < 40; i++) {
      drive.update(0.05);
    }

    expect(model.position.z).to.be.greaterThan(0.5);
    expect(Math.abs(model.position.x)).to.be.lessThan(0.05);
    expect(drive.yaw).to.be.closeTo(0, 1e-6);
    expect(model.quaternion.y).to.be.closeTo(0, 1e-6);

    drive.speed = 6;
    drive.setKey('w', false);
    drive.setKey('a', true);
    let synced = 0;
    for (let i = 0; i < 40; i++) {
      drive.update(0.05, (offset) => {
        synced = offset.y;
      });
    }

    expect(drive.yaw).to.be.greaterThan(0.01);
    expect(synced).to.be.closeTo(drive.yaw, 1e-6);
    expect(model.rotation.y).to.equal(0);

    const heldZ = model.position.z;
    drive.speed = 0;
    drive.swaySpeed = 0;
    drive.yawRate = 0;
    drive.throttle = 0;
    drive.rudderAngle = 0;
    drive.setKey('a', false);
    drive.setKey('w', false);
    drive.update(0.05);
    expect(model.position.z).to.equal(heldZ);
  });

  test('reads WASD from the document and ignores form fields', () => {
    const model = new Object3D();
    const drive = new LDWaterDrive();
    drive.bind(model);
    drive.attach(document);
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'W'}));
    drive.update(0.1);
    expect(drive.throttle).to.be.greaterThan(0);
    document.dispatchEvent(new KeyboardEvent('keyup', {key: 'w'}));

    const input = document.createElement('input');
    document.body.appendChild(input);
    drive.throttle = 0;
    drive.speed = 0;
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 's'}));
    drive.update(0.1);
    expect(drive.throttle).to.equal(0);
    input.remove();

    drive.detach();
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'w'}));
    drive.update(0.1);
    expect(drive.throttle).to.equal(0);
    expect(model.position.z).to.be.greaterThan(0);
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

    expect(preset).not.to.equal(dusk);
    expect(preset.clipmap.baseSize).to.equal(200);
    expect(preset.waves.fft.amplitude).to.equal(1);
    expect(preset.waves.fft.windSpeed).to.equal(6.7);
    expect(preset.waves.fft.peakWavelength).to.equal(22);
    expect(preset.waves.fft.cascades.maxScale).to.equal(1024);
    expect(preset.sky.sun.diskEnabled).to.equal(false);
    expect(preset.sky.sun.elevation).to.equal(6);
    expect(preset.sky.sun.azimuth).to.equal(44);
    const sun = sunFromSkyProClock(16, 45);
    expect(sun.elevation).to.be.closeTo(13.138, 0.01);
    const aim = directionFromSkySun(sun.elevation, sun.azimuth);
    expect(aim.y).to.be.closeTo(Math.sin(sun.elevation * Math.PI / 180), 1e-6);
    expect(aim.length()).to.be.closeTo(1, 1e-6);
    expect(parseSkySunTime('16:45')).to.deep.equal({hours: 16, minutes: 45});
    expect(parseSkySunTime('')).to.equal(null);
    expect(parseSkySunTime('24:00')).to.equal(null);
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
    expect(real.sky.sun.elevation).to.equal(6);
    expect(hero.sky.sun.elevation).to.equal(6);
  });

  test('drops a hull by its waterline and keeps authored yaw', () => {
    const boat = new Mesh(new BoxGeometry(4, 2, 8), new MeshBasicMaterial());
    const root = new Object3D();
    root.add(boat);
    boat.position.set(3, 4, 5);
    boat.rotation.y = -Math.PI / 2;
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

    const placement = placeLDWaterHull(boat, 0.5);
    const id = registerLDWaterBuoyancy(waterSystem as any, boat, placement);

    expect(id).to.equal(42);
    expect(masks).to.deep.equal([boat]);
    expect(boat.position.x).to.equal(3);
    expect(boat.position.z).to.equal(5);
    expect(boat.position.y).to.equal(-0.5);
    expect(boat.rotation.y).to.equal(-Math.PI / 2);
    expect(calls[0].options.multiPoint).to.equal(true);
    expect(calls[0].options.useBoundingBox).to.equal(false);
    expect(calls[0].options.heightOffset).to.equal(-0.5);
    expect(ldWaterHeightOffset(0)).to.equal(0);
    expect(ldWaterHeightOffset(0, -0.3)).to.equal(0);
    root.position.y = -0.3;
    const shifted = placeLDWaterHull(boat, 0.95);
    expect(shifted.heightOffset).to.be.closeTo(-0.65, 1e-6);
    expect(boat.position.y).to.be.closeTo(-0.65, 1e-6);
    expect(root.position.y + boat.position.y + 0.95).to.be.closeTo(0, 1e-6);
    root.position.y = 0;
    expect(calls[0].options.rotationInfluence).to.equal(0.35);
    expect(calls[0].options.rotationOffset.y).to.be.closeTo(-Math.PI / 2, 1e-6);
    expect(calls[0].options.sampleLength).to.be.closeTo(4 * 0.85, 0.05);
    expect(calls[0].options.sampleWidth).to.be.closeTo(8 * 0.8, 0.05);
    expect(placeLDWaterHull(boat, 0).heightOffset).to.equal(0);
    expect(boat.position.y).to.equal(0);
  });

  test('builds a vendor sky without taking over the environment', () => {
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
    expect(skyCalls[0].params.brightness).to.equal(1);
    expect(skyCalls[0].params.sunOverlay.enabled).to.equal(false);
    expect(setSkyCalls).to.have.lengthOf(0);
    waterSystem.setSky(sky);
    expect(setSkyCalls).to.deep.equal([sky]);
    expect(skyCalls[0].params).to.not.equal(undefined);
    expect((sky as any).getMeshes()[0].parent).to.equal(null);
    expect(element.environmentImage).to.equal('neutral');
    expect(element.skyboxImage).to.equal('legacy');
  });

  test('leaves the water surface at y = 0', () => {
    expect(() => applyLDWaterElevation({}, -0.8)).not.to.throw();
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

  test('keeps the page grade when water turns on', async () => {
    (element as any).toneMapping = 'neutral';
    element.exposure = 1;
    const originalRequestBackend = element[$renderer].requestBackend;
    element[$renderer].requestBackend = async () => {
      throw new Error('WebGPU is not available in this browser.');
    };
    const waterError = waitForEvent<CustomEvent>(element, 'water-error');

    try {
      (element as any).water = true;
      await element.updateComplete;
      await rafPasses();
      await waterError;

      expect((element as any).toneMapping).to.equal('neutral');
      expect(element.exposure).to.equal(1);
    } finally {
      element[$renderer].requestBackend = originalRequestBackend;
    }
  });

  test('hides the vendor sun unless sky-sun-time is set', () => {
    const direction = new Vector3(0, 1, 0);
    const lighting = {
      sun: {direction: {value: direction}, intensity: {value: 2}},
      sunLight: {visible: true, intensity: 2, castShadow: true},
    };
    const off = applyWaterSunPolicy(lighting, null, 2, null);
    expect(off).to.equal('off');
    expect(lighting.sun.intensity.value).to.equal(0);
    expect(lighting.sunLight.visible).to.equal(false);
    expect(lighting.sunLight.castShadow).to.equal(false);

    const key = applyWaterSunPolicy(
      lighting, null, 2, {intensity: 3, direction: new Vector3(0, 0, 1)});
    expect(key).to.equal('key');
    expect(lighting.sunLight.visible).to.equal(false);
    expect(lighting.sun.intensity.value).to.equal(3);
    expect(lighting.sun.direction.value.z).to.be.closeTo(1, 1e-6);

    const sun = applyWaterSunPolicy(lighting, '16:45', 2, null);
    expect(sun).to.equal('sun');
    expect(lighting.sunLight.visible).to.equal(true);
    expect(lighting.sun.intensity.value).to.equal(2);
    expect(lighting.sunLight.castShadow).to.equal(false);
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
