/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';

import {$ldEffectsComposer, LDEffectsComposer} from '../../features/ld-effects-composer/index.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {$scene} from '../../model-viewer-base.js';
import {timePasses} from '../../utilities.js';

const AO_CONFLICT =
    'ambient-occlusion requires control over the effect composer';

suite('LDEffectsComposer', () => {
  let element: ModelViewerElement;
  let warnings: string[] = [];
  const originalWarn = console.warn;

  setup(() => {
    element = new ModelViewerElement();
    document.body.appendChild(element);
    warnings = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
      originalWarn.apply(console, args);
    };
  });

  teardown(() => {
    console.warn = originalWarn;
    element.remove();
  });

  test('registers LDEffectsComposer when bloom is enabled', async () => {
    element.setBloomTargets([{material: 'mat'}]);
    element.bloom = true;
    await timePasses();
    expect(element[$scene].effectRenderer).to.be.instanceOf(LDEffectsComposer);
  });

  test('registers LDEffectsComposer when ambient-occlusion is enabled', async () => {
    element.ambientOcclusion = true;
    await timePasses();
    expect(element.ambientOcclusion).to.equal(true);
    expect(element[$scene].effectRenderer).to.be.instanceOf(LDEffectsComposer);
    expect(warnings.some((w) => w.includes(AO_CONFLICT))).to.equal(false);
  });

  test('keeps bloom and ambient-occlusion enabled together', async () => {
    element.setBloomTargets([{material: 'mat'}]);
    element.bloom = true;
    element.ambientOcclusion = true;
    await timePasses();
    expect(element.bloom).to.equal(true);
    expect(element.ambientOcclusion).to.equal(true);
    expect(element[$scene].effectRenderer).to.be.instanceOf(LDEffectsComposer);
    expect(warnings.some((w) => w.includes(AO_CONFLICT))).to.equal(false);
  });

  test('registers composer with bloom, AO, and highlight-selected', async () => {
    element.setBloomTargets([{material: 'mat'}]);
    element.bloom = true;
    element.ambientOcclusion = true;
    element.highlightSelected = true;
    await timePasses();
    const composer = element[$scene].effectRenderer as LDEffectsComposer;
    expect(composer).to.be.instanceOf(LDEffectsComposer);
    expect(composer.bloomModule).to.not.equal(null);
    expect(composer.aoModule).to.not.equal(null);
  });

  test('unregisters when all LD effects are disabled', async () => {
    element.bloom = true;
    element.setBloomTargets([{material: 'mat'}]);
    await timePasses();
    element.bloom = false;
    await timePasses();
    expect(element[$scene].effectRenderer).to.equal(null);
    expect(
        (element as unknown as {[$ldEffectsComposer]?: LDEffectsComposer})
            [$ldEffectsComposer],
    ).to.equal(undefined);
  });

  test('selection-highlight-color is reflected on the element', async () => {
    element.selectionHighlightColor = '#ff00aa';
    expect(element.selectionHighlightColor).to.equal('#ff00aa');
  });
});
