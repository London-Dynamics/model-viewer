/* @license
 * Helper utilities to integrate three-viewport-gizmo with model-viewer
 * without touching the shared three-components/Renderer.
 */

import * as THREE from 'three';

import ModelViewerElementBase, {
  $needsRender,
} from '../../model-viewer-base.js';
import { ViewportGizmo } from 'three-viewport-gizmo';

export interface ViewportGizmoHandle {
  gizmo: ViewportGizmo;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;

  dispose(): void;
  updateOnResize(width: number, height: number): void;
  render(): void;
  updateCamera(
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  ): void;
}

type ControlsLike = {
  enabled?: boolean;
  addEventListener?: (type: string, listener: (...args: any[]) => void) => void;
  removeEventListener?: (
    type: string,
    listener: (...args: any[]) => void
  ) => void;
  setLookAt?: (
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    targetX: number,
    targetY: number,
    targetZ: number,
    enableTransition?: boolean
  ) => any;
  getTarget?: (target: THREE.Vector3) => THREE.Vector3;
};

interface EnsureOptions {
  host: ModelViewerElementBase;
  scene: any;
  container: HTMLElement;
  controls: any;
  show: boolean;
  existing?: ViewportGizmoHandle | null;
}

/**
 * Create or update a ViewportGizmo for a given <model-viewer> instance.
 *
 * - Uses its own transparent WebGLRenderer and canvas overlayed on top of
 *   the main canvas, so we don't have to modify three-components/Renderer.
 * - Wires the gizmo to CameraControls (via the ThirdPartyControlsAdapter)
 *   so that:
 *   - while gizmo is animating, CameraControls are disabled
 *   - when the gizmo changes the camera, CameraControls are re-synced
 *     to the new camera position/target
 */
export function ensureViewportGizmo(
  options: EnsureOptions
): ViewportGizmoHandle | null {
  const { scene, container, controls, show, existing, host } = options;

  // If the gizmo should be hidden, dispose any existing instance.
  if (!show) {
    if (existing) {
      existing.dispose();
    }
    return null;
  }

  // If we already have a gizmo, just make sure it's pointing at the current camera.
  if (existing) {
    existing.updateCamera(scene.camera);
    return existing;
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(scene.width, scene.height);

  const canvas = renderer.domElement;
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  // Pointer events are handled by ViewportGizmo's own DOM element,
  // so let events pass through this canvas to the underlying
  // model-viewer controls.
  canvas.style.pointerEvents = 'none';
  // Ensure gizmo renders above the main canvas
  canvas.style.zIndex = '1';

  container.appendChild(canvas);

  const camera = scene.camera as
    | THREE.PerspectiveCamera
    | THREE.OrthographicCamera;

  const gizmo = new ViewportGizmo(camera, renderer, {
    type: 'cube',
    size: 96,
    background: {
      color: 0xf5f5f4,
    },
    corners: {
      hover: {
        color: 0x6495ed,
      },
    },
    edges: {
      enabled: true,
      hover: {
        color: 0x6495ed,
      },
    },
    x: {
      labelColor: 0x44403c,
      hover: {
        color: 0x6495ed,
        labelColor: 0xffffff,
      },
      label: 'RIGHT',
    },
    y: {
      labelColor: 0x44403c,
      hover: {
        color: 0x6495ed,
        labelColor: 0xffffff,
      },
      label: 'TOP',
    },
    z: {
      labelColor: 0x44403c,
      hover: {
        color: 0x6495ed,
        labelColor: 0xffffff,
      },
      label: 'FRONT',
    },
    nx: {
      labelColor: 0x44403c,
      hover: {
        color: 0x6495ed,
        labelColor: 0xffffff,
      },
      label: 'LEFT',
    },
    ny: {
      labelColor: 0x44403c,
      hover: {
        color: 0x6495ed,
        labelColor: 0xffffff,
      },
      label: 'BOTTOM',
    },
    nz: {
      labelColor: 0x44403c,
      hover: {
        color: 0x6495ed,
        labelColor: 0xffffff,
      },
      label: 'BACK',
    },
  });

  // Try to get at the underlying CameraControls instance if present.
  const cameraControls: ControlsLike | undefined =
    controls && (controls.thirdPartyControls || controls);

  const onGizmoStart = () => {
    if (
      cameraControls &&
      Object.prototype.hasOwnProperty.call(cameraControls, 'enabled')
    ) {
      cameraControls.enabled = false;
    }
  };

  const onGizmoEnd = () => {
    if (
      cameraControls &&
      Object.prototype.hasOwnProperty.call(cameraControls, 'enabled')
    ) {
      cameraControls.enabled = true;
    }
  };

  const onGizmoChange = () => {
    // Keep CameraControls' internal state in sync with the camera that
    // the gizmo is animating, so it doesn't snap back on the next update.
    if (cameraControls && typeof cameraControls.setLookAt === 'function') {
      const cam = scene.camera as
        | THREE.PerspectiveCamera
        | THREE.OrthographicCamera;
      const target = gizmo.target;

      cameraControls.setLookAt(
        cam.position.x,
        cam.position.y,
        cam.position.z,
        target.x,
        target.y,
        target.z,
        false
      );
    }

    (host as any)[$needsRender]();
  };

  gizmo.addEventListener('start', onGizmoStart);
  gizmo.addEventListener('end', onGizmoEnd);
  gizmo.addEventListener('change', onGizmoChange);

  const handle: ViewportGizmoHandle = {
    gizmo,
    renderer,
    canvas,
    dispose() {
      gizmo.removeEventListener('start', onGizmoStart);
      gizmo.removeEventListener('end', onGizmoEnd);
      gizmo.removeEventListener('change', onGizmoChange);
      renderer.dispose();
      if (canvas.parentElement) {
        canvas.parentElement.removeChild(canvas);
      }
    },
    updateOnResize(width: number, height: number) {
      renderer.setSize(width, height);
      gizmo.update();
    },
    render() {
      gizmo.render();
    },
    updateCamera(
      newCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera
    ) {
      gizmo.camera = newCamera;
      gizmo.cameraUpdate();
    },
  };

  // Initial orientation sync.
  gizmo.cameraUpdate();

  return handle;
}
