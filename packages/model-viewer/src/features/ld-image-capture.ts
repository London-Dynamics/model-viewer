/**
 * LD Image Capture Mixin
 *
 * Adds captureImage() to capture the current view as a data URL. When width and
 * height are set, a second (offscreen) canvas is sized to those dimensions and
 * the scene is rendered to it once; the main canvas is never altered. Optional
 * camera applies only to the capture; crop is supported when not using
 * width/height.
 */

import {
  Color,
  OrthographicCamera,
  PerspectiveCamera,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

import ModelViewerElementBase, {
  $renderer,
  $scene,
} from '../model-viewer-base.js';
import { Constructor } from '../utilities.js';

/**
 * Crop region in source canvas pixels. All values in pixels from the
 * display canvas. Only used when width/height are not set.
 */
export interface CaptureImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Options for captureImage(). All parameters are optional.
 */
export interface CaptureImageOptions {
  /**
   * Output width in pixels. When used with height, a second canvas is sized to
   * width×height and the scene is rendered to it (main canvas unchanged).
   * No cropping or scaling of the result.
   */
  width?: number;
  /**
   * Output height in pixels. When used with width, capture is at exactly
   * width×height from an offscreen render.
   */
  height?: number;
  /** MIME type for the image (e.g. 'image/png', 'image/jpeg'). Defaults to 'image/png'. */
  fileType?: string;
  /** Quality for lossy formats (0–1). Used as encoderOptions for toDataURL. */
  encoderOptions?: number;
  /**
   * Camera state object compatible with setCameraFromJSON. Applied only for the
   * capture; the visible canvas is not updated.
   */
  camera?: object;
  /** Crop region in source canvas pixels. Ignored when width and height are set. */
  crop?: CaptureImageCrop;
  /**
   * Background color for the capture. Used when the scene has transparency (e.g.
   * JPEG does not support alpha). Any CSS color string or hex number accepted by
   * Three.js Color. Defaults to 'white'.
   */
  backgroundColor?: string | number;
}

export declare interface LDImageCaptureInterface {
  /**
   * Captures the current view as a data URL. When width/height are set, renders
   * to an offscreen canvas at that size without altering the main canvas.
   * Optional camera is used only for this capture.
   */
  captureImage(options?: CaptureImageOptions): Promise<string>;
}

/** 2D canvas used when capturing from the display canvas (crop or no dimensions). */
const captureCanvas2D = document.createElement('canvas');

/** Reusable buffer for readRenderTargetPixels (avoids allocations). */
let capturePixelBuffer: Uint8Array | null = null;

function ensurePixelBuffer(size: number): Uint8Array {
  if (capturePixelBuffer == null || capturePixelBuffer.length < size) {
    capturePixelBuffer = new Uint8Array(size);
  }
  return capturePixelBuffer;
}

/**
 * Read WebGL render target into a 2D canvas and return data URL. WebGL origin
 * is bottom-left; we flip to top-left for ImageData.
 */
function renderTargetToDataURL(
  renderer: WebGLRenderer,
  renderTarget: WebGLRenderTarget,
  width: number,
  height: number,
  fileType: string,
  encoderOptions?: number
): string {
  const size = width * height * 4;
  const pixels = ensurePixelBuffer(size);
  renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels);

  const flipped = new Uint8ClampedArray(size);
  const rowBytes = width * 4;
  for (let y = height - 1; y >= 0; y--) {
    const srcRow = y * rowBytes;
    const dstRow = (height - 1 - y) * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      flipped[dstRow + i] = pixels[srcRow + i];
    }
  }

  captureCanvas2D.width = width;
  captureCanvas2D.height = height;
  const ctx = captureCanvas2D.getContext('2d');
  if (!ctx) {
    return 'data:image/png;base64,';
  }
  const imageData = new ImageData(flipped, width, height);
  ctx.putImageData(imageData, 0, 0);
  return captureCanvas2D.toDataURL(fileType, encoderOptions);
}

