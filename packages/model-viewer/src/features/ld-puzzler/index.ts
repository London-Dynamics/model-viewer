import { property } from 'lit/decorators.js';
import { Object3D, Vector3, Box3 } from 'three';

import { Constructor } from '../../utilities.js';
import ModelViewerElementBase, {
  $needsRender,
  $scene,
  $renderer,
} from '../../model-viewer-base.js';
import { $getMouseWorldPoint } from '../ld-cursor/index.js';

import { SnappingPoint } from '../../utilities/snapping-points.js';

// Re-export SnappingPoint type for external use
export type { SnappingPoint };

type PlacementOptions = {
  mass?: number;
  name?: string;
  selectable?: boolean;
  snappingPoints?: SnappingPoint[]; // Optional snap points with position and rotation relative to object center
};

type PlaceFunction = (
  src: string,
  position: {
    x: number;
    y: number;
    z: number;
  },
  options?: PlacementOptions
) => Promise<void>;

type RotateFunction = () => void;

type SelectionScope = 'placed' | 'puzzler-root' | 'both' | 'all';

type TransformFunction = () => void;

export declare interface LDPuzzlerInterface {
  place: PlaceFunction;
  rotate: RotateFunction;
  transform: TransformFunction;
  startPlacement?: (
    lowResSrc: string,
    highResSrc: string,
    options?: any,
    initialMouse?: { clientX: number; clientY: number }
  ) => any;
}

