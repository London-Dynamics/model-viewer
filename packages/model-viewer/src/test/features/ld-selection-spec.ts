/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {Object3D} from 'three';

import {ModelViewerElement} from '../../model-viewer.js';

suite('ld-selection multi-select', () => {
  let element: ModelViewerElement;

  setup(() => {
    element = new ModelViewerElement();
    element.setAttribute('selection-scope', 'all');
  });

  teardown(() => {
    if (element.parentNode != null) {
      element.parentNode.removeChild(element);
    }
  });

  test('selectAll and deselectAll are exposed on the element', () => {
    expect(typeof (element as any).selectAll).to.equal('function');
    expect(typeof (element as any).deselectAll).to.equal('function');
    expect(typeof (element as any).applyRectangleSelection).to.equal(
      'function'
    );
  });

  test('selectAll is a no-op when selection-scope is scene', () => {
    element.setAttribute('selection-scope', 'scene');
    const partA = new Object3D();
    partA.name = 'part-a';
    (element as any).selectPart?.(partA);
    (element as any).selectAll();
    expect((element as any).getSelectedObjects()).to.deep.equal([]);
  });

  test('applyRectangleSelection with empty projection is a no-op', () => {
    const partA = new Object3D();
    partA.userData.isPlacedObject = true;
    (element as any)._replaceSelection?.([partA]);
    (element as any).applyRectangleSelection({
      left: 0,
      top: 0,
      right: 10,
      bottom: 10,
    });
    expect((element as any).getSelectedObjects()).to.deep.equal([partA]);
  });

  test('selectAll does not clear an existing selection when nothing is enumerable', () => {
    const partA = new Object3D();
    partA.userData.isPlacedObject = true;
    (element as any)._replaceSelection?.([partA]);
    (element as any).selectAll();
    expect((element as any).getSelectedObjects()).to.deep.equal([partA]);
  });
});
