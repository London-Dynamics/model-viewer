import {expect} from 'chai';

import {ModelViewerElement} from '../../model-viewer.js';
import {timePasses} from '../../utilities.js';

suite('LD Server AI denoise', () => {
  let element: ModelViewerElement;

  setup(() => {
    element = new ModelViewerElement();
    document.body.appendChild(element);
  });

  teardown(() => {
    element.remove();
  });

  test(
      'path tracer server denoise waits for requested samples before capture',
      async () => {
        element.pathTracerSamples = 8;

        let renderedSamples = 0;
        Object.defineProperty(element, 'pathTracerRenderedSamples', {
          get: () => renderedSamples,
        });

        let captureCalled = false;
        (element as unknown as {
          captureImage: (options?: unknown) => Promise<string>
        }).captureImage = async () => {
          captureCalled = true;
          return 'data:image/png;base64,test';
        };

        const fetch = window.fetch;
        window.fetch = async () => {
          return new Response(JSON.stringify({imageUrl: 'denoised.png'}), {
            status: 200,
            headers: {'content-type': 'application/json'},
          });
        };

        try {
          const resultPromise = element.pathTracerServerAIDenoise({samples: 2});
          await timePasses();
          expect(captureCalled).to.equal(false);

          renderedSamples = 2;
          await timePasses();

          expect(await resultPromise).to.equal('denoised.png');
          expect(captureCalled).to.equal(true);
        } finally {
          window.fetch = fetch;
        }
      });

  test(
      'server denoise uses the path tracer frame when the tracer is ready',
      async () => {
        element.pathTracer = true;
        Object.defineProperty(element, 'isPathTracerReady', {get: () => true});

        let rasterCalled = false;
        (element as unknown as {
          captureImage: () => Promise<string>,
        }).captureImage = async () => {
          rasterCalled = true;
          return 'data:image/png;base64,raster';
        };
        (element as unknown as {
          capturePathTracerFrame: () => Promise<{dataUrl: string}>,
        }).capturePathTracerFrame = async () => ({
          dataUrl: 'data:image/png;base64,traced',
          width: 128,
          height: 64,
          samples: 3,
        });

        let postedImage = '';
        const fetch = window.fetch;
        window.fetch = async (_input, init) => {
          postedImage = JSON.parse(String(init?.body ?? '{}')).image ?? '';
          return new Response(JSON.stringify({imageUrl: 'denoised.png'}), {
            status: 200,
            headers: {'content-type': 'application/json'},
          });
        };

        try {
          expect(await element.serverAIDenoise()).to.equal('denoised.png');
          expect(rasterCalled).to.equal(false);
          expect(postedImage).to.equal('data:image/png;base64,traced');
        } finally {
          window.fetch = fetch;
        }
      });

  test(
      'server denoise falls back to captureImage before the tracer is ready',
      async () => {
        element.pathTracer = true;
        Object.defineProperty(element, 'isPathTracerReady', {get: () => false});

        let rasterCalled = false;
        (element as unknown as {
          captureImage: () => Promise<string>,
        }).captureImage = async () => {
          rasterCalled = true;
          return 'data:image/png;base64,raster';
        };
        (element as unknown as {
          capturePathTracerFrame: () => Promise<{dataUrl: string}>,
        }).capturePathTracerFrame = async () => {
          throw new Error('path tracer frame should not be captured');
        };

        const fetch = window.fetch;
        window.fetch = async () => {
          return new Response(JSON.stringify({imageUrl: 'denoised.png'}), {
            status: 200,
            headers: {'content-type': 'application/json'},
          });
        };

        try {
          expect(await element.serverAIDenoise()).to.equal('denoised.png');
          expect(rasterCalled).to.equal(true);
        } finally {
          window.fetch = fetch;
        }
      });
});
