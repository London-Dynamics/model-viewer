import {Object3D} from 'three';
import {$needsRender, $scene} from '../../model-viewer-base.js';
import {
  type ClipboardEntry,
  commitPasteTargets,
  createSessionId,
  entryRequiresSurfaceSnap,
  getSelectionClipboardItems,
  getSelectionLeaderIndex,
} from './clipboard.js';
import {
  applyOverlayRendering,
  cloneMeshMaterials,
  markPasteGhostNonInteractive,
} from './overlay-rendering.js';
import {
  applyPointerPlacementPose,
  applySelectionPointerPlacementPose,
  type PlacementPoseHost,
  type SelectionPlacementItem,
} from './placement-pose.js';
import type {SurfaceSnapHit} from '../../utilities/surface-snapping.js';

export type PasteSessionState = 'previewing' | 'committing' | 'ended' | 'cancelled';

export type PasteCommitResult = {
  id: string;
  node: Object3D;
  nodes?: Object3D[];
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
    options?: {select?: boolean; emitChange?: boolean}
  ): PasteCommitResult;
  _finalizePasteCommitMany?(
    commits: Array<{node: Object3D; itemEntry: ClipboardEntry}>,
    options?: {select?: boolean}
  ): PasteCommitResult;
  _emitClipboardChange(reason: string): void;
};

/**
 * Interactive paste session: ghost(s) follow the pointer until click commits.
 */
export class PasteSession extends EventTarget {
  readonly id: string;
  state: PasteSessionState = 'previewing';
  ghost: Object3D | null = null;
  ghosts: Object3D[] = [];
  private readonly _entry: ClipboardEntry;
  private readonly _host: PasteSessionHost;
  private readonly _placementItems: SelectionPlacementItem[] = [];
  private _leaderIndex = 0;
  private _hasValidSurfaceSnap = false;

  constructor(host: PasteSessionHost, entry: ClipboardEntry) {
    super();
    this.id = createSessionId();
    this._host = host;
    this._entry = entry;
    this._leaderIndex = getSelectionLeaderIndex(entry);
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

    const selectionItems = getSelectionClipboardItems(this._entry);
    this.ghosts = selectionItems.map((item) => {
      const ghost = item.itemEntry.prototype.clone(true);
      cloneMeshMaterials(ghost);
      markPasteGhostNonInteractive(ghost);
      applyOverlayRendering(ghost);
      ghost.visible = false;
      parent.add(ghost);
      return ghost;
    });

    this._placementItems.length = 0;
    for (let index = 0; index < selectionItems.length; index++) {
      const item = selectionItems[index];
      this._placementItems.push({
        object: this.ghosts[index],
        requiresSurfaceSnap: item.itemEntry.requiresSurfaceSnap,
        anchorOffset: item.anchorOffset.clone(),
      });
    }

    this.ghost = this.ghosts[this._leaderIndex] ?? this.ghosts[0] ?? null;
    return this.ghost;
  }

  updatePosition(clientX: number, clientY: number): void {
    if (this.ghosts.length === 0 || this.state !== 'previewing') return;

    const leader = this.ghosts[this._leaderIndex] ?? this.ghosts[0];
    if (!leader) return;

    const pose =
      this._placementItems.length > 1
        ? applySelectionPointerPlacementPose(
            this._host,
            leader,
            this._placementItems,
            clientX,
            clientY
          )
        : {
            ...applyPointerPlacementPose(
              this._host,
              leader,
              clientX,
              clientY
            ),
            itemValidSnap: [true],
          };

    this._hasValidSurfaceSnap = pose.hasValidSurfaceSnap;

    if (!pose.worldPoint) {
      for (const ghost of this.ghosts) {
        try {
          ghost.visible = false;
        } catch (_e) {}
      }
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

    for (const ghost of this.ghosts) {
      try {
        ghost.visible = true;
      } catch (_e) {}
    }

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
    const commits = commitPasteTargets(this._entry, sessionId);

    for (let index = 0; index < commits.length; index++) {
      const {node} = commits[index];
      const ghost = this.ghosts[index];
      if (!ghost) continue;

      node.position.copy(ghost.position);
      node.quaternion.copy(ghost.quaternion);
      node.scale.copy(ghost.scale);
      this._copySurfaceMetadata(ghost, node);
    }

    this._removeGhosts();

    const scene = this._host[$scene];
    const parent = scene?.target || scene;
    if (parent) {
      for (const {node} of commits) {
        try {
          parent.add(node);
        } catch (_e) {
          this.state = 'previewing';
          return null;
        }
      }
    }

    let result: PasteCommitResult;
    if (commits.length > 1 && this._host._finalizePasteCommitMany) {
      result = this._host._finalizePasteCommitMany(commits, options);
    } else {
      result = this._host._finalizePasteCommit(
        commits[0].node,
        commits[0].itemEntry,
        options
      );
    }

    this.state = 'ended';
    this.dispatchEvent(
      new CustomEvent('commit', {detail: {sessionId: this.id, ...result}})
    );
    return result;
  }

  cancel(): void {
    if (this.state === 'ended' || this.state === 'cancelled') return;
    this._removeGhosts();
    this.state = 'cancelled';
    this._host._emitClipboardChange('paste-cancel');
    this.dispatchEvent(
      new CustomEvent('cancel', {detail: {sessionId: this.id}})
    );
    this._host[$needsRender]();
  }

  dispose(): void {
    this._removeGhosts();
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

  private _removeGhosts(): void {
    for (const ghost of this.ghosts) {
      try {
        ghost.parent?.remove(ghost);
      } catch (_e) {}
    }
    this.ghosts = [];
    this.ghost = null;
  }
}
