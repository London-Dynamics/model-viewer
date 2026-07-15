/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {BoxGeometry, Mesh, MeshBasicMaterial} from 'three';

import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {timePasses} from '../../utilities.js';

import {rafPasses} from '../helpers.js';

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

  test('offscreen captureImage bypasses effectRenderer and returns a data URL',
      async () => {
        const scene = element[$scene];
        expect(scene.effectRenderer).to.not.equal(null);

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

        expect(effectRenderCalls).to.equal(0);
        expect(dataUrl.startsWith('data:image/png')).to.equal(true);
        expect(dataUrl.length).to.be.greaterThan(100);

        // Round-trip: decode and ensure pixels are not a uniform blank white
        // failure from an uncleared / unused capture RT.
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = dataUrl;
        });
        expect(img.width).to.equal(64);
        expect(img.height).to.equal(48);

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        expect(ctx).to.not.equal(null);
        ctx!.drawImage(img, 0, 0);
        const {data} = ctx!.getImageData(0, 0, canvas.width, canvas.height);
        let nonWhite = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) {
            nonWhite++;
          }
        }
        expect(nonWhite).to.be.greaterThan(0);
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

        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = dataUrl;
        });
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

    const decode = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = src;
        });

    const imgA = await decode(a);
    const imgB = await decode(b);
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
});
