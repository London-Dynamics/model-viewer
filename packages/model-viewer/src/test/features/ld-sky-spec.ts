/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';

import {$renderer, $scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {waitForEvent} from '../../utilities.js';
import {rafPasses} from '../helpers.js';

suite('LDSky', () => {
  let element: ModelViewerElement;

  setup(() => {
    element = new ModelViewerElement();
    document.body.insertBefore(element, document.body.firstChild);
  });

  teardown(() => {
    element.remove();
  });

  test('sky and sun default off and do not replace the environment', () => {
    const skyElement = element as any;
    expect(skyElement.sky).to.equal(false);
    expect(skyElement.skyImage).to.equal(null);
    expect(skyElement.skySize).to.equal(null);
    expect(skyElement.skyBrightness).to.equal(1);
    expect(skyElement.skySunTime).to.equal(null);
    expect(skyElement.skyEnvironment).to.equal(false);
    expect(skyElement.activeSky).to.equal(null);
  });

  test('sky-sun-time adds a light without requesting WebGPU', async () => {
    let requested: string|null = null;
    const originalRequestBackend = element[$renderer].requestBackend;
    element[$renderer].requestBackend = async (backend: any) => {
      requested = backend;
    };
    const scene = element[$scene];

    try {
      (element as any).skySunTime = '16:45';
      await element.updateComplete;
      await rafPasses();

      expect(requested).to.equal(null);
      const sun = scene.getObjectByName('LDSkySun') as {intensity: number, castShadow: boolean}|undefined;
      expect(sun).to.not.equal(undefined);
      expect(sun!.intensity).to.equal(2);
      expect(sun!.castShadow).to.equal(false);
      expect((element as any).toneMapping).to.not.equal('aces');
      expect(element.exposure).to.equal(1);
    } finally {
      element[$renderer].requestBackend = originalRequestBackend;
    }
  });

  test('the sky dome requests WebGPU and leaves tone mapping alone', async () => {
    let requested: string|null = null;
    const originalRequestBackend = element[$renderer].requestBackend;
    element[$renderer].requestBackend = async (backend: any) => {
      requested = backend;
      throw new Error('WebGPU is not available in this browser.');
    };
    const skyError = waitForEvent<CustomEvent>(element, 'sky-error');

    try {
      element.environmentImage = 'neutral';
      element.exposure = 1;
      (element as any).toneMapping = 'neutral';
      (element as any).skyImage = '/sky.hdr';
      (element as any).sky = true;
      (element as any).skyEnvironment = false;
      await element.updateComplete;
      await rafPasses();

      const event = await skyError;
      expect(requested).to.equal('webgpu');
      expect(event.detail.error.message).to.contain('WebGPU');
      expect(element.environmentImage).to.equal('neutral');
      expect((element as any).toneMapping).to.equal('neutral');
      expect(element.exposure).to.equal(1);
      expect((element as any).skyEnvironment).to.equal(false);
    } finally {
      element[$renderer].requestBackend = originalRequestBackend;
    }
  });
});