export const LDImageCaptureMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDImageCaptureInterface> & T => {
  class LDImageCaptureModelViewerElement extends ModelViewerElement {
    async captureImage(options: CaptureImageOptions = {}): Promise<string> {
      const {
        width: outWidth,
        height: outHeight,
        fileType = 'image/png',
        encoderOptions,
        camera,
        crop,
        backgroundColor = 'white',
      } = options;

      const bgColor = new Color(backgroundColor);

      const element = this as any;
      const scene = this[$scene];
      const renderer = this[$renderer];
      const threeRenderer = renderer.threeRenderer;

      const useOffscreenRender =
        outWidth != null &&
        outWidth > 0 &&
        outHeight != null &&
        outHeight > 0;

      let savedCameraJSON: any = null;
      if (camera != null && typeof element.setCameraFromJSON === 'function') {
        savedCameraJSON = element.getCameraJSON?.() ?? null;
        await element.setCameraFromJSON(camera);
      }

      try {
        if (useOffscreenRender) {
          const captureWidth = Math.floor(outWidth);
          const captureHeight = Math.floor(outHeight);

          const sceneCamera = scene.camera;
          let prevAspect = scene.aspect;
          let prevLeft: number | undefined;
          let prevRight: number | undefined;
          let prevTop: number | undefined;
          let prevBottom: number | undefined;

          if (sceneCamera instanceof PerspectiveCamera) {
            prevAspect = sceneCamera.aspect;
            sceneCamera.aspect = captureWidth / captureHeight;
            sceneCamera.updateProjectionMatrix();
          } else if (sceneCamera instanceof OrthographicCamera) {
            prevLeft = sceneCamera.left;
            prevRight = sceneCamera.right;
            prevTop = sceneCamera.top;
            prevBottom = sceneCamera.bottom;
            const halfW = captureWidth / 2;
            const halfH = captureHeight / 2;
            sceneCamera.left = -halfW;
            sceneCamera.right = halfW;
            sceneCamera.top = halfH;
            sceneCamera.bottom = -halfH;
            sceneCamera.updateProjectionMatrix();
          }

          const renderTarget = new WebGLRenderTarget(captureWidth, captureHeight);

          const prevRenderTarget = threeRenderer.getRenderTarget();
          const prevViewport = threeRenderer.getViewport(new Vector4());
          const prevClearColor = new Color();
          const prevClearAlpha = threeRenderer.getClearAlpha();
          threeRenderer.getClearColor(prevClearColor);

          try {
            threeRenderer.setRenderTarget(renderTarget);
            threeRenderer.setViewport(0, 0, captureWidth, captureHeight);
            threeRenderer.setClearColor(bgColor, 1);
            scene.renderShadow(threeRenderer);
            threeRenderer.setRenderTarget(renderTarget);
            if (scene.effectRenderer != null) {
              scene.effectRenderer.render(0);
            } else {
              threeRenderer.render(scene, scene.camera);
            }

            const dataUrl = renderTargetToDataURL(
              threeRenderer,
              renderTarget,
              captureWidth,
              captureHeight,
              fileType,
              encoderOptions
            );
            return dataUrl;
          } finally {
            threeRenderer.setRenderTarget(prevRenderTarget);
            threeRenderer.setViewport(prevViewport);
            threeRenderer.setClearColor(prevClearColor, prevClearAlpha);
            renderTarget.dispose();

            if (sceneCamera instanceof PerspectiveCamera) {
              sceneCamera.aspect = prevAspect;
              sceneCamera.updateProjectionMatrix();
            } else if (sceneCamera instanceof OrthographicCamera && prevLeft != null) {
              sceneCamera.left = prevLeft;
              sceneCamera.right = prevRight!;
              sceneCamera.top = prevTop!;
              sceneCamera.bottom = prevBottom!;
              sceneCamera.updateProjectionMatrix();
            }
          }
        }

        const sourceCanvas = renderer.displayCanvas(scene);
        const srcWidth = sourceCanvas.width;
        const srcHeight = sourceCanvas.height;

        let sx = 0;
        let sy = 0;
        let sw = srcWidth;
        let sh = srcHeight;

        if (crop != null) {
          sx = Math.max(0, Math.floor(crop.x));
          sy = Math.max(0, Math.floor(crop.y));
          sw = Math.max(1, Math.floor(crop.width));
          sh = Math.max(1, Math.floor(crop.height));
          sw = Math.min(sw, srcWidth - sx);
          sh = Math.min(sh, srcHeight - sy);
        }

        captureCanvas2D.width = sw;
        captureCanvas2D.height = sh;
        const ctx = captureCanvas2D.getContext('2d');
        if (!ctx) {
          return this.toDataURL(fileType, encoderOptions);
        }
        ctx.fillStyle = bgColor.getStyle();
        ctx.fillRect(0, 0, sw, sh);
        ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
        return captureCanvas2D.toDataURL(fileType, encoderOptions);
      } finally {
        if (savedCameraJSON != null && typeof element.setCameraFromJSON === 'function') {
          const data = savedCameraJSON.object ?? savedCameraJSON;
          element.setCameraFromJSON(data);
        }
      }
    }
  }

  return LDImageCaptureModelViewerElement as Constructor<LDImageCaptureInterface> & T;
};
