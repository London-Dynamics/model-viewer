/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {Object3D, PerspectiveCamera} from 'three';

import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';

const prepareRectangleSelectionHarness = (element: ModelViewerElement) => {
  element.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  (element as any)[$scene] = {
    camera: new PerspectiveCamera(),
    width: 200,
    height: 200,
    getCamera() {
      return this.camera;
    },
    queueRender() {},
  };
};

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
    (element as any).selectAll();
    expect((element as any).getSelectedObjects()).to.deep.equal([]);
  });

  test('applyRectangleSelection is a no-op when scene is not ready', () => {
    const partA = new Object3D();
    partA.userData.isPlacedObject = true;
    (element as any)._replaceSelection?.([partA]);
    const savedScene = (element as any)[$scene];
    (element as any)[$scene] = null;
    (element as any).applyRectangleSelection({
      left: 0,
      top: 0,
      right: 10,
      bottom: 10,
    });
    (element as any)[$scene] = savedScene;
    expect((element as any).getSelectedObjects()).to.deep.equal([partA]);
  });

  test('applyRectangleSelection with zero-area rect is a no-op', () => {
    const partA = new Object3D();
    partA.userData.isPlacedObject = true;
    (element as any)._replaceSelection?.([partA]);
    (element as any).applyRectangleSelection({
      left: 10,
      top: 10,
      right: 10,
      bottom: 10,
    });
    expect((element as any).getSelectedObjects()).to.deep.equal([partA]);
  });

  test('applyRectangleSelection replace selects intersecting objects', () => {
    prepareRectangleSelectionHarness(element);

    const partA = new Object3D();
    const partB = new Object3D();
    partA.userData.isPlacedObject = true;
    partB.userData.isPlacedObject = true;

    (element as any)._enumerateSelectableObjects = () => [partA, partB];
    (element as any)._projectObjectBoundsToDomRect = (obj: Object3D) => {
      if (obj === partA) {
        return {left: 0, top: 0, right: 10, bottom: 10};
      }
      return {left: 100, top: 100, right: 110, bottom: 110};
    };

    (element as any).applyRectangleSelection({
      left: 0,
      top: 0,
      right: 50,
      bottom: 50,
    });

    expect((element as any).getSelectedObjects()).to.deep.equal([partA]);
  });

  test('applyRectangleSelection add mode appends intersecting objects', () => {
    prepareRectangleSelectionHarness(element);

    const partA = new Object3D();
    const partB = new Object3D();
    partA.userData.isPlacedObject = true;
    partB.userData.isPlacedObject = true;

    (element as any)._replaceSelection?.([partA]);
    (element as any)._enumerateSelectableObjects = () => [partA, partB];
    (element as any)._projectObjectBoundsToDomRect = (obj: Object3D) => {
      if (obj === partB) {
        return {left: 0, top: 0, right: 10, bottom: 10};
      }
      return {left: 100, top: 100, right: 110, bottom: 110};
    };

    (element as any).applyRectangleSelection(
      {left: 0, top: 0, right: 50, bottom: 50},
      {mode: 'add'}
    );

    expect((element as any).getSelectedObjects()).to.deep.equal([partA, partB]);
  });

  test('applyRectangleSelection remove mode deselects intersecting objects', () => {
    prepareRectangleSelectionHarness(element);

    const partA = new Object3D();
    const partB = new Object3D();
    partA.userData.isPlacedObject = true;
    partB.userData.isPlacedObject = true;

    (element as any)._replaceSelection?.([partA, partB]);
    (element as any)._enumerateSelectableObjects = () => [partA, partB];
    (element as any)._projectObjectBoundsToDomRect = (obj: Object3D) => {
      if (obj === partA) {
        return {left: 0, top: 0, right: 10, bottom: 10};
      }
      return {left: 100, top: 100, right: 110, bottom: 110};
    };

    (element as any).applyRectangleSelection(
      {left: 0, top: 0, right: 50, bottom: 50},
      {mode: 'remove'}
    );

    expect((element as any).getSelectedObjects()).to.deep.equal([partB]);
  });

  test('applyRectangleSelection toggle mode toggles intersecting objects', () => {
    prepareRectangleSelectionHarness(element);

    const partA = new Object3D();
    const partB = new Object3D();
    partA.userData.isPlacedObject = true;
    partB.userData.isPlacedObject = true;

    (element as any)._replaceSelection?.([partA]);
    (element as any)._enumerateSelectableObjects = () => [partA, partB];
    (element as any)._projectObjectBoundsToDomRect = (obj: Object3D) => {
      if (obj === partB) {
        return {left: 0, top: 0, right: 10, bottom: 10};
      }
      return {left: 100, top: 100, right: 110, bottom: 110};
    };

    (element as any).applyRectangleSelection(
      {left: 0, top: 0, right: 50, bottom: 50},
      {mode: 'toggle'}
    );

    expect((element as any).getSelectedObjects()).to.deep.equal([partA, partB]);
  });

  test('selectAll does not clear an existing selection when nothing is enumerable', () => {
    const partA = new Object3D();
    partA.userData.isPlacedObject = true;
    (element as any)._replaceSelection?.([partA]);
    (element as any)._enumerateSelectableObjects = () => [];
    (element as any).selectAll();
    expect((element as any).getSelectedObjects()).to.deep.equal([partA]);
  });
});
