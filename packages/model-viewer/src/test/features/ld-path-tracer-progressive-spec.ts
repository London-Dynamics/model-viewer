/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {expect} from 'chai';
import {BufferGeometry, Float32BufferAttribute} from 'three';
import {MeshBVH} from 'three-mesh-bvh';

import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {contactGroundY, expandPenumbra, stepContactRays} from '../../three-components/postprocessing/ld-path-tracer/progressive/contact-shadow.js';
import {createFade, fadeSettled, shaderAoMix, stepFade} from '../../three-components/postprocessing/ld-path-tracer/progressive/fade.js';
import {planInvalidation} from '../../three-components/postprocessing/ld-path-tracer/progressive/invalidation.js';
import {DEFAULT_PROGRESSIVE_SETTINGS, resolveProgressiveSettings} from '../../three-components/postprocessing/ld-path-tracer/progressive/options.js';
import {waitForEvent} from '../../utilities.js';
import {assetPath, rafPasses} from '../helpers.js';

const ASTRONAUT = assetPath('models/Astronaut.glb');

suite('progressive path tracer options', () => {
  test('merges nested bake settings and ignores an unknown mode', () => {
    const next = resolveProgressiveSettings(DEFAULT_PROGRESSIVE_SETTINGS, {
      mode: 'nope' as 'immediate',
      fadeMs: 120,
      bake: {contactShadow: {resolution: 64}},
    });

    expect(next.mode).to.equal('immediate');
    expect(next.fadeMs).to.equal(120);
    expect(next.bake.contactShadow.resolution).to.equal(64);
    expect(next.bake.contactShadow.softness)
        .to.equal(DEFAULT_PROGRESSIVE_SETTINGS.bake.contactShadow.softness);
    expect(next.bake.textureAO.samples).to.equal(16);
  });

  test('clamps probe count and keeps a null environment', () => {
    const next = resolveProgressiveSettings(DEFAULT_PROGRESSIVE_SETTINGS, {
      probes: {count: 99, resolution: 2},
      environment: '',
    });

    expect(next.probes.count).to.equal(4);
    expect(next.probes.resolution).to.equal(8);
    expect(next.environment).to.equal(null);
  });
});

suite('progressive path tracer fades', () => {
  test('reaches the target in fadeMs and does not overshoot', () => {
    let state = createFade(0, 1);
    state = stepFade(state, 300, 600);
    expect(state.value).to.be.closeTo(0.5, 1e-6);
    state = stepFade(state, 300, 600);
    expect(state.value).to.equal(1);
    expect(fadeSettled(state)).to.equal(true);
    state = stepFade({value: 1, target: 0}, 300, 600);
    expect(state.value).to.be.closeTo(0.5, 1e-6);
    state = stepFade(state, 1000, 600);
    expect(state.value).to.equal(0);
  });

  test('a zero duration fade snaps to the target', () => {
    const state = stepFade(createFade(0, 1), 16, 0);
    expect(state.value).to.equal(1);
  });
});

suite('progressive path tracer invalidation', () => {
  test('a geometry change restarts every layer', () => {
    const plan = planInvalidation('geometry');
    expect(plan.restartBakes).to.equal(true);
    expect(plan.restartProbes).to.equal(true);
    expect(plan.restartFullTrace).to.equal(true);
    expect(plan.rebakeLights).to.equal(true);
    expect(plan.fadeOut).to.include.members([
      'contactShadow',
      'textureAO',
      'lightLayers',
      'probes',
      'fullTrace',
    ]);
  });

  test('a material change keeps the bakes', () => {
    const plan = planInvalidation('material');
    expect(plan.restartBakes).to.equal(false);
    expect(plan.rebakeLights).to.equal(false);
    expect(plan.restartProbes).to.equal(true);
    expect(plan.restartFullTrace).to.equal(true);
    expect(plan.fadeOut).to.deep.equal(['probes', 'fullTrace']);
  });

  test(
      'a light toggle fades probes and the trace and does not rebake lights',
      () => {
        const plan = planInvalidation('light');
        expect(plan.rebakeLights).to.equal(false);
        expect(plan.restartBakes).to.equal(false);
        expect(plan.fadeOut).to.deep.equal(['probes', 'fullTrace']);
      });

  test('camera motion fades only the full trace', () => {
    const plan = planInvalidation('camera');
    expect(plan.fadeOut).to.deep.equal(['fullTrace']);
    expect(plan.restartProbes).to.equal(false);
    expect(plan.restartBakes).to.equal(false);
  });
});