export const LDPuzzlerMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDPuzzlerInterface> & T => {
  class LDPuzzlerModelViewerElement extends ModelViewerElement {
    @property({ type: Boolean, attribute: 'edit-mode' })
    editMode: boolean = false;

    @property({ type: Boolean, attribute: 'snapping-enabled' })
    snappingEnabled: boolean = false;

    @property({ type: Boolean, attribute: 'snapping-points-visible' })
    snappingPointsVisible: boolean = false;

    /**
     * Which nodes are allowed to be selected.
     * - 'placed' (default): only objects created with place() (prefix "part_"), respecting selectable:false
     * - 'puzzler-root': only children of "PuzzlerRoot" whose name starts with "id_"
     * - 'both': union of 'placed' and 'puzzler-root'
     * - 'all': any scene node (still respects selectable:false)
     */
    @property({ type: String, attribute: 'selection-scope' })
    selectionScope: SelectionScope = 'placed';

    // Return true only when edit-mode is enabled and the node passes the scope & selectable checks
    _isNodeSelectable(node: any): boolean {
      if (!this.editMode) return false;
      if (!node) return false;
      if (node.selectable === false || node.userData?.selectable === false)
        return false;

      const name = node.name || '';
      const isPlaced = name.startsWith('placed_');
      const isPuzzlerId =
        node.parent &&
        node.parent.name === 'PuzzlerRoot' &&
        name.startsWith('id_');

      switch (this.selectionScope) {
        case 'placed':
          return isPlaced;
        case 'puzzler-root':
          return isPuzzlerId;
        case 'both':
          return isPlaced || isPuzzlerId;
        case 'all':
          return true;
        default:
          return isPlaced;
      }
    }

    // Internal counter for naming placed objects / sessions
    private _placementCounter = 0;
    private _activePlacementSession: PlacementSession | null = null;

    /**
     * Direct placement API: load a GLB and add it at the provided world position.
     * Returns a promise that resolves when the model is loaded and inserted.
     */
    place: PlaceFunction = async (src, position, options) => {
      const scene = this[$scene];
      if (!scene) return;

      const loader = this[$renderer].loader;

      // Load via renderer's loader which uses the project's caching loader.
      const gltf = await loader.load(
        src,
        this as unknown as ModelViewerElementBase
      );

      if (!gltf || !gltf.scene) return;

      // Name + mark as placed so selection scope recognizes it.
      const placedName = `placed_${++this._placementCounter}`;
      gltf.scene.name = options?.name || placedName;
      gltf.scene.userData = gltf.scene.userData || {};
      gltf.scene.userData.isPlacedObject = true;
      if (options?.selectable === false) gltf.scene.userData.selectable = false;

      // Apply position
      gltf.scene.position.set(position.x, position.y, position.z);

      // Attach to the scene target so it participates in the scene graph
      try {
        scene.target.add(gltf.scene);
      } catch (e) {
        // Fallback: add to scene root
        scene.add(gltf.scene);
      }
    };

    rotate: RotateFunction = () => {
      // Implementation for rotating the selected puzzle piece
    };
    transform: TransformFunction = () => {
      // Implementation for transforming the selected puzzle piece
    };

    /**
     * Start an interactive placement session using a low-resolution GLB as a
     * placeholder. Returns a PlacementSession (EventTarget-style).
     * Only one interactive session may be 'placing' at a time; if one exists
     * it will be returned instead of creating a new one.
     */
    startPlacement(
      lowResSrc: string,
      highResSrc: string,
      options?: PlacementOptions,
      initialMouse?: { clientX: number; clientY: number }
    ): PlacementSession {
      // Enforce single interactive session
      if (
        this._activePlacementSession &&
        this._activePlacementSession.state === 'placing'
      ) {
        return this._activePlacementSession;
      }

      const session = new PlacementSession(
        this,
        lowResSrc,
        highResSrc,
        options || {}
      );
      this._activePlacementSession = session;

      // When session transitions out of placing (commit/cancel), clear active session
      const clearActive = () => {
        if (this._activePlacementSession === session)
          this._activePlacementSession = null;
      };

      session.addEventListener('loading-start', clearActive, { once: true });
      session.addEventListener('cancel', clearActive, { once: true });
      session.addEventListener('error', clearActive, { once: true });

      // Kick off loading of placeholder low-res GLB asynchronously
      session._loadPlaceholder();

      // If an initial mouse position was provided, ensure the placeholder
      // will be positioned there immediately once it loads. If the
      // placeholder is already loaded, updatePosition will handle it.
      if (initialMouse) {
        const oncePosition = () => {
          try {
            session.updatePosition(initialMouse.clientX, initialMouse.clientY);
          } catch (e) {}
        };
        session.addEventListener('placeholder-loaded', oncePosition, {
          once: true,
        });
        // Also attempt an immediate update in case the placeholder is
        // already available synchronously.
        try {
          session.updatePosition(initialMouse.clientX, initialMouse.clientY);
        } catch (e) {}
      }

      // Wire default pointer capture (window-level) so consumers don't need to
      // manage global listeners. Pointer moves update the placeholder; pointer
      // up commits the placement. ESC cancels.
      const onPointerMove = (e: PointerEvent) => {
        try {
          if (session.state === 'placing') {
            session.updatePosition(e.clientX, e.clientY);
          }
        } catch (err) {
          // swallow
        }
      };

      const onPointerUp = () => {
        try {
          if (session.state === 'placing') {
            // Commit using any preconfigured finalSrc
            session.commit().catch(() => {});
          }
        } catch (err) {
          // swallow
        }
      };

      const onPointerCancel = () => {
        try {
          if (session.state === 'placing') session.cancel();
        } catch (err) {}
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' || e.key === 'Esc') {
          if (session.state === 'placing') session.cancel();
        }
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
      window.addEventListener('keydown', onKeyDown);

      const removeDomListeners = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        window.removeEventListener('keydown', onKeyDown);
      };

      // Clean up listeners when session ends or errors.
      session.addEventListener('loading-start', () => removeDomListeners(), {
        once: true,
      });
      session.addEventListener('cancel', () => removeDomListeners(), {
        once: true,
      });
      session.addEventListener('error', () => removeDomListeners(), {
        once: true,
      });

      return session;
    }
  }

  return LDPuzzlerModelViewerElement;
};

/**
 * PlacementSession represents an interactive placement instance. It's an
 * EventTarget and emits events: 'start','update','loading-start','loaded','error','cancel'.
 */
class PlacementSession extends EventTarget {
  id: string;
  state: 'placing' | 'loading' | 'ended' | 'cancelled' = 'placing';
  placeholder: Object3D | null = null;
  private _element: InstanceType<ReturnType<typeof LDPuzzlerMixin>> | null;
  private _lowResSrc: string;
  private _highResSrc?: string;
  private _options?: PlacementOptions;

