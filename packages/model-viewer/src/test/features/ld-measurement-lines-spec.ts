/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {
  BoxGeometry,
  Mesh,
  Object3D,
  Vector3,
} from 'three';

import {
  computeLocalBoundingBox,
  computePivotOnFloor,
  computeUnionBoundingBoxInFrame,
  getViewOctantLabelInSpace,
  HETEROGENEOUS_ROTATION_THRESHOLD_DEG,
  rotationYSpreadDeg,
  setupMeasurementFrame,
  syncMeasurementFrameFromPivotTransform,
  syncMeasurementFrameFromRoots,
  syncMeasurementTransform,
} from '../../features/ld-measure/measurement-lines.js';
import {
  SELECTION_TRANSFORM_PIVOT_UUID,
} from '../../features/ld-modular/transform-events.js';

function makeCubeMesh(size = 1): Mesh {
  const mesh = new Mesh(new BoxGeometry(size, size, size));
  mesh.geometry.computeBoundingBox();
  return mesh;
}

suite('ld-measurement-lines', () => {
  test('computeLocalBoundingBox keeps size after Y rotation', () => {
    const root = new Object3D();
    const mesh = makeCubeMesh(1);
    root.add(mesh);
    root.rotation.y = Math.PI / 4;
    root.updateMatrixWorld(true);

    const box = computeLocalBoundingBox(root);
    const size = box.getSize(new Vector3());

    expect(size.x).to.be.closeTo(1, 1e-5);
    expect(size.y).to.be.closeTo(1, 1e-5);
    expect(size.z).to.be.closeTo(1, 1e-5);
  });

  test('computeUnionBoundingBoxInFrame unions two offsets in frame space', () => {
    const sceneTarget = new Object3D();
    const frame = new Object3D();
    sceneTarget.add(frame);

    const left = new Object3D();
    left.position.set(-1, 0, 0);
    const right = new Object3D();
    right.position.set(1, 0, 0);
    left.add(makeCubeMesh(1));
    right.add(makeCubeMesh(1));
    sceneTarget.add(left, right);

    setupMeasurementFrame(frame, [left, right], sceneTarget, 0);
    const union = computeUnionBoundingBoxInFrame(
      [left, right],
      frame,
      false
    );
    const size = union.getSize(new Vector3());

    expect(size.x).to.be.closeTo(3, 0.05);
    expect(size.y).to.be.closeTo(1, 0.05);
    expect(size.z).to.be.closeTo(1, 0.05);
  });

  test('rotationYSpreadDeg detects heterogeneous roots', () => {
    const a = new Object3D();
    const b = new Object3D();
    a.rotation.y = 0;
    b.rotation.y = Math.PI / 2;
    expect(rotationYSpreadDeg([a, b])).to.be.closeTo(90, 1e-5);
    expect(rotationYSpreadDeg([a, b]) > HETEROGENEOUS_ROTATION_THRESHOLD_DEG)
      .to.equal(true);
  });

  test('setupMeasurementFrame uses world AABB fallback when spread is large', () => {
    const sceneTarget = new Object3D();
    const frame = new Object3D();
    const a = new Object3D();
    const b = new Object3D();
    a.rotation.y = 0;
    b.rotation.y = Math.PI / 2;
    sceneTarget.add(a, b);

    const {useWorldAabbFallback} = setupMeasurementFrame(
      frame,
      [a, b],
      sceneTarget,
      0
    );
    expect(useWorldAabbFallback).to.equal(true);
    expect(frame.rotation.y).to.equal(0);
  });

  test('syncMeasurementFrameFromRoots updates frame rotation for co-rotated group', () => {
    const sceneTarget = new Object3D();
    const frame = new Object3D();
    sceneTarget.add(frame);

    const root = new Object3D();
    root.add(makeCubeMesh(1));
    root.rotation.y = Math.PI / 3;
    root.position.set(2, 0, 1);
    sceneTarget.add(root);

    setupMeasurementFrame(frame, [root], sceneTarget, 0);
    root.rotation.y = Math.PI / 6;
    root.position.set(3, 0, 2);
    root.updateMatrixWorld(true);

    syncMeasurementFrameFromRoots(frame, [root], 0, false);

    expect(frame.rotation.y).to.be.closeTo(root.rotation.y, 1e-5);
    const pivot = computePivotOnFloor([root], 0);
    expect(frame.position.x).to.be.closeTo(pivot.x, 1e-5);
    expect(frame.position.z).to.be.closeTo(pivot.z, 1e-5);
    expect(frame.position.y).to.equal(0);
  });

  test('getViewOctantLabelInSpace rotates with measurement frame', () => {
    const frame = new Object3D();
    frame.updateMatrixWorld(true);
    const cameraPos = new Vector3(0, 1, 5);
    const unrotated = getViewOctantLabelInSpace(frame, cameraPos);

    frame.rotation.y = Math.PI / 2;
    frame.updateMatrixWorld(true);
    const rotated = getViewOctantLabelInSpace(frame, cameraPos);

    expect(unrotated).to.equal('front');
    expect(rotated).to.not.equal(unrotated);
  });

  test('syncMeasurementTransform updates multi-select frame without remeasure', () => {
    const sceneTarget = new Object3D();
    const frame = new Object3D();
    frame.name = 'ld-measurement-frame';
    sceneTarget.add(frame);

    const roots = [new Object3D(), new Object3D()];
    roots[0].position.set(-1, 0, 0);
    roots[1].position.set(1, 0, 0);
    sceneTarget.add(...roots);

    setupMeasurementFrame(frame, roots, sceneTarget, 0);
    const startRotation = frame.rotation.y;

    let visibilityRefreshes = 0;
    const host = {
      measure: true,
      _measurementFrame: frame,
      _measurementSpace: frame,
      _measurementUsesWorldAabbFallback: false,
      _getMeasureFloorY: () => 0,
      _refreshMeasurementVisibility: () => {
        visibilityRefreshes++;
      },
    };

    roots.forEach((root) => {
      root.rotation.y += Math.PI / 8;
    });
    roots[0].position.x += 0.5;
    roots[1].position.x += 0.5;
    roots.forEach((root) => root.updateMatrixWorld(true));

    syncMeasurementTransform(host, roots);

    expect(frame.rotation.y).to.not.equal(startRotation);
    expect(visibilityRefreshes).to.equal(1);
  });

  test('syncMeasurementFrameFromPivotTransform keeps fixed pivot during rotation', () => {
    const sceneTarget = new Object3D();
    const frame = new Object3D();
    sceneTarget.add(frame);

    const left = new Object3D();
    const right = new Object3D();
    left.position.set(-2, 0, 0);
    right.position.set(0.5, 0, 0);
    left.add(makeCubeMesh(1));
    right.add(makeCubeMesh(1));
    sceneTarget.add(left, right);

    setupMeasurementFrame(frame, [left, right], sceneTarget, 0);
    const baseRotationY = frame.rotation.y;
    const fixedPivot = frame.position.clone();

    // Orbit asymmetric pair 90° around origin; bbox center drifts from pivot.
    const angle = Math.PI / 2;
    for (const root of [left, right]) {
      const x = root.position.x;
      const z = root.position.z;
      root.position.set(
        x * Math.cos(angle) + z * Math.sin(angle),
        0,
        -x * Math.sin(angle) + z * Math.cos(angle)
      );
      root.rotation.y += angle;
      root.updateMatrixWorld(true);
    }

    const driftingPivot = computePivotOnFloor([left, right], 0);
    expect(driftingPivot.distanceTo(fixedPivot)).to.be.greaterThan(0.1);

    syncMeasurementFrameFromPivotTransform(
      frame,
      {
        position: [fixedPivot.x, fixedPivot.y, fixedPivot.z],
        rotation: [0, 90, 0],
        scale: [1, 1, 1],
      },
      baseRotationY,
      false
    );

    expect(frame.position.distanceTo(fixedPivot)).to.be.lessThan(1e-5);
    expect(frame.rotation.y).to.be.closeTo(baseRotationY + angle, 1e-5);
  });

  test('syncMeasurementTransform uses pivot transform detail for multi-select', () => {
    const frame = new Object3D();
    frame.position.set(0, 0, 0);
    frame.rotation.y = 0.2;

    const host = {
      measure: true,
      _measurementFrame: frame,
      _measurementSpace: frame,
      _measurementUsesWorldAabbFallback: false,
      _measurementFrameBaseRotationY: 0.2,
      _getMeasureFloorY: () => 0,
      _refreshMeasurementVisibility: () => {},
    };

    syncMeasurementTransform(
      host,
      [new Object3D(), new Object3D()],
      {
        target: {uuid: SELECTION_TRANSFORM_PIVOT_UUID, name: 'selection'},
        targets: [{uuid: 'a', name: 'a'}, {uuid: 'b', name: 'b'}],
        transform: {
          position: [1, 0, 2],
          rotation: [0, 45, 0],
          scale: [1, 1, 1],
        },
        active: null,
      }
    );

    expect(frame.position.x).to.equal(1);
    expect(frame.position.z).to.equal(2);
    expect(frame.rotation.y).to.be.closeTo(0.2 + (45 * Math.PI) / 180, 1e-5);
  });
});
