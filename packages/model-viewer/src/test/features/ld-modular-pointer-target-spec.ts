/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';

import {ModelViewerElement} from '../../model-viewer.js';

suite('ld-modular pointer interaction target', () => {
  let element: ModelViewerElement;

  setup(() => {
    element = new ModelViewerElement();
  });

  teardown(() => {
    if (element.parentNode != null) {
      element.parentNode.removeChild(element);
    }
  });

  test('getPointerInteractionTarget is exposed on the element', () => {
    expect(typeof (element as any).getPointerInteractionTarget).to.equal(
      'function'
    );
  });

  test('returns none before scene is ready', () => {
    expect((element as any).getPointerInteractionTarget(50, 50)).to.deep.equal(
      {kind: 'none'}
    );
  });

  test('returns interactive-session when paste preview is active', () => {
    (element as any)._activePasteSession = {state: 'previewing'};
    expect((element as any).getPointerInteractionTarget(50, 50)).to.deep.equal({
      kind: 'interactive-session',
    });
  });

  test('returns interactive-session when placement session is active', () => {
    (element as any)._activePlacementSession = {state: 'placing'};
    expect((element as any).getPointerInteractionTarget(50, 50)).to.deep.equal({
      kind: 'interactive-session',
    });
  });
});
