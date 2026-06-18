import {Object3D, Quaternion, Vector3} from 'three';
import type {Part, SnapPoint} from '@london-dynamics/types/planner';
import type {Selection} from '@london-dynamics/types/puzzler';
import {
  allowsSurfaceType,
  requiresSurfaceSnap,
  type SurfaceType,
} from '../../utilities/snapping-points.js';
import {getObjectDisplayName} from './transform-events.js';
import {cloneMeshMaterials, restoreCommittedMeshRendering} from './overlay-rendering.js';

export type ClipboardEntryKind = 'part' | 'group';

export type GroupChildClipboardPayload = {
  oldName: string;
  part?: Partial<Part>;
  selection?: Selection;
  snapPoints?: SnapPoint[];
  selectable?: boolean;
  localPosition: Vector3;
  localQuaternion: Quaternion;
  localScale: Vector3;
};

export type GroupClipboardPayload = {
  snapConnections: Record<string, unknown>[];
  children: GroupChildClipboardPayload[];
};

export type ClipboardEntry = {
  kind: ClipboardEntryKind;
  sourceUuid: string;
  displayName?: string;
  requiresSurfaceSnap: boolean;
  allowedSurfaces: SurfaceType[];
  /** Detached Object3D.clone(true) — shares GPU buffers, not in scene. */
  prototype: Object3D;
  groupPayload?: GroupClipboardPayload;
};

export type ClipboardStateEntry = {
  kind: ClipboardEntryKind;
  sourceUuid: string;
  displayName?: string;
  requiresSurfaceSnap: boolean;
  allowedSurfaces?: SurfaceType[];
};

export type ClipboardPasteSessionState = {
  active: boolean;
  state: 'previewing' | 'committing';
  validTarget: boolean;
};

export type ClipboardState = {
  hasClipboard: boolean;
  entry?: ClipboardStateEntry;
  pasteSession?: ClipboardPasteSessionState;
};

export type ClipboardChangeReason =
  | 'copy'
  | 'clear'
  | 'paste-start'
  | 'paste-update'
  | 'paste-commit'
  | 'paste-cancel';

export type ClipboardChangeDetail = ClipboardState & {
  reason: ClipboardChangeReason;
};

