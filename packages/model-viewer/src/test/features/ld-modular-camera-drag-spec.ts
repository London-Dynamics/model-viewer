/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {Object3D} from 'three';

import {$controls} from '../../features/controls.js';
import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';

suite('ld-modular camera drag guards', () => {
  let element: ModelViewerElement;
  let dragDisableCount: number;
  let dragEnableCount: number;
  let interactionDisableCount: number;

  setup(() => {
    element = new ModelViewerElement();
    dragDisableCount = 0;
    dragEnableCount = 0;
    interactionDisableCount = 0;

    (element as any).editMode = true;
    (element as any)[$controls] = {
      disableDragInteraction: () => {
        dragDisableCount += 1;
      },
      enableDragInteraction: () => {
        dragEnableCount += 1;
      },
      disableInteraction: () => {
        interactionDisableCount += 1;
      },
    };

    element.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 200,
        height: 200,
        right: 200,
        bottom: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  });

  teardown(() => {
    if (element.parentNode != null) {
      element.parentNode.removeChild(element);
    }
  });

  test('pointerdown off-object re-enables camera drag after hover disable', () => {
    const selectable = new Object3D();
    const modular = element as any;

    modular._resolvePointerSelectableObject = (x: number, y: number) => {
      if (x === 100 && y === 100) return selectable;
      return null;
    };

    modular._onPointerDownCapture({
      button: 0,
      clientX: 100,
      clientY: 100,
      target: element,
    } as unknown as PointerEvent);
    expect(dragDisableCount).to.equal(1);

    modular._onPointerDownCapture({
      button: 0,
      clientX: 10,
      clientY: 10,
      target: element,
    } as unknown as PointerEvent);
    expect(dragEnableCount).to.equal(1);
  });

  test('tap on selected object does not disable full camera interaction', () => {
    const selected = new Object3D();
    const modular = element as any;
    modular.selectedObjects = [selected];
    modular.isPointOnObject = () => true;

    modular.onTouchStart({
      touches: [{clientX: 50, clientY: 50}],
      changedTouches: [{clientX: 50, clientY: 50}],
    } as unknown as TouchEvent);
    modular.onTouchEnd({} as TouchEvent);

    expect(modular._touchObjectDragPending).to.be.false;
    expect(modular.isDragging).to.not.be.true;
    expect(interactionDisableCount).to.equal(0);
    expect(dragDisableCount).to.equal(0);
  });

  test('touch drag on selected object uses drag-disable not full disable', () => {
    const selected = new Object3D();
    const modular = element as any;
    modular.selectedObjects = [selected];
    modular.isPointOnObject = () => true;
    modular._resolveDragRoots = () => [selected];
    modular._beginTransformSession = () => {};
    modular.floorPlane = {constant: 0};
    modular.originalFloorY = 0;
    modular.raycaster = {
      setFromCamera: () => {},
      ray: {intersectPlane: () => null},
    };
    (element as any)[$scene] = {
      camera: {position: {x: 0, y: 0, z: 5}},
      target: {add: () => {}},
    };

    modular.onTouchStart({
      touches: [{clientX: 50, clientY: 50}],
      changedTouches: [{clientX: 50, clientY: 50}],
    } as unknown as TouchEvent);
    modular.onTouchMove({
      touches: [{clientX: 80, clientY: 80}],
      preventDefault: () => {},
      stopImmediatePropagation: () => {},
    } as unknown as TouchEvent);
    modular.onTouchEnd({} as TouchEvent);

    expect(dragDisableCount).to.be.greaterThan(0);
    expect(interactionDisableCount).to.equal(0);
    expect(dragEnableCount).to.be.greaterThan(0);
  });

  test('selection clear re-enables hover camera drag disable', () => {
    const modular = element as any;
    modular._pointerHoverDisablesCameraDrag = true;
    modular._cameraDragDisabled = true;

    modular._onSelectionChangeForPuzzler(
      new CustomEvent('selection-change', {
        detail: {selectedObjects: [], type: 'clear', scope: 'part'},
      })
    );

    expect(modular._pointerHoverDisablesCameraDrag).to.be.false;
    expect(dragEnableCount).to.equal(1);
  });
});