  constructor(
    element: any,
    lowResSrc: string,
    highResSrc?: string,
    options?: PlacementOptions
  ) {
    super();
    this.id = String(Date.now()) + '_' + Math.floor(Math.random() * 10000);
    this._element = element;
    this._lowResSrc = lowResSrc;
    this._highResSrc = highResSrc;
    this._options = options;
    this.dispatchEvent(
      new CustomEvent('start', { detail: { sessionId: this.id } })
    );
  }

  // Internal: load low-res placeholder and insert into scene
  async _loadPlaceholder() {
    if (!this._element) return;
    const scene = (this._element as any)[$scene];
    if (!scene) return;

    try {
      const loader = (this._element as any)[$renderer].loader;
      const gltf = await loader.load(
        this._lowResSrc,
        this._element,
        (p: number) => {
          // Progress for placeholder load (0..1)
          try {
            this.dispatchEvent(
              new CustomEvent('progress', {
                detail: {
                  sessionId: this.id,
                  phase: 'placeholder',
                  progress: p,
                },
              })
            );
          } catch (e) {}
        }
      );

      if (!gltf || !gltf.scene) return;

      // Use the low-res model as the interactive placeholder
      const placeholder = gltf.scene;
      if (!placeholder) return;

      this.placeholder = placeholder;
      placeholder.name =
        this._options?.name || `placement_placeholder_${this.id}`;
      placeholder.userData = placeholder.userData || {};
      placeholder.userData.isPlacementPlaceholder = true;
      if (this._options?.selectable === false)
        placeholder.userData.selectable = false;

      // Insert into scene target
      try {
        scene.target.add(placeholder);
      } catch (e) {
        scene.add(placeholder);
      }
      // Keep the placeholder hidden until we receive the first pointer
      // update so it doesn't appear at the scene origin if the GLB loads
      // very quickly.
      try {
        placeholder.visible = false;
      } catch (e) {
        // ignore if property not present
      }

      this.dispatchEvent(
        new CustomEvent('placeholder-loaded', {
          detail: { sessionId: this.id, placeholder },
        })
      );
      // Request render
      (this._element as any)[$needsRender]();
    } catch (error) {
      this.dispatchEvent(
        new CustomEvent('error', { detail: { sessionId: this.id, error } })
      );
      this.cancel();
    }
  }

  // Update placeholder position. Accepts client coordinates and converts
  // them to a world point using the LDCursor mixin's helper.
  updatePosition(clientX: number, clientY: number) {
    if (!this.placeholder || !this._element) return;

    try {
      const world = (this._element as any)[$getMouseWorldPoint](
        clientX,
        clientY
      ) as Vector3 | null;
      if (!world) {
        // pointer outside or no valid ray intersection
        this.dispatchEvent(
          new CustomEvent('update', {
            detail: { sessionId: this.id, worldPoint: null },
          })
        );
        return;
      }

      // Make the placeholder visible on the first pointer update so it
      // doesn't flash at the origin when the low-res asset loaded before
      // the user moved the mouse.
      if (this.placeholder.visible === false) {
        try {
          this.placeholder.visible = true;
        } catch (e) {
          // ignore
        }
      }

      this.placeholder.position.set(world.x, world.y, world.z);
      this.dispatchEvent(
        new CustomEvent('update', {
          detail: {
            sessionId: this.id,
            worldPoint: { x: world.x, y: world.y, z: world.z },
          },
        })
      );
      (this._element as any)[$needsRender]();
    } catch (error) {
      // If helper is not present or fails, emit error and no-op
      this.dispatchEvent(
        new CustomEvent('error', { detail: { sessionId: this.id, error } })
      );
    }
  }

