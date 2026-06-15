/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {BoxGeometry, Mesh, MeshBasicMaterial, Object3D} from 'three';

import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import type {HistoryChangeDetail} from '../../features/ld-modular/undo-history.js';
import {
  buildTransformLabel,
  transformsEqual,
  UndoHistoryManager,
} from '../../features/ld-modular/undo-history.js';

const prepareSceneHarness = (element: ModelViewerElement) => {
  const target = new Object3D();
  target.name = 'scene-target';

  const scene = {
    target,
    add(child: Object3D) {
      target.add(child);
    },
    getObjectByName(name: string) {
      return target.getObjectByName(name);
    },
    getObjectByProperty(prop: string, value: unknown) {
      let found: Object3D | null = null;
      target.traverse((child) => {
        if ((child as unknown as Record<string, unknown>)[prop] === value) {
          found = child;
        }
      });
      return found;
    },
    queueRender() {},
  };

  (element as any)[$scene] = scene;
  return {target};
};

const addPlacedPart = (target: Object3D, name: string, displayName?: string) => {
  const part = new Object3D();
  part.name = name;
  part.userData.isPlacedObject = true;
  if (displayName) {
    part.userData.name = displayName;
  }
  target.add(part);
  return part;
};

const addPlacedBoxPart = (
  target: Object3D,
  name: string,
  position: [number, number, number],
  displayName?: string
) => {
  const part = addPlacedPart(target, name, displayName);
  part.position.set(position[0], position[1], position[2]);
  const mesh = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshBasicMaterial()
  );
  part.add(mesh);
  return part;
};

suite('ld-modular undo history utilities', () => {
  test('transformsEqual ignores tiny deltas', () => {
    expect(
      transformsEqual(
        {position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1]},
        {position: [1e-6, 0, 0], rotation: [0.001, 0, 0], scale: [1, 1, 1]}
      )
    ).to.equal(true);
  });

  test('buildTransformLabel formats single and multi targets', () => {
    expect(buildTransformLabel(['position'], ['Chair'], 1)).to.equal(
      'Move Chair'
    );
    expect(buildTransformLabel(['rotation'], ['A', 'B'], 2)).to.equal(
      'Rotate 2 objects'
    );
  });
});

