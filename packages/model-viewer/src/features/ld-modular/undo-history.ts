import {Euler, Object3D, Quaternion} from 'three';

import {
  getObjectDisplayName,
  type TransformComponent,
  type TransformSource,
  type TransformValues,
} from './transform-events.js';

export type HistoryEntryKind = 'transform' | 'add' | 'remove' | 'structure';

export type HistoryChangeReason =
  | 'record'
  | 'undo'
  | 'redo'
  | 'clear'
  | 'prune';

export type HistoryEntrySummary = {
  kind: HistoryEntryKind;
  id: string;
  label: string;
  targetNames: string[];
  targetUuids: string[];
  source?: TransformSource;
  objectCount: number;
};

export type HistoryState = {
  canUndo: boolean;
  canRedo: boolean;
  undoSize: number;
  redoSize: number;
  maxUndoSteps: number;
  isReplaying: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  nextUndo: HistoryEntrySummary | null;
  nextRedo: HistoryEntrySummary | null;
};

export type HistoryChangeDetail = HistoryState & {
  reason: HistoryChangeReason;
  affectedEntry: HistoryEntrySummary | null;
};

export type DetachedNodeRecord = {
  node: Object3D;
  parentUuid: string | null;
  siblingIndex: number;
  selectionUuids?: string[];
};

export type StructureNodeMemento = {
  uuid: string;
  name: string;
  parentUuid: string | null;
  siblingIndex: number;
  transform: TransformValues;
  userData: Record<string, unknown>;
  exists: boolean;
};

type TransformObjectChange = {
  uuid: string;
  before: TransformValues;
  after: TransformValues;
};

type TransformEntry = {
  kind: 'transform';
  id: string;
  summary: HistoryEntrySummary;
  changes: TransformObjectChange[];
};

type AddEntry = {
  kind: 'add';
  id: string;
  summary: HistoryEntrySummary;
  objectUuid: string;
};

type RemoveEntry = {
  kind: 'remove';
  id: string;
  summary: HistoryEntrySummary;
  detached: DetachedNodeRecord[];
};

type StructureEntry = {
  kind: 'structure';
  id: string;
  summary: HistoryEntrySummary;
  before: StructureNodeMemento[];
  after: StructureNodeMemento[];
};

type HistoryEntry = TransformEntry | AddEntry | RemoveEntry | StructureEntry;

const POSITION_EPS = 1e-4;
const ROTATION_EPS = 0.01;
const SCALE_EPS = 1e-4;

const STRUCTURE_USER_DATA_KEYS = [
  'isInGroup',
  'groupId',
  'isSnappedGroup',
  'isPlacedObject',
  'snapConnections',
  'ldLogicalRotationDeg',
  'name',
  'id',
  'selectable',
  'part',
  'selection',
  'snapPoints',
] as const;

let nextEntryId = 0;

function createEntryId(): string {
  nextEntryId += 1;
  return `undo-${nextEntryId}`;
}

export function transformsEqual(a: TransformValues, b: TransformValues): boolean {
  for (let i = 0; i < 3; i++) {
    if (Math.abs(a.position[i] - b.position[i]) > POSITION_EPS) return false;
    if (Math.abs(a.rotation[i] - b.rotation[i]) > ROTATION_EPS) return false;
    if (Math.abs(a.scale[i] - b.scale[i]) > SCALE_EPS) return false;
  }
  return true;
}

