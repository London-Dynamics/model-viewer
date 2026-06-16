import {expect} from 'chai';

import {
  $scene,
  $updateSize,
} from '../../model-viewer-base.js';
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

  test('constrains active server AI denoise viewport to explicit aspect ratio',
      async () => {
        element.pathTracerDenoiseMode = 'server-ai';
        element.serverAIDenoiseAspectRatio = '1 / 1';
        await timePasses();

        element[$updateSize]({width: 1500, height: 1000});

        expect(element[$scene].width).to.equal(1000);
        expect(element[$scene].height).to.equal(1000);
      });

  test('does not constrain viewport when server AI denoise is inactive',
      async () => {
        element.pathTracerDenoiseMode = 'gpu';
        element.serverAIDenoiseAspectRatio = '1 / 1';
        await timePasses();

        element[$updateSize]({width: 1500, height: 1000});

        expect(element[$scene].width).to.equal(1500);
        expect(element[$scene].height).to.equal(1000);
      });

  test('uses closest supported aspect ratio when none is configured',
      async () => {
        element.pathTracerDenoiseMode = 'server-ai';
        await timePasses();

        element[$updateSize]({width: 1500, height: 1000});

        expect(element.serverAIDenoiseResolvedAspectRatio).to.equal('3 / 2');
        expect(element[$scene].width).to.equal(1500);
        expect(element[$scene].height).to.equal(1000);
      });

  test('path tracer server denoise waits for requested samples before capture',
      async () => {
        element.pathTracerDenoiseMode = 'server-ai';
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

  test('server denoise captures at constrained active viewport size', async () => {
    element.pathTracerDenoiseMode = 'server-ai';
    element.serverAIDenoiseAspectRatio = '1 / 1';
    await timePasses();
    element[$updateSize]({width: 1500, height: 1000});

    let captureOptions: {width?: number, height?: number}|undefined;
    (element as unknown as {
      captureImage: (options?: {width?: number, height?: number}) =>
          Promise<string>
    }).captureImage = async (options) => {
      captureOptions = options;
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
      await element.serverAIDenoise();
      expect(captureOptions?.width).to.equal(1000 * window.devicePixelRatio);
      expect(captureOptions?.height).to.equal(1000 * window.devicePixelRatio);
    } finally {
      window.fetch = fetch;
    }
  });
});