suite('ld-modular undo / redo', () => {
  let element: ModelViewerElement;
  let target: Object3D;

  setup(() => {
    element = new ModelViewerElement();
    ({target} = prepareSceneHarness(element));
  });

  teardown(() => {
    if (element.parentNode != null) {
      element.parentNode.removeChild(element);
    }
  });

  test('exposes undo/redo public API', () => {
    expect(typeof element.undo).to.equal('function');
    expect(typeof element.redo).to.equal('function');
    expect(typeof element.canUndo).to.equal('function');
    expect(typeof element.canRedo).to.equal('function');
    expect(typeof element.clearUndoHistory).to.equal('function');
    expect(typeof element.getHistoryState).to.equal('function');
  });

  test('setPosition records one undo step and restores on undo/redo', () => {
    const part = addPlacedPart(target, 'chair', 'Chair');
    part.position.set(0, 0, 0);

    element.setPosition('chair', [1, 2, 3]);
    expect(part.position.toArray()).to.deep.equal([1, 2, 3]);
    expect(element.canUndo()).to.equal(true);
    expect(element.getHistoryState().undoLabel).to.equal('Move Chair');

    expect(element.undo()).to.equal(true);
    expect(part.position.toArray()).to.deep.equal([0, 0, 0]);
    expect(element.canRedo()).to.equal(true);

    expect(element.redo()).to.equal(true);
    expect(part.position.toArray()).to.deep.equal([1, 2, 3]);
  });

  test('history-change fires with reason and stack metadata', () => {
    addPlacedPart(target, 'lamp', 'Lamp');
    const events: HistoryChangeDetail[] = [];
    element.addEventListener('history-change', ((e: CustomEvent) => {
      events.push(e.detail);
    }) as EventListener);

    element.setPosition('lamp', [2, 0, 1]);
    expect(events.length).to.be.greaterThan(0);
    const last = events[events.length - 1];
    expect(last.reason).to.equal('record');
    expect(last.canUndo).to.equal(true);
    expect(last.nextUndo?.label).to.equal('Move Lamp');
    expect(last.affectedEntry?.kind).to.equal('transform');

    element.undo();
    const undoEvent = events[events.length - 1];
    expect(undoEvent.reason).to.equal('undo');
    expect(undoEvent.isReplaying).to.equal(false);
    expect(undoEvent.canUndo).to.equal(false);
    expect(undoEvent.canRedo).to.equal(true);
  });

  test('getHistoryState matches event detail minus reason fields', () => {
    addPlacedPart(target, 'table', 'Table');
    let eventDetail: HistoryChangeDetail | null = null;
    element.addEventListener('history-change', ((e: CustomEvent) => {
      eventDetail = e.detail;
    }) as EventListener);

    element.setPosition('table', [0, 1, 0]);
    const state = element.getHistoryState();
    expect(state.canUndo).to.equal(eventDetail!.canUndo);
    expect(state.undoSize).to.equal(eventDetail!.undoSize);
    expect(state.undoLabel).to.equal(eventDetail!.undoLabel);
    expect(state.nextUndo?.id).to.equal(eventDetail!.nextUndo?.id);
  });

  test('deleteNode undo restores object in scene', () => {
    const part = addPlacedPart(target, 'sofa', 'Sofa');
    const uuid = part.uuid;

    (element as any).deleteNode(part);
    expect(target.getObjectByName('sofa')).to.equal(undefined);
    expect(element.canUndo()).to.equal(true);

    element.undo();
    const restored = (element as any).getPart(uuid);
    expect(restored).to.not.equal(null);
    expect(restored?.name).to.equal('sofa');
    expect(target.getObjectByName('sofa')).to.equal(restored);
  });

  test('groupSelectedObjects undo restores pre-group state', () => {
    const partA = addPlacedPart(target, 'part-a', 'Part A');
    const partB = addPlacedPart(target, 'part-b', 'Part B');
    (element as any).selectedObjects = [partA, partB];
    (element as any).selectGroup = (group: Object3D) => {
      (element as any).selectedObjects = [group];
      return true;
    };

    const group = (element as any).groupSelectedObjects();
    expect(group).to.not.equal(null);
    expect(partA.parent?.userData?.isSnappedGroup).to.equal(true);

    element.undo();
    expect(partA.parent?.userData?.isSnappedGroup).to.not.equal(true);
    expect(partB.parent?.userData?.isSnappedGroup).to.not.equal(true);
    expect(target.children.includes(partA)).to.equal(true);
    expect(target.children.includes(partB)).to.equal(true);
  });

  test('replay does not push new undo entries', () => {
    addPlacedPart(target, 'bench', 'Bench');
    element.setPosition('bench', [3, 0, 0]);
    const sizeAfterMove = element.getHistoryState().undoSize;

    element.undo();
    element.undo();
    expect(element.getHistoryState().undoSize).to.equal(sizeAfterMove - 1);
  });

  test('maxUndoSteps prunes oldest entries and emits prune reason', () => {
    element.maxUndoSteps = 2;
    (element as any)._ensureUndoHistory().maxUndoSteps = 2;

    const reasons: string[] = [];
    element.addEventListener('history-change', ((e: CustomEvent) => {
      reasons.push(e.detail.reason);
    }) as EventListener);

    const a = addPlacedPart(target, 'a', 'A');
    const b = addPlacedPart(target, 'b', 'B');
    const c = addPlacedPart(target, 'c', 'C');

    element.setPosition('a', [1, 0, 0]);
    element.setPosition('b', [2, 0, 0]);
    element.setPosition('c', [3, 0, 0]);

    expect(element.getHistoryState().undoSize).to.equal(2);
    expect(reasons).to.include('prune');

    element.undo();
    expect(a.position.x).to.equal(1);
    expect(b.position.x).to.equal(2);
    expect(c.position.x).to.equal(0);
  });

  test('clearUndoHistory resets stacks', () => {
    const part = addPlacedPart(target, 'clear-me', 'Clear Me');
    element.setPosition('clear-me', [1, 0, 0]);
    expect(element.canUndo()).to.equal(true);

    element.clearUndoHistory();
    expect(element.canUndo()).to.equal(false);
    expect(element.canRedo()).to.equal(false);
    expect(part.position.x).to.equal(1);
  });

  test('alignObjects records one undo step and restores on undo', () => {
    const partA = addPlacedBoxPart(target, 'align-a', [-2, 0, 0], 'A');
    const partB = addPlacedBoxPart(target, 'align-b', [1, 0, 0], 'B');
    const partC = addPlacedBoxPart(target, 'align-c', [3, 0, 2], 'C');
    (element as any).selectedObjects = [partA, partB, partC];

    const transformStarts: number[] = [];
    element.addEventListener('transformstart', ((e: CustomEvent) => {
      transformStarts.push(e.detail.targets?.length ?? 0);
    }) as EventListener);

    const beforeB = partB.position.x;
    const beforeC = partC.position.x;

    expect(element.alignObjects('align-left')).to.equal(true);
    expect(element.canUndo()).to.equal(true);
    expect(element.getHistoryState().undoLabel).to.include('Align left');
    expect(transformStarts).to.deep.equal([3]);

    expect(partB.position.x).to.not.be.closeTo(beforeB, 1e-3);
    expect(partC.position.x).to.not.be.closeTo(beforeC, 1e-3);

    expect(element.undo()).to.equal(true);
    expect(partA.position.x).to.be.closeTo(-2, 1e-4);
    expect(partB.position.x).to.be.closeTo(beforeB, 1e-4);
    expect(partC.position.x).to.be.closeTo(beforeC, 1e-4);

    expect(element.redo()).to.equal(true);
    expect(partB.position.x).to.not.be.closeTo(beforeB, 1e-3);
  });

  test('alignObjects returns false with insufficient selection', () => {
    const part = addPlacedBoxPart(target, 'solo', [0, 0, 0]);
    (element as any).selectedObjects = [part];
    expect(element.alignObjects('align-left')).to.equal(false);
    expect(element.canUndo()).to.equal(false);
  });
});

