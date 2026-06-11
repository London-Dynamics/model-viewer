import {expect} from 'chai';

import {ModelViewerElement} from '../../model-viewer.js';
import {$scene} from '../../model-viewer-base.js';
import {timePasses} from '../../utilities.js';

type PathTracerComposerInternals = {
  hasAmbientOcclusion(): boolean;
  hasPathTracer(): boolean;
};

suite('LD Path Tracer AO preview', () => {
  let element: ModelViewerElement;

  setup(() => {
    element = new ModelViewerElement();
    document.body.appendChild(element);
  });

  teardown(() => {
    element.remove();
  });

  test('keeps path tracer registered when AO is also enabled', async () => {
    element.ambientOcclusion = true;
    element.pathTracer = true;
    element.aoRadius = 3.5;
    element.aoIntensity = 0.7;
    await timePasses();

    const composer =
        element[$scene].effectRenderer as unknown as PathTracerComposerInternals;

    expect(element.pathTracer).to.equal(true);
    expect(element.ambientOcclusion).to.equal(true);
    expect(element[$scene].effectRenderer).to.not.equal(null);
    expect(composer.hasAmbientOcclusion()).to.equal(true);
    expect(composer.hasPathTracer()).to.equal(true);
  });

  test('does not create AO preview options when AO is disabled', async () => {
    element.pathTracer = true;
    await timePasses();

    const composer =
        element[$scene].effectRenderer as unknown as PathTracerComposerInternals;

    expect(composer.hasAmbientOcclusion()).to.equal(false);
    expect(composer.hasPathTracer()).to.equal(true);
  });

  test('lets path tracer take over when AO was enabled first', async () => {
    element.ambientOcclusion = true;
    await timePasses();

    element.pathTracer = true;
    await timePasses();

    const composer =
        element[$scene].effectRenderer as unknown as PathTracerComposerInternals;

    expect(element.pathTracer).to.equal(true);
    expect(element.ambientOcclusion).to.equal(true);
    expect(composer.hasAmbientOcclusion()).to.equal(true);
    expect(composer.hasPathTracer()).to.equal(true);
  });
});
