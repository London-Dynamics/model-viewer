import {expect} from 'chai';

import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {timePasses} from '../../utilities.js';

type PipelineInternals = {
  hasAmbientOcclusion(): boolean;
  hasBloom(): boolean;
  hasPathTracer(): boolean;
  getBloomTargetCount(): number;
};

const getPipeline = (element: ModelViewerElement): PipelineInternals =>
    element[$scene].effectRenderer as unknown as PipelineInternals;

suite('LD Render Pipeline', () => {
  let element: ModelViewerElement;

  setup(() => {
    element = new ModelViewerElement();
    document.body.appendChild(element);
  });

  teardown(() => {
    element.remove();
  });

  test('registers one pipeline when ambient occlusion is enabled', async () => {
    element.ambientOcclusion = true;
    await timePasses();

    const pipeline = getPipeline(element);
    expect(element[$scene].effectRenderer).to.not.equal(null);
    expect(pipeline.hasAmbientOcclusion()).to.equal(true);
    expect(pipeline.hasBloom()).to.equal(false);
  });

  test('registers one pipeline when bloom is enabled', async () => {
    element.setBloomTargets([{mesh: 'Lamp', color: '#ffffff', intensity: 2}]);
    element.bloom = true;
    await timePasses();

    const pipeline = getPipeline(element);
    expect(element[$scene].effectRenderer).to.not.equal(null);
    expect(pipeline.hasAmbientOcclusion()).to.equal(false);
    expect(pipeline.hasBloom()).to.equal(true);
    expect(pipeline.getBloomTargetCount()).to.equal(1);
  });

  test('keeps one pipeline when ambient occlusion and bloom are both enabled',
      async () => {
        element.ambientOcclusion = true;
        element.setBloomTargets([{mesh: 'Lamp', color: '#ffffff', intensity: 2}]);
        element.bloom = true;
        await timePasses();

        const renderer = element[$scene].effectRenderer;
        const pipeline = getPipeline(element);
        expect(renderer).to.not.equal(null);
        expect(pipeline.hasAmbientOcclusion()).to.equal(true);
        expect(pipeline.hasBloom()).to.equal(true);

        element.aoIntensity = 0.5;
        element.bloomStrength = 0.8;
        await timePasses();

        expect(element[$scene].effectRenderer).to.equal(renderer);
        expect(getPipeline(element).hasAmbientOcclusion()).to.equal(true);
        expect(getPipeline(element).hasBloom()).to.equal(true);
      });

  test('unregisters the pipeline when no raster effects are enabled',
      async () => {
        element.ambientOcclusion = true;
        element.bloom = true;
        await timePasses();

        element.ambientOcclusion = false;
        element.bloom = false;
        await timePasses();

        expect(element[$scene].effectRenderer).to.equal(null);
      });

  test('keeps central ownership while path tracer runs with raster preview',
      async () => {
        element.ambientOcclusion = true;
        element.pathTracer = true;
        await timePasses();

        const pipeline = getPipeline(element);
        expect(element.pathTracer).to.equal(true);
        expect(element.ambientOcclusion).to.equal(true);
        expect(element[$scene].effectRenderer).to.not.equal(null);
        expect(pipeline.hasAmbientOcclusion()).to.equal(true);
        expect(pipeline.hasPathTracer()).to.equal(true);
      });
});
