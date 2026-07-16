/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {BoxGeometry, Mesh, MeshBasicMaterial} from 'three';

import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {$controls} from '../../features/controls.js';
import {timePasses} from '../../utilities.js';

import {rafPasses} from '../helpers.js';

async function decodeDataUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function samplePixels(img: HTMLImageElement): {
  width: number;
  height: number;
  data: Uint8ClampedArray;
} {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  expect(ctx).to.not.equal(null);
  ctx!.drawImage(img, 0, 0);
  return {
    width: canvas.width,
    height: canvas.height,
    data: ctx!.getImageData(0, 0, canvas.width, canvas.height).data,
  };
}

function pixelAt(
    data: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

function countMatching(
    data: Uint8ClampedArray,
    pred: (r: number, g: number, b: number, a: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (pred(data[i], data[i + 1], data[i + 2], data[i + 3])) n++;
  }
  return n;
}

suite('LD Image Capture', function() {
  this.timeout(10000);

  let element: ModelViewerElement;

  setup(async () => {
    element = new ModelViewerElement();
    element.style.width = '160px';
    element.style.height = '160px';
    element.highlightSelected = true;
    document.body.insertBefore(element, document.body.firstChild);

    const material = new MeshBasicMaterial({color: '#336699'});
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
    mesh.name = 'capture-cube';
    element[$scene].add(mesh);
    element[$scene].queueRender();

    await timePasses();
    await rafPasses();
  });

  teardown(() => {
    if (element.parentNode != null) {
      element.parentNode.removeChild(element);
    }
  });

  test('registers effectRenderer when highlight-selected is enabled',
      async () => {
        expect(element[$scene].effectRenderer).to.not.equal(null);
      });

  test('offscreen captureImage bypasses effectRenderer and returns opaque bg',
      async () => {
        const scene = element[$scene];
        expect(scene.effectRenderer).to.not.equal(null);

        // Hide content so corners are pure backgroundColor (not the cube).
        const cube = scene.getObjectByName('capture-cube');
        if (cube) cube.visible = false;
        scene.queueRender();
        await rafPasses();

        let effectRenderCalls = 0;
        const originalEffectRenderer = scene.effectRenderer!;
        const originalRender = originalEffectRenderer.render.bind(
            originalEffectRenderer);
        originalEffectRenderer.render = (deltaTime?: DOMHighResTimeStamp) => {
          effectRenderCalls++;
          return originalRender(deltaTime);
        };

        const dataUrl = await element.captureImage({
          width: 64,
          height: 48,
          fileType: 'image/png',
          backgroundColor: '#112233',
        });

        if (cube) cube.visible = true;

        expect(effectRenderCalls).to.equal(0);
        expect(dataUrl.startsWith('data:image/png')).to.equal(true);

        const img = await decodeDataUrl(dataUrl);
        expect(img.width).to.equal(64);
        expect(img.height).to.equal(48);

        const {width, height, data} = samplePixels(img);
        const corners = [
          pixelAt(data, width, 0, 0),
          pixelAt(data, width, width - 1, 0),
          pixelAt(data, width, 0, height - 1),
          pixelAt(data, width, width - 1, height - 1),
        ];
        for (const corner of corners) {
          expect(corner[3]).to.equal(255);
          expect(corner[0]).to.be.closeTo(0x11, 3);
          expect(corner[1]).to.be.closeTo(0x22, 3);
          expect(corner[2]).to.be.closeTo(0x33, 3);
        }
      });

  test('offscreen PNG with a visible model is not a blank background frame',
      async () => {
        element[$scene].queueRender();
        await rafPasses();

        const dataUrl = await element.captureImage({
          width: 64,
          height: 48,
          fileType: 'image/png',
          backgroundColor: '#112233',
        });

        expect(dataUrl.startsWith('data:image/png')).to.equal(true);
        const img = await decodeDataUrl(dataUrl);
        const {data} = samplePixels(img);
        const nonBg = countMatching(data, (r, g, b, a) => {
          if (a < 250) return true;
          return Math.abs(r - 0x11) > 8 || Math.abs(g - 0x22) > 8 ||
              Math.abs(b - 0x33) > 8;
        });
        expect(nonBg).to.be.greaterThan(0);
      });

  test('offscreen JPEG is not a flat black frame when a model is visible',
      async () => {
        element[$scene].queueRender();
        await rafPasses();

        const dataUrl = await element.captureImage({
          width: 64,
          height: 48,
          fileType: 'image/jpeg',
          encoderOptions: 0.92,
        });

        expect(dataUrl.startsWith('data:image/jpeg')).to.equal(true);

        const img = await decodeDataUrl(dataUrl);
        const {data} = samplePixels(img);
        const nonBlack = countMatching(
            data, (r, g, b) => r > 8 || g > 8 || b > 8);
        expect(nonBlack).to.be.greaterThan(0);
      });

  test('width-only captureImage (display path) still returns a data URL',
      async () => {
        element[$scene].queueRender();
        await rafPasses();

        const dataUrl = await element.captureImage({
          width: 64,
          fileType: 'image/jpeg',
        });

        expect(dataUrl.startsWith('data:image/jpeg')).to.equal(true);
        expect(dataUrl.length).to.be.greaterThan(100);
      });

  test('pose + width-only captureImage defaults to a square offscreen size',
      async () => {
        const meta = element.getCameraJSON();
        expect(meta).to.not.equal(null);

        const dataUrl = await element.captureImage({
          camera: meta!.object,
          width: 64,
          fileType: 'image/png',
        });

        const img = await decodeDataUrl(dataUrl);
        expect(img.width).to.equal(64);
        expect(img.height).to.equal(64);
      });

  test('captureThumbnails returns one JPEG per camera pose', async () => {
    const meta = element.getCameraJSON();
    expect(meta).to.not.equal(null);

    const urls = await element.captureThumbnails([meta!.object, meta!.object]);
    expect(urls.length).to.equal(2);
    for (const url of urls) {
      expect(url.startsWith('data:image/jpeg')).to.equal(true);
      expect(url.length).to.be.greaterThan(100);
    }
  });

  test('concurrent captureImage calls are serialized', async () => {
    const meta = element.getCameraJSON();
    expect(meta).to.not.equal(null);

    const [a, b] = await Promise.all([
      element.captureImage({
        camera: meta!.object,
        width: 32,
        height: 32,
        fileType: 'image/png',
      }),
      element.captureImage({
        camera: meta!.object,
        width: 48,
        height: 48,
        fileType: 'image/png',
      }),
    ]);

    const imgA = await decodeDataUrl(a);
    const imgB = await decodeDataUrl(b);
    expect(imgA.width).to.equal(32);
    expect(imgA.height).to.equal(32);
    expect(imgB.width).to.equal(48);
    expect(imgB.height).to.equal(48);
  });

  test('fitToBox is ignored when camera pose is provided', async () => {
    const meta = element.getCameraJSON();
    expect(meta).to.not.equal(null);

    const before = element.getCameraJSON();
    expect(before).to.not.equal(null);

    await element.captureImage({
      camera: meta!.object,
      width: 32,
      height: 32,
      fitToBox: true,
      fileType: 'image/png',
    });

    const after = element.getCameraJSON();
    expect(after).to.not.equal(null);
    expect(JSON.stringify(after!.object.position))
        .to.equal(JSON.stringify(before!.object.position));
  });

  test('width/height-only capture restores the visible camera pose',
      async () => {
        const before = element.getCameraJSON();
        expect(before).to.not.equal(null);

        await element.captureImage({
          width: 48,
          height: 32,
          fileType: 'image/png',
        });

        const after = element.getCameraJSON();
        expect(after).to.not.equal(null);
        expect(JSON.stringify(after!.object.position))
            .to.equal(JSON.stringify(before!.object.position));
        if (before!.object.target != null) {
          expect(JSON.stringify(after!.object.target))
              .to.equal(JSON.stringify(before!.object.target));
        }
      });

  test('fitToBox without camera restores the visible camera pose', async () => {
    const scene = element[$scene];
    const cube = scene.getObjectByName('capture-cube');
    if (cube) {
      scene.boundingBox.setFromObject(cube);
    }

    // rotateCamera takes degrees. Force CameraControls to apply before snapshot.
    if (typeof element.rotateCamera === 'function') {
      element.rotateCamera(40, 65, false);
    }
    const controls = (element as any)[$controls];
    const cc = controls?.thirdPartyControls;
    if (cc && typeof cc.update === 'function') {
      cc.update(0);
    }
    scene.queueRender();
    await rafPasses();
    await timePasses(50);

    const before = element.getCameraJSON();
    expect(before).to.not.equal(null);

    await element.captureImage({
      width: 48,
      height: 32,
      fitToBox: true,
      fileType: 'image/png',
      backgroundColor: '#ffffff',
    });

    await rafPasses();
    await timePasses(50);

    const after = element.getCameraJSON();
    expect(after).to.not.equal(null);
    expect(JSON.stringify(after!.object.position))
        .to.equal(JSON.stringify(before!.object.position));
    if (before!.object.target != null) {
      expect(JSON.stringify(after!.object.target))
          .to.equal(JSON.stringify(before!.object.target));
    }
  });
});