function clonePlain<T>(value: T | undefined): T | undefined {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch (_e) {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

function cloneSnapConnections(
  connections: unknown[] | undefined
): Record<string, unknown>[] {
  if (!Array.isArray(connections)) return [];
  return connections.map((connection) => clonePlain(connection) as Record<string, unknown>);
}

function collectAllowedSurfaces(object: Object3D): SurfaceType[] {
  const surfaces = new Set<SurfaceType>();
  const snapPoints = object.userData?.snapPoints as SnapPoint[] | undefined;
  if (Array.isArray(snapPoints)) {
    for (const snapPoint of snapPoints) {
      const allowed = (snapPoint as {allowedSurfaces?: SurfaceType[]})
        .allowedSurfaces;
      if (Array.isArray(allowed)) {
        for (const surface of allowed) surfaces.add(surface);
      }
    }
  }
  if (surfaces.size === 0 && requiresSurfaceSnap(object)) {
    surfaces.add('wall');
  }
  if (surfaces.size === 0) {
    surfaces.add('floor');
  }
  return [...surfaces];
}

function snapshotPartUserData(source: Object3D): {
  part?: Partial<Part>;
  selection?: Selection;
  snapPoints?: SnapPoint[];
  selectable?: boolean;
} {
  const userData = source.userData || {};
  return {
    part: clonePlain(userData.part as Partial<Part> | undefined),
    selection: clonePlain(userData.selection as Selection | undefined),
    snapPoints: clonePlain(userData.snapPoints as SnapPoint[] | undefined),
    selectable:
      typeof userData.selectable === 'boolean' ? userData.selectable : undefined,
  };
}

function applyPartUserData(
  target: Object3D,
  payload: ReturnType<typeof snapshotPartUserData>
): void {
  target.userData = target.userData || {};
  if (payload.part !== undefined) target.userData.part = payload.part;
  if (payload.selection !== undefined) target.userData.selection = payload.selection;
  if (payload.snapPoints !== undefined) {
    target.userData.snapPoints = payload.snapPoints;
  }
  if (payload.selectable !== undefined) {
    target.userData.selectable = payload.selectable;
  }
}

function stripRuntimeUserData(node: Object3D): void {
  const userData = node.userData || {};
  delete userData.isPasteGhost;
  delete userData.isPlacementPlaceholder;
  delete userData.attachedSurfaceType;
  delete userData.attachedSurfaceName;
  delete userData.attachedSurfaceUuid;
  delete userData.attachedWallName;
  delete userData.attachedWallUuid;
  delete userData.isSurfaceSnapped;
  delete userData.groupId;
  delete userData.isInGroup;
}

function preparePrototypeClone(source: Object3D): Object3D {
  const prototype = source.clone(true);
  cloneMeshMaterials(prototype);
  prototype.traverse((child) => {
    stripRuntimeUserData(child);
    if (child.userData?.isPlacedObject === true) {
      const payload = snapshotPartUserData(child);
      applyPartUserData(child, payload);
    }
  });
  stripRuntimeUserData(prototype);
  return prototype;
}

export function isClipboardCopyTarget(node: Object3D | null): node is Object3D {
  if (!node) return false;
  if (node.userData?.isSnappedGroup === true) return true;
  return node.userData?.isPlacedObject === true;
}

export function snapshotClipboardEntry(source: Object3D): ClipboardEntry | null {
  if (!isClipboardCopyTarget(source)) return null;

  const isGroup = source.userData?.isSnappedGroup === true;
  const prototype = preparePrototypeClone(source);
  const allowedSurfaces = collectAllowedSurfaces(source);
  const requiresSnap = requiresSurfaceSnap(source);

  if (isGroup) {
    const children: GroupChildClipboardPayload[] = [];
    source.traverse((child) => {
      if (child === source) return;
      if (child.userData?.isPlacedObject !== true) return;
      const payload = snapshotPartUserData(child);
      children.push({
        oldName: child.name,
        ...payload,
        localPosition: child.position.clone(),
        localQuaternion: child.quaternion.clone(),
        localScale: child.scale.clone(),
      });
    });

    return {
      kind: 'group',
      sourceUuid: source.uuid,
      displayName: getObjectDisplayName(source),
      requiresSurfaceSnap: requiresSnap,
      allowedSurfaces,
      prototype,
      groupPayload: {
        snapConnections: cloneSnapConnections(
          source.userData?.snapConnections as unknown[] | undefined
        ),
        children,
      },
    };
  }

  const payload = snapshotPartUserData(source);
  applyPartUserData(prototype, payload);

  return {
    kind: 'part',
    sourceUuid: source.uuid,
    displayName: getObjectDisplayName(source),
    requiresSurfaceSnap: requiresSnap,
    allowedSurfaces,
    prototype,
  };
}

export function disposeClipboardEntry(entry: ClipboardEntry | null): void {
  if (!entry) return;
  entry.prototype.traverse((child) => {
    const mesh = child as {isMesh?: boolean; geometry?: {dispose?: () => void}};
    if (mesh.isMesh && mesh.geometry?.dispose) {
      // Shared geometry — do not dispose buffers; only drop references.
    }
  });
  entry.prototype.clear();
}

export function toClipboardStateEntry(
  entry: ClipboardEntry
): ClipboardStateEntry {
  return {
    kind: entry.kind,
    sourceUuid: entry.sourceUuid,
    displayName: entry.displayName,
    requiresSurfaceSnap: entry.requiresSurfaceSnap,
    allowedSurfaces: entry.allowedSurfaces,
  };
}

export function createSessionId(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

export type CommitPasteIdentityOptions = {
  part?: Partial<Part>;
  selection?: Selection;
  snapPoints?: SnapPoint[];
  name?: string;
  id?: string;
  selectable?: boolean;
};

export function applyCommittedPasteIdentity(
  object: Object3D,
  sessionId: string,
  options?: CommitPasteIdentityOptions
): string {
  const objectKey = options?.id || sessionId;
  object.name = objectKey;
  object.userData = object.userData || {};
  object.userData.id = objectKey;
  const displayName =
    options?.name ??
    (options?.part as {name?: string} | undefined)?.name;
  if (displayName !== undefined) {
    object.userData.name = displayName;
  }
  if (options?.part !== undefined) object.userData.part = options.part;
  if (options?.selection !== undefined) {
    object.userData.selection = options.selection;
  }
  if (options?.snapPoints !== undefined) {
    object.userData.snapPoints = options.snapPoints;
  }
  object.userData.isPlacedObject = true;
  object.userData.selectable =
    options?.selectable !== undefined ? options.selectable : true;
  delete object.userData.isPasteGhost;
  return objectKey;
}

export function commitPasteClone(
  entry: ClipboardEntry,
  sessionId: string
): Object3D {
  const node = entry.prototype.clone(true);
  cloneMeshMaterials(node);
  restoreCommittedMeshRendering(node);

  if (entry.kind === 'group' && entry.groupPayload) {
    const groupName = `group_${Date.now()}`;
    node.name = groupName;
    node.userData = node.userData || {};
    node.userData.isSnappedGroup = true;
    node.userData.snapConnections = [];

    const nameMap = new Map<string, string>();
    const childPayloadByOldName = new Map(
      entry.groupPayload.children.map((child) => [child.oldName, child])
    );

    node.traverse((child) => {
      if (child === node) return;
      if (child.userData?.isPlacedObject !== true) return;
      const oldName = child.name;
      const payload = childPayloadByOldName.get(oldName);
      const childSessionId = `${sessionId}_${oldName}`;
      const childKey = applyCommittedPasteIdentity(child, childSessionId, {
        part: payload?.part,
        selection: payload?.selection,
        snapPoints: payload?.snapPoints,
        selectable: payload?.selectable,
      });
      nameMap.set(oldName, childKey);
      child.userData.isInGroup = true;
      child.userData.groupId = groupName;
      if (payload) {
        child.position.copy(payload.localPosition);
        child.quaternion.copy(payload.localQuaternion);
        child.scale.copy(payload.localScale);
      }
    });

    const remappedConnections = entry.groupPayload.snapConnections.map(
      (connection) => {
        const next = {...connection};
        if (typeof next.a === 'string' && nameMap.has(next.a)) {
          next.a = nameMap.get(next.a)!;
        }
        if (typeof next.b === 'string' && nameMap.has(next.b)) {
          next.b = nameMap.get(next.b)!;
        }
        return next;
      }
    );
    node.userData.snapConnections = remappedConnections;
    return node;
  }

  const payload = snapshotPartUserData(entry.prototype);
  applyCommittedPasteIdentity(node, sessionId, {
    part: payload.part,
    selection: payload.selection,
    snapPoints: payload.snapPoints,
    selectable: payload.selectable,
    name: entry.displayName,
  });
  return node;
}

export function entryRequiresSurfaceSnap(entry: ClipboardEntry): boolean {
  return entry.requiresSurfaceSnap;
}

export function getEntryPrimarySnapPoint(entry: ClipboardEntry): SnapPoint | null {
  const snapPoints = entry.prototype.userData?.snapPoints as
    | SnapPoint[]
    | undefined;
  if (Array.isArray(snapPoints) && snapPoints.length > 0) {
    const surfacePoint = snapPoints.find((point) => !!(point as any)?.surfaceSnap);
    return surfacePoint ?? snapPoints[0];
  }
  if (entry.kind === 'group') {
    for (const child of entry.groupPayload?.children ?? []) {
      const points = child.snapPoints;
      if (!Array.isArray(points) || points.length === 0) continue;
      const surfacePoint = points.find((point) => !!(point as any)?.surfaceSnap);
      return surfacePoint ?? points[0];
    }
  }
  return null;
}

export function entryAllowsSurface(
  entry: ClipboardEntry,
  surfaceType: SurfaceType
): boolean {
  const snapPoint = getEntryPrimarySnapPoint(entry);
  if (!snapPoint) return surfaceType === 'floor';
  return allowsSurfaceType(snapPoint, surfaceType);
}
