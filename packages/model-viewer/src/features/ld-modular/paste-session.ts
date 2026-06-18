import {Object3D} from 'three';
import {$needsRender, $scene} from '../../model-viewer-base.js';
import {
  type ClipboardEntry,
  commitPasteClone,
  createSessionId,
  entryRequiresSurfaceSnap,
} from './clipboard.js';
import {
  applyOverlayRendering,
  cloneMeshMaterials,
  markPasteGhostNonInteractive,
} from './overlay-rendering.js';
import {applyPointerPlacementPose, type PlacementPoseHost} from './placement-pose.js';
import type {SurfaceSnapHit} from '../../utilities/surface-snapping.js';

export type PasteSessionState = 'previewing' | 'committing' | 'ended' | 'cancelled';

export type PasteCommitResult = {
  id: string;
  node: Object3D;
};

export type PasteSessionHost = PlacementPoseHost & {
  [$needsRender](): void;
  applySurfaceSnapForPlacement(
    object: Object3D,
    clientX: number,
    clientY: number
  ): SurfaceSnapHit | null;
  _finalizePasteCommit(
    node: Object3D,
    entry: ClipboardEntry,
    options?: {select?: boolean}
  ): PasteCommitResult;
  _emitClipboardChange(reason: string): void;
};

/**
 * Interactive paste session: ghost follows pointer until click commits.
 */
export class PasteSession extends EventTarget {
  readonly id: string;
  state: PasteSessionState = 'previewing';
  ghost: Object3D | null = null;
  private readonly _entry: ClipboardEntry;
  private readonly _host: PasteSessionHost;
  private _hasValidSurfaceSnap = false;

  constructor(host: PasteSessionHost, entry: ClipboardEntry) {
    super();
    this.id = createSessionId();
    this._host = host;
    this._entry = entry;
    this.dispatchEvent(
      new CustomEvent('start', {detail: {sessionId: this.id}})
    );
  }

  get hasValidSurfaceSnap(): boolean {
    return !entryRequiresSurfaceSnap(this._entry) || this._hasValidSurfaceSnap;
  }

  createGhost(): Object3D | null {
    const scene = this._host[$scene];
    const parent = scene?.target || scene;
    if (!parent) return null;

    const ghost = this._entry.prototype.clone(true);
    cloneMeshMaterials(ghost);
    markPasteGhostNonInteractive(ghost);
    applyOverlayRendering(ghost);
    ghost.visible = false;
    parent.add(ghost);
    this.ghost = ghost;
    return ghost;
  }

  updatePosition(clientX: number, clientY: number): void {
    if (!this.ghost || this.state !== 'previewing') return;

    const pose = applyPointerPlacementPose(
      this._host,
      this.ghost,
      clientX,
      clientY
    );

    this._hasValidSurfaceSnap = pose.hasValidSurfaceSnap;

    if (!pose.worldPoint) {
      try {
        this.ghost.visible = false;
      } catch (_e) {}
      this._host._emitClipboardChange('paste-update');
      this.dispatchEvent(
        new CustomEvent('update', {
          detail: {
            sessionId: this.id,
            worldPoint: null,
            validTarget: false,
          },
        })
      );
      this._host[$needsRender]();
      return;
    }

    try {
      this.ghost.visible = true;
    } catch (_e) {}

    this._host._emitClipboardChange('paste-update');
    this.dispatchEvent(
      new CustomEvent('update', {
        detail: {
          sessionId: this.id,
          worldPoint: pose.targetBottomCenter
            ? {
                x: pose.targetBottomCenter.x,
                y: pose.targetBottomCenter.y,
                z: pose.targetBottomCenter.z,
              }
            : {
                x: pose.worldPoint.x,
                y: pose.worldPoint.y,
                z: pose.worldPoint.z,
              },
          validTarget: this.hasValidSurfaceSnap,
        },
      })
    );
    this._host[$needsRender]();
  }

  commit(options?: {select?: boolean}): PasteCommitResult | null {
    if (this.state !== 'previewing') return null;
    if (entryRequiresSurfaceSnap(this._entry) && !this._hasValidSurfaceSnap) {
      return null;
    }

    this.state = 'committing';
    const sessionId = createSessionId();
    const node = commitPasteClone(this._entry, sessionId);

    if (this.ghost) {
      node.position.copy(this.ghost.position);
      node.quaternion.copy(this.ghost.quaternion);
      node.scale.copy(this.ghost.scale);
      this._copySurfaceMetadata(this.ghost, node);
      this._removeGhost();
    }

    const scene = this._host[$scene];
    const parent = scene?.target || scene;
    if (parent) {
      try {
        parent.add(node);
      } catch (_e) {
        this.state = 'previewing';
        return null;
      }
    }

    const result = this._host._finalizePasteCommit(node, this._entry, options);
    this.state = 'ended';
    this.dispatchEvent(
      new CustomEvent('commit', {detail: {sessionId: this.id, ...result}})
    );
    return result;
  }

  cancel(): void {
    if (this.state === 'ended' || this.state === 'cancelled') return;
    this._removeGhost();
    this.state = 'cancelled';
    this._host._emitClipboardChange('paste-cancel');
    this.dispatchEvent(
      new CustomEvent('cancel', {detail: {sessionId: this.id}})
    );
    this._host[$needsRender]();
  }

  dispose(): void {
    this._removeGhost();
    this.state = 'ended';
  }

  private _copySurfaceMetadata(from: Object3D, to: Object3D): void {
    const keys = [
      'attachedSurfaceType',
      'attachedSurfaceName',
      'attachedSurfaceUuid',
      'attachedWallName',
      'attachedWallUuid',
      'isSurfaceSnapped',
    ] as const;

    const copyKeys = (source: Object3D, target: Object3D) => {
      for (const key of keys) {
        if (typeof source.userData?.[key] !== 'undefined') {
          target.userData[key] = source.userData[key];
        }
      }
    };

    copyKeys(from, to);

    const fromChildren: Object3D[] = [];
    const toChildren: Object3D[] = [];
    from.traverse((child) => {
      if (child !== from && child.userData?.isPlacedObject === true) {
        fromChildren.push(child);
      }
    });
    to.traverse((child) => {
      if (child !== to && child.userData?.isPlacedObject === true) {
        toChildren.push(child);
      }
    });
    const count = Math.min(fromChildren.length, toChildren.length);
    for (let i = 0; i < count; i++) {
      copyKeys(fromChildren[i], toChildren[i]);
    }
  }

  private _removeGhost(): void {
    if (!this.ghost) return;
    try {
      this.ghost.parent?.remove(this.ghost);
    } catch (_e) {}
    this.ghost = null;
  }
}