suite('progressive contact shadow rays', () => {
  test('occludes texels under a triangle and leaves the corners open', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
        'position',
        new Float32BufferAttribute(
            [-0.25, 0.5, -0.25, 0.25, 0.5, -0.25, 0, 0.5, 0.25], 3));
    const bvh = new MeshBVH(geometry);
    const resolution = 16;
    const grid = new Float32Array(resolution * resolution);
    const done = stepContactRays(
        {
          resolution,
          centerX: 0,
          centerZ: 0,
          width: 2,
          depth: 2,
          y: 0,
          softnessRadius: 0,
          samples: 1,
          maxDistance: 2,
          penumbraDistance: 2,
          grid,
          cursor: 0,
        },
        bvh,
        1000);
    expect(done).to.equal(true);
    const center = grid[8 * resolution + 8];
    expect(center).to.be.greaterThan(0.5);
    expect(grid[0]).to.equal(0);
  });

  test('a near hit is darker than a high hit', () => {
    const low = new BufferGeometry();
    low.setAttribute(
        'position',
        new Float32BufferAttribute(
            [-0.2, 0.05, -0.2, 0.2, 0.05, -0.2, 0, 0.05, 0.2], 3));
    const high = new BufferGeometry();
    high.setAttribute(
        'position',
        new Float32BufferAttribute(
            [-0.2, 0.8, -0.2, 0.2, 0.8, -0.2, 0, 0.8, 0.2], 3));
    const sample = (geometry: BufferGeometry) => {
      const grid = new Float32Array(8 * 8);
      stepContactRays(
          {
            resolution: 8,
            centerX: 0,
            centerZ: 0,
            width: 2,
            depth: 2,
            y: 0,
            softnessRadius: 0,
            samples: 1,
            maxDistance: 1,
            penumbraDistance: 1,
            grid,
            cursor: 0,
          },
          new MeshBVH(geometry),
          1000);
      return grid[4 * 8 + 4];
    };
    expect(sample(low)).to.be.greaterThan(sample(high) + 0.25);
  });

  test('extra samples add a lighter skirt outside the core', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
        'position',
        new Float32BufferAttribute(
            [-0.15, 0.02, -0.15, 0.15, 0.02, -0.15, 0, 0.02, 0.15], 3));
    const resolution = 16;
    const grid = new Float32Array(resolution * resolution);
    stepContactRays(
        {
          resolution,
          centerX: 0,
          centerZ: 0,
          width: 2,
          depth: 2,
          y: 0,
          softnessRadius: 0.55,
          samples: 10,
          maxDistance: 0.25,
          penumbraDistance: 0.6,
          grid,
          cursor: 0,
        },
        new MeshBVH(geometry),
        1000);
    const at = (i: number, j: number) => grid[j * resolution + i];
    const core = at(8, 8);
    let skirt = 0;
    let far = 0;
    for (let j = 0; j < resolution; j++) {
      for (let i = 0; i < resolution; i++) {
        const u = (i + 0.5) / resolution;
        const v = (j + 0.5) / resolution;
        const x = (u - 0.5) * 2;
        const z = (0.5 - v) * 2;
        const d = Math.hypot(x, z);
        if (d > 0.22 && d < 0.45) {
          skirt = Math.max(skirt, at(i, j));
        }
        if (d > 0.9) {
          far = Math.max(far, at(i, j));
        }
      }
    }
    expect(core).to.be.greaterThan(0.7);
    expect(skirt).to.be.greaterThan(0.02);
    expect(skirt).to.be.lessThan(core * 0.5);
    expect(far).to.equal(0);
  });

  test('ground height ignores a dangling outlier below the hull', () => {
    const positions = new Float32Array(300);
    for (let i = 0; i < 100; i++) {
      positions[i * 3 + 1] = i === 0 ? -4 : 1;
    }
    expect(contactGroundY(positions, 0.04)).to.equal(1);
  });

  test('the penumbra spread stays lighter than the core', () => {
    const resolution = 32;
    const grid = new Float32Array(resolution * resolution);
    grid[16 * resolution + 16] = 1;
    expandPenumbra(grid, resolution, 4, 4, 0.8, 0.62);
    const core = grid[16 * resolution + 16];
    const near = grid[16 * resolution + 18];
    const mid = grid[16 * resolution + 20];
    const far = grid[16 * resolution + 31];
    expect(core).to.equal(1);
    expect(near).to.be.greaterThan(0.15);
    expect(near).to.be.lessThan(0.62);
    expect(mid).to.be.greaterThan(0);
    expect(mid).to.be.lessThan(near);
    expect(far).to.equal(0);
  });
});