suite('UndoHistoryManager batching', () => {
  test('endBatch merges multiple remove records', () => {
    const target = new Object3D();
    const detached: Object3D[] = [];
    const manager = new UndoHistoryManager({
      getObjectByUuid: () => null,
      cloneTransformValues: (obj) => ({
        position: obj.position.toArray() as [number, number, number],
        rotation: [0, 0, 0],
        scale: obj.scale.toArray() as [number, number, number],
      }),
      applyTransformValues: () => {},
      getDisplayName: (obj) => obj.name,
      detachNode: (node) => {
        detached.push(node);
        return {node, parentUuid: null, siblingIndex: -1};
      },
      reattachNode: () => {},
      captureStructureMemento: () => [],
      applyStructureMemento: () => {},
      findSceneRoot: () => target,
      dispatchHistoryChange: () => {},
      requestRender: () => {},
    });

    const a = new Object3D();
    a.name = 'a';
    const b = new Object3D();
    b.name = 'b';
    target.add(a);
    target.add(b);

    manager.beginBatch();
    manager.recordRemove([{node: a, parentUuid: target.uuid, siblingIndex: 0}]);
    manager.recordRemove([{node: b, parentUuid: target.uuid, siblingIndex: 1}]);
    manager.endBatch('Delete 2 objects');

    expect(manager.canUndo()).to.equal(true);
    expect(manager.getHistoryState().undoLabel).to.equal('Delete 2 objects');
    expect(manager.getHistoryState().undoSize).to.equal(1);
  });
});