function cloneStructureUserData(
  userData: Record<string, unknown> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!userData) return out;
  for (const key of STRUCTURE_USER_DATA_KEYS) {
    const value = userData[key];
    if (value === undefined) continue;
    if (key === 'snapConnections' && Array.isArray(value)) {
      out[key] = value.map((item) =>
        typeof item === 'object' && item !== null ? {...item} : item
      );
    } else if (key === 'ldLogicalRotationDeg' && Array.isArray(value)) {
      out[key] = [...value];
    } else if (key === 'part' && typeof value === 'object' && value !== null) {
      out[key] = {...(value as object)};
    } else if (key === 'snapPoints' && Array.isArray(value)) {
      out[key] = value.map((item) =>
        typeof item === 'object' && item !== null ? {...item} : item
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function buildTransformLabel(
  components: TransformComponent[],
  targetNames: string[],
  objectCount: number
): string {
  const verb = components.includes('rotation')
    ? 'Rotate'
    : components.includes('scale')
      ? 'Scale'
      : 'Move';
  if (objectCount === 1 && targetNames[0]) {
    return `${verb} ${targetNames[0]}`;
  }
  return `${verb} ${objectCount} objects`;
}

export interface UndoHistoryHost {
  getObjectByUuid(uuid: string): Object3D | null;
  cloneTransformValues(obj: Object3D): TransformValues;
  applyTransformValues(obj: Object3D, values: TransformValues): void;
  getDisplayName(obj: Object3D): string;
  detachNode(node: Object3D, selectionUuids?: string[]): DetachedNodeRecord;
  reattachNode(record: DetachedNodeRecord): void;
  captureStructureMemento(nodes: Object3D[]): StructureNodeMemento[];
  applyStructureMemento(mementos: StructureNodeMemento[]): void;
  findSceneRoot(): Object3D | null;
  dispatchHistoryChange(detail: HistoryChangeDetail): void;
  requestRender(): void;
}

export class UndoHistoryManager {
  private _undoStack: HistoryEntry[] = [];
  private _redoStack: HistoryEntry[] = [];
  private _graveyard = new Map<string, Object3D>();
  private _isReplaying = false;
  private _batchDepth = 0;
  private _batchEntries: HistoryEntry[] = [];
  private _maxUndoSteps = 50;

  constructor(private readonly _host: UndoHistoryHost) {}

  get maxUndoSteps(): number {
    return this._maxUndoSteps;
  }

  set maxUndoSteps(value: number) {
    this._maxUndoSteps = Math.max(1, Math.floor(value));
    this._pruneOverflow();
  }

  get isReplaying(): boolean {
    return this._isReplaying;
  }

  canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  getHistoryState(): HistoryState {
    const nextUndo = this._undoStack[this._undoStack.length - 1]?.summary ?? null;
    const nextRedo = this._redoStack[this._redoStack.length - 1]?.summary ?? null;
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoSize: this._undoStack.length,
      redoSize: this._redoStack.length,
      maxUndoSteps: this._maxUndoSteps,
      isReplaying: this._isReplaying,
      undoLabel: nextUndo?.label ?? null,
      redoLabel: nextRedo?.label ?? null,
      nextUndo,
      nextRedo,
    };
  }

  beginBatch(): void {
    this._batchDepth += 1;
  }

  endBatch(label?: string): void {
    if (this._batchDepth <= 0) return;
    this._batchDepth -= 1;
    if (this._batchDepth > 0 || this._batchEntries.length === 0) return;

    const entries = this._batchEntries.splice(0);
    if (entries.length === 1) {
      this._pushEntry(entries[0], 'record');
      return;
    }

    const objectCount = entries.reduce(
      (sum, entry) => sum + entry.summary.objectCount,
      0
    );
    const targetNames = entries.flatMap((entry) => entry.summary.targetNames);
    const targetUuids = entries.flatMap((entry) => entry.summary.targetUuids);
    const summary: HistoryEntrySummary = {
      kind: 'add',
      id: createEntryId(),
      label: label ?? `Batch (${entries.length} actions)`,
      targetNames: targetNames.slice(0, 5),
      targetUuids,
      objectCount,
    };

    const batchEntry: HistoryEntry = {
      kind: 'structure',
      id: summary.id,
      summary,
      before: entries.flatMap((entry) => this._entryToBeforeMementos(entry)),
      after: entries.flatMap((entry) => this._entryToAfterMementos(entry)),
    };
    this._pushEntry(batchEntry, 'record');
  }

  recordTransform(
    changes: TransformObjectChange[],
    options: {
      source: TransformSource;
      components: TransformComponent[];
      targetNames: string[];
      targetUuids: string[];
      label?: string;
    }
  ): void {
    if (this._isReplaying || changes.length === 0) return;

    const meaningful = changes.filter(
      (change) => !transformsEqual(change.before, change.after)
    );
    if (meaningful.length === 0) return;

    const label =
      options.label ??
      buildTransformLabel(
        options.components,
        options.targetNames,
        meaningful.length
      );
    const summary: HistoryEntrySummary = {
      kind: 'transform',
      id: createEntryId(),
      label,
      targetNames: options.targetNames,
      targetUuids: options.targetUuids,
      source: options.source,
      objectCount: meaningful.length,
    };
    const entry: TransformEntry = {
      kind: 'transform',
      id: summary.id,
      summary,
      changes: meaningful,
    };
    this._enqueueOrPush(entry);
  }

  recordAdd(object: Object3D): void {
    if (this._isReplaying) return;
    const name = this._host.getDisplayName(object);
    const summary: HistoryEntrySummary = {
      kind: 'add',
      id: createEntryId(),
      label: `Place ${name}`,
      targetNames: [name],
      targetUuids: [object.uuid],
      objectCount: 1,
    };
    const entry: AddEntry = {
      kind: 'add',
      id: summary.id,
      summary,
      objectUuid: object.uuid,
    };
    this._enqueueOrPush(entry);
  }

  recordRemove(detached: DetachedNodeRecord[]): void {
    if (this._isReplaying || detached.length === 0) return;
    const names = detached.map((record) =>
      this._host.getDisplayName(record.node)
    );
    const label =
      detached.length === 1
        ? `Delete ${names[0]}`
        : `Delete ${detached.length} objects`;
    const summary: HistoryEntrySummary = {
      kind: 'remove',
      id: createEntryId(),
      label,
      targetNames: names,
      targetUuids: detached.map((record) => record.node.uuid),
      objectCount: detached.length,
    };
    const entry: RemoveEntry = {
      kind: 'remove',
      id: summary.id,
      summary,
      detached,
    };
    this._enqueueOrPush(entry);
  }

  recordStructure(
    before: StructureNodeMemento[],
    after: StructureNodeMemento[],
    label: string,
    targetNames: string[],
    targetUuids: string[]
  ): void {
    if (this._isReplaying) return;
    if (before.length === 0 && after.length === 0) return;
    const summary: HistoryEntrySummary = {
      kind: 'structure',
      id: createEntryId(),
      label,
      targetNames,
      targetUuids,
      objectCount: Math.max(targetNames.length, 1),
    };
    const entry: StructureEntry = {
      kind: 'structure',
      id: summary.id,
      summary,
      before,
      after,
    };
    this._enqueueOrPush(entry);
  }

  undo(): boolean {
    const entry = this._undoStack.pop();
    if (!entry) {
      this._notify('undo', null);
      return false;
    }

    this._isReplaying = true;
    try {
      this._applyEntryInverse(entry);
      this._redoStack.push(entry);
    } finally {
      this._isReplaying = false;
    }

    this._notify('undo', entry.summary);
    return true;
  }

  redo(): boolean {
    const entry = this._redoStack.pop();
    if (!entry) {
      this._notify('redo', null);
      return false;
    }

    this._isReplaying = true;
    try {
      this._applyEntryForward(entry);
      this._undoStack.push(entry);
      this._pruneOverflow();
    } finally {
      this._isReplaying = false;
    }

    this._notify('redo', entry.summary);
    return true;
  }

  clear(): void {
    this._undoStack = [];
    this._redoStack = [];
    this._batchEntries = [];
    this._batchDepth = 0;
    this._disposeGraveyard();
    this._notify('clear', null);
  }

  getGraveyardNode(uuid: string): Object3D | null {
    return this._graveyard.get(uuid) ?? null;
  }

  captureNodesMemento(nodes: Object3D[]): StructureNodeMemento[] {
    return this._host.captureStructureMemento(nodes);
  }

  detachToGraveyard(
    node: Object3D,
    selectionUuids?: string[]
  ): DetachedNodeRecord {
    const record = this._host.detachNode(node, selectionUuids);
    this._graveyard.set(node.uuid, node);
    return record;
  }

  private _enqueueOrPush(entry: HistoryEntry): void {
    if (this._batchDepth > 0) {
      this._batchEntries.push(entry);
      return;
    }
    this._pushEntry(entry, 'record');
  }

  private _pushEntry(entry: HistoryEntry, reason: HistoryChangeReason): void {
    this._undoStack.push(entry);
    this._redoStack = [];
    this._pruneOverflow();
    this._notify(reason, entry.summary);
  }

  private _applyEntryInverse(entry: HistoryEntry): void {
    switch (entry.kind) {
      case 'transform':
        for (const change of entry.changes) {
          const obj = this._host.getObjectByUuid(change.uuid);
          if (obj) {
            this._host.applyTransformValues(obj, change.before);
          }
        }
        break;
      case 'add': {
        const obj =
          this._host.getObjectByUuid(entry.objectUuid) ??
          this._graveyard.get(entry.objectUuid) ??
          null;
        if (obj) {
          this.detachToGraveyard(obj);
        }
        break;
      }
      case 'remove':
        for (const record of entry.detached) {
          this._graveyard.set(record.node.uuid, record.node);
          this._host.reattachNode(record);
        }
        break;
      case 'structure':
        this._host.applyStructureMemento(entry.before);
        break;
      default:
        break;
    }
    this._host.requestRender();
  }

  private _applyEntryForward(entry: HistoryEntry): void {
    switch (entry.kind) {
      case 'transform':
        for (const change of entry.changes) {
          const obj = this._host.getObjectByUuid(change.uuid);
          if (obj) {
            this._host.applyTransformValues(obj, change.after);
          }
        }
        break;
      case 'add': {
        const obj = this._graveyard.get(entry.objectUuid) ?? null;
        if (obj) {
          this._host.reattachNode({
            node: obj,
            parentUuid: null,
            siblingIndex: -1,
          });
        }
        break;
      }
      case 'remove':
        for (const record of entry.detached) {
          this.detachToGraveyard(record.node, record.selectionUuids);
        }
        break;
      case 'structure':
        this._host.applyStructureMemento(entry.after);
        break;
      default:
        break;
    }
    this._host.requestRender();
  }

  private _entryToBeforeMementos(entry: HistoryEntry): StructureNodeMemento[] {
    switch (entry.kind) {
      case 'structure':
        return entry.before;
      case 'transform':
        return entry.changes.map((change) => ({
          uuid: change.uuid,
          name: '',
          parentUuid: null,
          siblingIndex: -1,
          transform: change.before,
          userData: {},
          exists: true,
        }));
      case 'add':
        return [];
      case 'remove':
        return entry.detached.map((record) => ({
          uuid: record.node.uuid,
          name: record.node.name,
          parentUuid: record.parentUuid,
          siblingIndex: record.siblingIndex,
          transform: this._host.cloneTransformValues(record.node),
          userData: cloneStructureUserData(record.node.userData),
          exists: true,
        }));
      default:
        return [];
    }
  }

  private _entryToAfterMementos(entry: HistoryEntry): StructureNodeMemento[] {
    switch (entry.kind) {
      case 'structure':
        return entry.after;
      case 'transform':
        return entry.changes.map((change) => ({
          uuid: change.uuid,
          name: '',
          parentUuid: null,
          siblingIndex: -1,
          transform: change.after,
          userData: {},
          exists: true,
        }));
      case 'add': {
        const obj = this._host.getObjectByUuid(entry.objectUuid);
        if (!obj) return [];
        return [
          {
            uuid: obj.uuid,
            name: obj.name,
            parentUuid: obj.parent?.uuid ?? null,
            siblingIndex: obj.parent ? obj.parent.children.indexOf(obj) : -1,
            transform: this._host.cloneTransformValues(obj),
            userData: cloneStructureUserData(obj.userData),
            exists: true,
          },
        ];
      }
      case 'remove':
        return entry.detached.map((record) => ({
          uuid: record.node.uuid,
          name: record.node.name,
          parentUuid: record.parentUuid,
          siblingIndex: record.siblingIndex,
          transform: this._host.cloneTransformValues(record.node),
          userData: cloneStructureUserData(record.node.userData),
          exists: false,
        }));
      default:
        return [];
    }
  }

  private _pruneOverflow(): void {
    while (this._undoStack.length > this._maxUndoSteps) {
      const pruned = this._undoStack.shift();
      if (!pruned) break;
      this._releaseEntryResources(pruned);
      this._notify('prune', pruned.summary);
    }
  }

  private _releaseEntryResources(entry: HistoryEntry): void {
    const uuids = new Set<string>();
    if (entry.kind === 'remove') {
      for (const record of entry.detached) {
        uuids.add(record.node.uuid);
      }
    }
    if (entry.kind === 'add') {
      uuids.add(entry.objectUuid);
    }
    if (!this._isReferencedInStacks(uuids)) {
      for (const uuid of uuids) {
        this._disposeGraveyardNode(uuid);
      }
    }
  }

  private _isReferencedInStacks(uuids: Set<string>): boolean {
    const check = (entries: HistoryEntry[]) => {
      for (const entry of entries) {
        if (entry.kind === 'remove') {
          for (const record of entry.detached) {
            if (uuids.has(record.node.uuid)) return true;
          }
        }
        if (entry.kind === 'add' && uuids.has(entry.objectUuid)) {
          return true;
        }
      }
      return false;
    };
    return check(this._undoStack) || check(this._redoStack);
  }

  private _disposeGraveyard(): void {
    for (const uuid of [...this._graveyard.keys()]) {
      this._disposeGraveyardNode(uuid);
    }
  }

  private _disposeGraveyardNode(uuid: string): void {
    const node = this._graveyard.get(uuid);
    if (!node) return;
    this._graveyard.delete(uuid);
    node.traverse((child) => {
      const mesh = child as Object3D & {
        geometry?: {dispose?: () => void};
        material?: {dispose?: () => void};
      };
      try {
        mesh.geometry?.dispose?.();
      } catch (e) {}
      try {
        const material = mesh.material;
        if (Array.isArray(material)) {
          material.forEach((m) => m?.dispose?.());
        } else {
          material?.dispose?.();
        }
      } catch (e) {}
    });
  }

  private _notify(
    reason: HistoryChangeReason,
    affectedEntry: HistoryEntrySummary | null
  ): void {
    this._host.dispatchHistoryChange({
      ...this.getHistoryState(),
      reason,
      affectedEntry,
    });
  }
}

export function applyTransformValuesToObject(
  obj: Object3D,
  values: TransformValues
): void {
  obj.position.set(values.position[0], values.position[1], values.position[2]);
  obj.scale.set(values.scale[0], values.scale[1], values.scale[2]);
  obj.userData = obj.userData || {};
  if (Array.isArray(obj.userData.ldLogicalRotationDeg)) {
    obj.userData.ldLogicalRotationDeg = [...values.rotation];
  }
  const euler = new Euler(
    values.rotation[0] * (Math.PI / 180),
    values.rotation[1] * (Math.PI / 180),
    values.rotation[2] * (Math.PI / 180),
    obj.rotation.order
  );
  obj.quaternion.setFromEuler(euler);
  obj.rotation.setFromQuaternion(new Quaternion().copy(obj.quaternion), obj.rotation.order);
}

export function captureStructureMementoFromNodes(
  nodes: Object3D[],
  cloneTransformValues: (obj: Object3D) => TransformValues
): StructureNodeMemento[] {
  const seen = new Set<string>();
  const mementos: StructureNodeMemento[] = [];

  const visit = (obj: Object3D) => {
    if (seen.has(obj.uuid)) return;
    seen.add(obj.uuid);
    mementos.push({
      uuid: obj.uuid,
      name: obj.name,
      parentUuid: obj.parent?.uuid ?? null,
      siblingIndex: obj.parent ? obj.parent.children.indexOf(obj) : -1,
      transform: cloneTransformValues(obj),
      userData: cloneStructureUserData(obj.userData),
      exists: true,
    });
    if (obj.userData?.isSnappedGroup) {
      for (const child of obj.children) {
        visit(child);
      }
    }
  };

  for (const node of nodes) {
    visit(node);
  }
  return mementos;
}

export {getObjectDisplayName};