suite('progressive shader AO handoff', () => {
  test('stays fully on while no baked AO or trace is showing', () => {
    expect(shaderAoMix(0, 0, 0)).to.equal(1);
  });

  test(
      'cross-fades out with the first baked layer over the same amount', () => {
        expect(shaderAoMix(0.25, 0, 0)).to.be.closeTo(0.75, 1e-6);
        expect(shaderAoMix(0, 0.4, 0)).to.be.closeTo(0.6, 1e-6);
        expect(shaderAoMix(1, 0, 0)).to.equal(0);
        expect(shaderAoMix(0, 1, 0)).to.equal(0);
      });

  test(
      'stays off while the full trace is showing and returns when everything is gone',
      () => {
        expect(shaderAoMix(0, 0, 0.5)).to.be.closeTo(0.5, 1e-6);
        expect(shaderAoMix(1, 0.2, 0.8)).to.equal(0);
        expect(shaderAoMix(0, 0, 0)).to.equal(1);
      });

  test('tracks a fade in and back out over fadeMs', () => {
    let contact = createFade(0, 1);
    contact = stepFade(contact, 300, 600);
    expect(shaderAoMix(contact.value, 0, 0)).to.be.closeTo(0.5, 1e-6);
    contact = {...contact, target: 0};
    contact = stepFade(contact, 300, 600);
    expect(shaderAoMix(contact.value, 0, 0)).to.be.closeTo(1, 1e-6);
  });
});

suite('progressive path tracer integration', function() {
  this.timeout(60000);

  test(
      'keeps shader AO during pure realtime and drops it when a bake is up',
      async () => {
        const element = new ModelViewerElement();
        element.style.width = '96px';
        element.style.height = '96px';
        element.interactionPrompt = 'none';
        document.body.appendChild(element);
        try {
          const loaded = waitForEvent(element, 'load');
          element.src = ASTRONAUT;
          await loaded;
          element.ambientOcclusion = true;
          element.aoIntensity = 0.8;
          element.pathTracer = true;
          element.setPathTracerOptions({
            mode: 'progressive',
            fadeMs: 0,
            budgetMs: 12,
            idleDelayMs: 1e9,
            bake: {
              contactShadow: {enabled: false, resolution: 16, softness: 0},
              textureAO: {enabled: false},
            },
            lights: {include: false},
            probes: {enabled: false},
          });
          await element.updateComplete;
          await rafPasses();
          const pipeline = element[$scene].effectRenderer as unknown as {
            hasAmbientOcclusion(): boolean;
          };
          expect(pipeline.hasAmbientOcclusion()).to.equal(true);
          expect(element.getPathTracerComposer()!.shaderAoMix()).to.equal(1);

          element.setPathTracerOptions({
            bake: {contactShadow: {enabled: true, resolution: 16, softness: 0}},
          });
          const start = performance.now();
          while (!element.isContactShadowReady) {
            if (performance.now() - start > 30000) {
              throw new Error('contact shadow did not become ready');
            }
            await rafPasses();
          }
          await rafPasses();
          expect(element.getPathTracerComposer()!.shaderAoMix()).to.equal(0);
          expect(pipeline.hasAmbientOcclusion()).to.equal(true);

          element.setPathTracerOptions({
            bake: {contactShadow: {enabled: false}},
          });
          await rafPasses();
          await rafPasses();
          expect(element.getPathTracerComposer()!.shaderAoMix()).to.equal(1);
        } finally {
          element.remove();
        }
      });

  test('contact shadow becomes ready without enabling texture AO', async () => {
    const element = new ModelViewerElement();
    element.style.width = '96px';
    element.style.height = '96px';
    element.interactionPrompt = 'none';
    document.body.appendChild(element);
    try {
      const loaded = waitForEvent(element, 'load');
      element.src = ASTRONAUT;
      await loaded;
      let ready = false;
      element.addEventListener('contact-shadow-ready', (event) => {
        const detail = (event as CustomEvent).detail;
        if (detail?.ready === true) {
          ready = true;
        }
      });
      element.pathTracer = true;
      element.setPathTracerOptions({
        mode: 'progressive',
        fadeMs: 0,
        budgetMs: 12,
        idleDelayMs: 1e9,
        bake: {
          contactShadow: {enabled: true, resolution: 24, softness: 0},
          textureAO: {enabled: false},
        },
        lights: {include: false},
        probes: {enabled: false},
      });
      const start = performance.now();
      while (!element.isContactShadowReady) {
        if (performance.now() - start > 30000) {
          throw new Error('contact shadow did not become ready');
        }
        await rafPasses();
      }
      expect(ready).to.equal(true);
      expect(element.isTextureAoReady).to.equal(false);
      const state = element.getPathTracerProgressiveState();
      expect(state).to.not.equal(null);
      expect(state!.cpuSliceMs.max).to.be.lessThan(80);
      element.setPathTracerOptions({
        bake: {contactShadow: {enabled: false}},
      });
      await rafPasses();
      expect(element.isContactShadowReady).to.equal(false);
    } finally {
      element.remove();
    }
  });
});