  // Commit placement: start loading the final high-res GLB. Session is
  // considered ended for interactive purposes immediately; returned Promise
  // resolves/rejects when final model load completes.
  async commit(finalSrc?: string) {
    if (this.state !== 'placing') {
      return Promise.reject(new Error('Session not placing'));
    }

    this.state = 'loading';

    // Compute a reasonable center point for the placeholder so callers
    // can position UI (hotspots) at the geometric center of the object
    // rather than at the floor or origin.
    let centerDetail: { x: number; y: number; z: number } | null = null;
    try {
      if (this.placeholder) {
        // Ensure world matrices are up to date
        this.placeholder.updateMatrixWorld(true);
        const box = new Box3().setFromObject(this.placeholder);
        const center = new Vector3();
        box.getCenter(center);
        centerDetail = { x: center.x, y: center.y, z: center.z };
      }
    } catch (e) {
      centerDetail = null;
    }

    this.dispatchEvent(
      new CustomEvent('loading-start', {
        detail: {
          sessionId: this.id,
          src: finalSrc || this._highResSrc,
          center: centerDetail,
        },
      })
    );

    const srcToLoad = finalSrc || this._highResSrc;
    if (!srcToLoad) {
      const err = new Error('No finalSrc provided to commit');
      this.dispatchEvent(
        new CustomEvent('error', { detail: { sessionId: this.id, error: err } })
      );
      this._cleanupPlaceholder();
      return Promise.reject(err);
    }

    // Allow new interactive sessions now; capture element ref so we can
    // continue the final load in the background and still clean up the
    // placeholder even after we drop the interactive reference.
    const element = this._element;
    this._endInteractive();

    if (!element) return Promise.reject(new Error('No element'));

    const loader = (element as any)[$renderer].loader;
    const scene = (element as any)[$scene];

    try {
      const gltf = await loader.load(srcToLoad, element, (p: number) => {
        // Progress for final load (0..1)
        try {
          this.dispatchEvent(
            new CustomEvent('progress', {
              detail: { sessionId: this.id, phase: 'final', progress: p },
            })
          );
        } catch (e) {}
      });

      if (!gltf || !gltf.scene) {
        throw new Error('Loaded GLTF missing scene');
      }

      // Place final model at placeholder transform (if present)
      if (this.placeholder) {
        gltf.scene.position.copy(this.placeholder.position);
        gltf.scene.quaternion.copy(this.placeholder.quaternion);
        gltf.scene.scale.copy(this.placeholder.scale);
      }

      // Mark as placed so selection logic recognizes it
      gltf.scene.name = this._options?.name || `placed_${this.id}`;
      gltf.scene.userData = gltf.scene.userData || {};
      gltf.scene.userData.isPlacedObject = true;
      if (this._options?.selectable === false)
        gltf.scene.userData.selectable = false;

      try {
        scene.target.add(gltf.scene);
      } catch (e) {
        scene.add(gltf.scene);
      }

      // Clean up placeholder (we can still remove it even though the
      // interactive session has been ended)
      this._cleanupPlaceholder();

      // Request a render so the newly added final model is visible
      // immediately (camera movement shouldn't be required).
      try {
        (element as any)[$needsRender]();
      } catch (e) {
        // ignore
      }

      this.state = 'ended';
      const detail = { sessionId: this.id, placedNode: gltf.scene };
      this.dispatchEvent(new CustomEvent('loaded', { detail }));
      return { id: this.id, node: gltf.scene };
    } catch (error) {
      // On failure, remove placeholder and emit error
      this._cleanupPlaceholder();
      this.state = 'cancelled';
      this.dispatchEvent(
        new CustomEvent('error', { detail: { sessionId: this.id, error } })
      );
      try {
        (element as any)[$needsRender]();
      } catch (e) {}
      return Promise.reject(error);
    }
  }

  cancel() {
    this._cleanupPlaceholder();
    this.state = 'cancelled';
    this.dispatchEvent(
      new CustomEvent('cancel', { detail: { sessionId: this.id } })
    );
    this._endInteractive();
  }

  private _cleanupPlaceholder() {
    if (!this.placeholder) return;
    try {
      if (this.placeholder.parent)
        this.placeholder.parent.remove(this.placeholder);
      this.placeholder.traverse((child: any) => {
        if (child.dispose)
          try {
            child.dispose();
          } catch (_) {}
      });
    } catch (e) {
      // ignore
    }
    this.placeholder = null;
    // If the interactive element is still around, request a render.
    if (this._element) (this._element as any)[$needsRender]();
  }

  private _endInteractive() {
    // Drop reference to element so caller may start another interactive session
    this._element = null;
  }
}
