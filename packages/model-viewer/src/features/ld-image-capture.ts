/**
 * LD Image Capture Mixin
 *
 * Adds captureImage() to capture the current view as a data URL. When width and
 * height are set (or a camera option is provided), an offscreen WebGL render
 * target is used and the scene is rendered directly into it — never via
 * effectRenderer, which presents to the screen and would flash the visible
 * canvas / leave the capture RT blank. Optional camera applies only to the
 * capture; crop is supported when not using width/height.
 */

import {
  Color,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

import ModelViewerElementBase, {
  $renderer,
  $scene,
} from '../model-viewer-base.js';
import { $controls } from './controls.js';
import { Constructor } from '../utilities.js';

/** High-level fit mode for cropping, similar to CSS object-fit. */
export type CaptureImageFit = 'cover' | 'contain' | 'fill';

/** Normalized focal point used when cropping (0–1 in each dimension). */
export interface CaptureImageFocalPoint {
  x: number;
  y: number;
}

/**
 * Crop options for captureImage().
 *
 * - Legacy usage: provide pixel-based rect (x, y, width, height) in source
 *   canvas pixels. This behaves like the original API when frame is not set.
 * - High-level usage (recommended): provide fit / focalPoint together with
 *   frame/width/height so captureImage computes the crop and scaling for you.
 */
export interface CaptureImageCrop {
  /** Optional pixel-based crop rect in source canvas pixels. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /**
   * Fit mode when using frame-based cropping. 'cover' (default) fills the
   * frame and crops overflow, 'contain' fits the whole image inside the frame
   * (can leave empty space), and 'fill' stretches the image to the frame.
   */
  fit?: CaptureImageFit;
  /**
   * Normalized focal point (0–1) used when cropping with fit='cover' to keep
   * a subject in view (e.g. { x: 0.5, y: 0.3 } is slightly toward the top).
   */
  focalPoint?: CaptureImageFocalPoint;
  /**
   * Normalized safe area (0–1) controlling how large the crop region should be
   * relative to the frame when using frame-based cropping. 1.0 means the crop
   * region exactly matches the frame (default behavior); lower values shrink
   * the crop around the focal point so the subject appears larger.
   */
  safeArea?: number;
}

/**
 * Options for captureImage(). All parameters are optional.
 */
export interface CaptureImageOptions {
  /**
   * Output width in pixels.
   *
   * - When frame is not set: together with height, this sizes an offscreen
   *   render target to width×height (main canvas unchanged), matching the
   *   original behavior (no additional cropping/scaling of the result).
   * - When frame is set: width is treated as the maximum width (bounding box)
   *   for the final image; the actual output will be the largest size that
   *   matches the frame aspect and fits within width×height.
   */
  width?: number;
  /**
   * Output height in pixels.
   *
   * - When frame is not set: together with width, capture is at exactly
   *   width×height from an offscreen render.
   * - When frame is set: height is treated as the maximum height (bounding
   *   box) for the final image (see width).
   */
  height?: number;
  /**
   * Final frame aspect ratio for the output image, expressed as \"w:h\"
   * (e.g. \"1:1\", \"16:9\", \"9:16\"). When provided, the image will be
   * cropped and/or scaled so that the output matches this aspect ratio while
   * fitting inside width×height.
   */
  frame?: string;
  /** MIME type for the image (e.g. 'image/png', 'image/jpeg'). Defaults to 'image/png'. */
  fileType?: string;
  /** Quality for lossy formats (0–1). Used as encoderOptions for toDataURL. */
  encoderOptions?: number;
  /**
   * Camera state object compatible with setCameraFromJSON. Applied only for the
   * capture; the visible canvas is not updated.
   */
  camera?: object;
  /**
   * Crop options. When frame is not set and a pixel rect is provided
   * (x/y/width/height), behaves like the original API using source canvas
   * pixels. When frame is set, prefer using fit / focalPoint and let the
   * API compute the crop region for you.
   */
  crop?: CaptureImageCrop;
  /**
   * When true and capturing to an offscreen render target (width/height), ask
   * the camera controls to fit the view to the scene's bounding box via
   * <code>fitToBox</code> for the capture so the model fills the frame for the
   * requested aspect ratio. Ignored when <code>camera</code> is set so saved
   * poses are captured exactly. The visible camera is restored afterward.
   */
  fitToBox?: boolean;
  /**
   * Background color for the capture. Used when the scene has transparency (e.g.
   * JPEG does not support alpha). Any CSS color string or hex number accepted by
   * Three.js Color. Defaults to 'white'.
   */
  backgroundColor?: string | number;
}

/** Default size for captureThumbnails() when width/height are omitted. */
const DEFAULT_THUMBNAIL_SIZE = 150;

export declare interface LDImageCaptureInterface {
  /**
   * Captures the current view as a data URL. When width/height are set, renders
   * to an offscreen canvas at that size without altering the main canvas.
   * Optional camera is used only for this capture. Concurrent calls are
   * serialized (shared capture buffers).
   */
  captureImage(options?: CaptureImageOptions): Promise<string>;
  /**
   * Captures one data URL per camera pose for ephemeral UI thumbnails
   * (e.g. saved views). Runs sequentially; defaults to 150×150 JPEG.
   * Results are not intended for persistence.
   */
  captureThumbnails(
    cameras: Array<object>,
    options?: Omit<CaptureImageOptions, 'camera'>
  ): Promise<string[]>;
}

/** 2D canvas used when capturing from the display canvas (crop or no dimensions). */
const captureCanvas2D = document.createElement('canvas');

/** Scratch canvas for RT readback before compositing over backgroundColor. */
const captureScratch2D = document.createElement('canvas');

/** Reusable buffer for readRenderTargetPixels (avoids allocations). */
let capturePixelBuffer: Uint8Array | null = null;

/**
 * Global capture queue so overlapping captureImage / captureThumbnails calls
 * do not share captureCanvas2D / capturePixelBuffer concurrently.
 */
let captureQueue: Promise<unknown> = Promise.resolve();

function enqueueCapture<T>(task: () => Promise<T>): Promise<T> {
  const next = captureQueue.then(task, task);
  // Keep the chain alive even if a capture rejects.
  captureQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/**
 * When a temporary camera pose is provided and only one of width/height is
 * set, default the missing dimension to the other for a square thumbnail.
 */
function resolveCaptureDimensions(
  outWidth: number | undefined,
  outHeight: number | undefined,
  hasCamera: boolean,
  fallbackWidth: number,
  fallbackHeight: number
): {captureWidth: number; captureHeight: number} {
  let w =
    outWidth != null && outWidth > 0 ? Math.floor(outWidth) : undefined;
  let h =
    outHeight != null && outHeight > 0 ? Math.floor(outHeight) : undefined;

  if (hasCamera) {
    if (w != null && h == null) h = w;
    else if (h != null && w == null) w = h;
  }

  return {
    captureWidth: Math.max(1, w ?? fallbackWidth),
    captureHeight: Math.max(1, h ?? fallbackHeight),
  };
}

function ensurePixelBuffer(size: number): Uint8Array {
  if (capturePixelBuffer == null || capturePixelBuffer.length < size) {
    capturePixelBuffer = new Uint8Array(size);
  }
  return capturePixelBuffer;
}

/**
 * Read WebGL render target into a 2D canvas and return data URL. WebGL origin
 * is bottom-left; we flip to top-left for ImageData. Composites over
 * backgroundColor (like the display-canvas path) so transparent readback
 * cannot yield black JPEG / invisible PNG.
 */
function renderTargetToDataURL(
  renderer: WebGLRenderer,
  renderTarget: WebGLRenderTarget,
  width: number,
  height: number,
  bgColor: Color,
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

  captureScratch2D.width = width;
  captureScratch2D.height = height;
  const scratchCtx = captureScratch2D.getContext('2d');
  if (!scratchCtx) {
    return 'data:image/png;base64,';
  }
  scratchCtx.putImageData(new ImageData(flipped, width, height), 0, 0);

  captureCanvas2D.width = width;
  captureCanvas2D.height = height;
  const ctx = captureCanvas2D.getContext('2d');
  if (!ctx) {
    return 'data:image/png;base64,';
  }
  ctx.fillStyle = bgColor.getStyle();
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(captureScratch2D, 0, 0);
  return captureCanvas2D.toDataURL(fileType, encoderOptions);
}

/**
 * Adjust perspective/ortho frustum for a capture aspect while preserving the
 * current world framing (ortho: expand the narrower axis).
 */
function applyCaptureProjection(
  sceneCamera: PerspectiveCamera | OrthographicCamera,
  captureWidth: number,
  captureHeight: number,
  prev: {
    aspect: number;
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
  }
): void {
  if (sceneCamera instanceof PerspectiveCamera) {
    sceneCamera.aspect = captureWidth / captureHeight;
    sceneCamera.updateProjectionMatrix();
    return;
  }

  const prevLeft = prev.left!;
  const prevRight = prev.right!;
  const prevTop = prev.top!;
  const prevBottom = prev.bottom!;
  const captureAspect = captureWidth / captureHeight;
  const currentAspect = (prevRight - prevLeft) / (prevTop - prevBottom);
  if (Math.abs(currentAspect - captureAspect) > 1e-6) {
    const cx = (prevLeft + prevRight) / 2;
    const cy = (prevTop + prevBottom) / 2;
    const w = prevRight - prevLeft;
    const h = prevTop - prevBottom;
    if (captureAspect > currentAspect) {
      const newW = h * captureAspect;
      sceneCamera.left = cx - newW / 2;
      sceneCamera.right = cx + newW / 2;
    } else {
      const newH = w / captureAspect;
      sceneCamera.top = cy + newH / 2;
      sceneCamera.bottom = cy - newH / 2;
    }
  }
  sceneCamera.updateProjectionMatrix();
}

function parseFrameAspect(frame?: string): number | null {
  if (!frame) return null;
  const parts = frame.split(':');
  if (parts.length !== 2) return null;
  const w = parseFloat(parts[0]);
  const h = parseFloat(parts[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return null;
  }
  return w / h;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Frame-based crop and scale: given a source image and capture options with a
 * frame (w:h), compute the final output dimensions and crop using fit /
 * focalPoint, then draw to captureCanvas2D and return the data URL.
 */
function drawFramedImageToCanvas(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  options: CaptureImageOptions,
  bgColor: Color,
  fileType: string,
  encoderOptions?: number
): string {
  const aspect = parseFrameAspect(options.frame);
  if (aspect == null) {
    // Fallback: just return the full source at its native size.
    captureCanvas2D.width = srcWidth;
    captureCanvas2D.height = srcHeight;
    const ctx = captureCanvas2D.getContext('2d');
    if (!ctx) {
      return 'data:image/png;base64,';
    }
    ctx.fillStyle = bgColor.getStyle();
    ctx.fillRect(0, 0, srcWidth, srcHeight);
    ctx.drawImage(source, 0, 0, srcWidth, srcHeight, 0, 0, srcWidth, srcHeight);
    return captureCanvas2D.toDataURL(fileType, encoderOptions);
  }

  const maxW =
    options.width != null && options.width > 0
      ? Math.floor(options.width)
      : srcWidth;
  const maxH =
    options.height != null && options.height > 0
      ? Math.floor(options.height)
      : srcHeight;

  // Largest size with the requested aspect that fits within maxW×maxH.
  let outWidth = maxW;
  let outHeight = Math.round(outWidth / aspect);
  if (outHeight > maxH) {
    outHeight = maxH;
    outWidth = Math.round(outHeight * aspect);
  }
  outWidth = Math.max(1, outWidth);
  outHeight = Math.max(1, outHeight);

  captureCanvas2D.width = outWidth;
  captureCanvas2D.height = outHeight;
  const ctx = captureCanvas2D.getContext('2d');
  if (!ctx) {
    return 'data:image/png;base64,';
  }

  ctx.fillStyle = bgColor.getStyle();
  ctx.fillRect(0, 0, outWidth, outHeight);

  const crop = options.crop ?? {};
  const fit: CaptureImageFit = crop.fit ?? 'cover';
  const fp = crop.focalPoint ?? { x: 0.5, y: 0.5 };
  const fx = clamp01(fp.x);
  const fy = clamp01(fp.y);
  const safeAreaRaw =
    typeof crop.safeArea === 'number' && Number.isFinite(crop.safeArea)
      ? crop.safeArea
      : 1;
  const safeArea = Math.max(0.01, Math.min(1, safeAreaRaw));

  let sx = 0;
  let sy = 0;
  let sw = srcWidth;
  let sh = srcHeight;
  let dx = 0;
  let dy = 0;
  let dw = outWidth;
  let dh = outHeight;

  if (fit === 'fill') {
    // Use full source, stretched to frame.
    // (sx/sy/sw/sh and dx/dy/dw/dh already set appropriately.)
  } else if (fit === 'contain') {
    // Fit whole image inside frame, potentially letterboxing.
    const s = Math.min(outWidth / srcWidth, outHeight / srcHeight);
    dw = Math.round(srcWidth * s);
    dh = Math.round(srcHeight * s);
    dx = Math.round((outWidth - dw) / 2);
    dy = Math.round((outHeight - dh) / 2);
  } else {
    // cover (default): fill frame and crop overflow, honoring focalPoint.
    const s = Math.max(outWidth / srcWidth, outHeight / srcHeight);
    const baseWidth = outWidth / s;
    const baseHeight = outHeight / s;
    // Apply safeArea: shrink crop region around the focal point so the subject
    // appears larger in the final frame. 1.0 uses the base crop; lower values
    // use a smaller region.
    sw = baseWidth * safeArea;
    sh = baseHeight * safeArea;

    const centerX = fx * srcWidth;
    const centerY = fy * srcHeight;

    sx = centerX - sw / 2;
    sy = centerY - sh / 2;

    if (sx < 0) sx = 0;
    if (sy < 0) sy = 0;
    if (sx + sw > srcWidth) sx = srcWidth - sw;
    if (sy + sh > srcHeight) sy = srcHeight - sh;
  }

  ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
  return captureCanvas2D.toDataURL(fileType, encoderOptions);
}

/**
 * Apply a camera JSON object (setCameraFromJSON-style) directly to a Three.js
 * camera without touching the controls. Used so the capture uses the requested
 * view and the main canvas/controls are never updated.
 * Returns a debug string when debugCaptureCamera is true (for console logging).
 */
function applyCameraJSONToCamera(
  camera: any,
  data: any,
  debug = false
): string {
  if (!data || typeof data !== 'object') return '';
  if (Array.isArray(data.matrix) && data.matrix.length === 16) {
    const m = new Matrix4().fromArray(data.matrix);
    camera.matrixAutoUpdate = false;
    camera.matrix.copy(m);
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
  } else {
    if (Array.isArray(data.position) && data.position.length === 3) {
      camera.position.fromArray(data.position);
    }
    if (Array.isArray(data.quaternion) && data.quaternion.length === 4) {
      camera.quaternion.fromArray(data.quaternion);
    }
    camera.updateMatrix();
  }
  if (Array.isArray(data.up) && data.up.length === 3) {
    camera.up.fromArray(data.up);
  }
  if (typeof data.near === 'number' && Number.isFinite(data.near))
    camera.near = data.near;
  if (typeof data.far === 'number' && Number.isFinite(data.far))
    camera.far = data.far;
  if (typeof data.zoom === 'number' && Number.isFinite(data.zoom))
    camera.zoom = data.zoom;
  if (camera.isPerspectiveCamera) {
    if (typeof data.fov === 'number' && Number.isFinite(data.fov))
      camera.fov = data.fov;
    if (typeof data.aspect === 'number' && Number.isFinite(data.aspect))
      camera.aspect = data.aspect;
  }
  if (camera.isOrthographicCamera) {
    if (typeof data.left === 'number' && Number.isFinite(data.left))
      camera.left = data.left;
    if (typeof data.right === 'number' && Number.isFinite(data.right))
      camera.right = data.right;
    if (typeof data.top === 'number' && Number.isFinite(data.top))
      camera.top = data.top;
    if (typeof data.bottom === 'number' && Number.isFinite(data.bottom))
      camera.bottom = data.bottom;
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  if (!debug) return '';
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  return (
    `[captureImage camera] position=(${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)}) forward=(${forward.x.toFixed(2)},${forward.y.toFixed(2)},${forward.z.toFixed(2)}) near=${camera.near} far=${camera.far}` +
    (camera.isOrthographicCamera
      ? ` ortho L/R/T/B=(${camera.left.toFixed(1)},${camera.right.toFixed(1)},${camera.top.toFixed(1)},${camera.bottom.toFixed(1)})`
      : '')
  );
}

const $captureImageInternal = Symbol('captureImageInternal');

export const LDImageCaptureMixin = <
  T extends Constructor<ModelViewerElementBase>,
>(
  ModelViewerElement: T
): Constructor<LDImageCaptureInterface> & T => {
  class LDImageCaptureModelViewerElement extends ModelViewerElement {
    async captureImage(options: CaptureImageOptions = {}): Promise<string> {
      return enqueueCapture(() => this[$captureImageInternal](options));
    }

    async captureThumbnails(
      cameras: Array<object>,
      options: Omit<CaptureImageOptions, 'camera'> = {}
    ): Promise<string[]> {
      const shared: Omit<CaptureImageOptions, 'camera'> = {
        width: DEFAULT_THUMBNAIL_SIZE,
        height: DEFAULT_THUMBNAIL_SIZE,
        fileType: 'image/jpeg',
        ...options,
      };
      const results: string[] = [];
      for (const camera of cameras) {
        results.push(
          await this.captureImage({
            ...shared,
            camera,
          })
        );
      }
      return results;
    }

    async [$captureImageInternal](
      options: CaptureImageOptions = {}
    ): Promise<string> {
      let {
        width: outWidth,
        height: outHeight,
        fileType = 'image/png',
        encoderOptions,
        camera,
        crop,
        backgroundColor = 'white',
      } = options;

      // Pose-based capture with a single dimension → square output.
      if (camera != null) {
        if (
          outWidth != null &&
          outWidth > 0 &&
          (outHeight == null || outHeight <= 0)
        ) {
          outHeight = outWidth;
        } else if (
          outHeight != null &&
          outHeight > 0 &&
          (outWidth == null || outWidth <= 0)
        ) {
          outWidth = outHeight;
        }
      }

      const bgColor = new Color(backgroundColor);

      const element = this as any;
      const scene = this[$scene];
      const renderer = this[$renderer];
      const threeRenderer = renderer.threeRenderer;

      const useOffscreenRender =
        (outWidth != null &&
          outWidth > 0 &&
          outHeight != null &&
          outHeight > 0) ||
        camera != null;

      // Always snapshot the live view for offscreen captures so fitToBox /
      // temporary poses / aspect changes never leave the visible camera moved.
      let savedCameraJSON: any = null;
      if (
        useOffscreenRender &&
        typeof element.getCameraJSON === 'function'
      ) {
        savedCameraJSON = element.getCameraJSON();
      }

      try {
        if (useOffscreenRender) {
          if (camera != null) {
            const data: any = (camera as any)?.object ?? camera;
            const typeValue = data.type;
            let desiredType: 'perspective' | 'orthographic' | null = null;
            if (typeValue === 'OrthographicCamera')
              desiredType = 'orthographic';
            else if (typeValue === 'PerspectiveCamera')
              desiredType = 'perspective';
            if (
              desiredType != null &&
              typeof scene.getCameraType === 'function' &&
              scene.getCameraType() !== desiredType
            ) {
              element.setCameraType(desiredType);
            }
            const debugMsg = applyCameraJSONToCamera(scene.camera, data, true);
            if (debugMsg && typeof console !== 'undefined' && console.log) {
              console.log(debugMsg);
            }
          }

          const sourceCanvas = renderer.displayCanvas(scene);
          const {captureWidth, captureHeight} = resolveCaptureDimensions(
            outWidth,
            outHeight,
            camera != null,
            sourceCanvas.width,
            sourceCanvas.height
          );

          // fitToBox first (mutates live controls); aspect applied after so
          // projection matches the capture size. Visible camera is restored
          // from savedCameraJSON in the outer finally.
          if (options.fitToBox && camera == null) {
            const controls = (this as any)[$controls];
            if (controls && scene) {
              try {
                if (
                  typeof controls.fitToBox === 'function' &&
                  scene.boundingBox &&
                  !scene.boundingBox.isEmpty()
                ) {
                  await controls.fitToBox(scene.boundingBox, false, {
                    cover: true,
                  } as any);
                }
              } catch {
                // Ignore fitToBox errors and continue with the existing view.
              }
            }
          }

          const sceneCamera = scene.camera;
          let prevAspect = scene.aspect;
          let prevLeft: number | undefined;
          let prevRight: number | undefined;
          let prevTop: number | undefined;
          let prevBottom: number | undefined;

          if (sceneCamera instanceof PerspectiveCamera) {
            prevAspect = sceneCamera.aspect;
            applyCaptureProjection(sceneCamera, captureWidth, captureHeight, {
              aspect: prevAspect,
            });
          } else if (sceneCamera instanceof OrthographicCamera) {
            prevLeft = sceneCamera.left;
            prevRight = sceneCamera.right;
            prevTop = sceneCamera.top;
            prevBottom = sceneCamera.bottom;
            applyCaptureProjection(sceneCamera, captureWidth, captureHeight, {
              aspect: prevAspect,
              left: prevLeft,
              right: prevRight,
              top: prevTop,
              bottom: prevBottom,
            });
          }

          scene.updateMatrixWorld(true);
          scene.camera.updateMatrixWorld(true);

          const renderTarget = new WebGLRenderTarget(
            captureWidth,
            captureHeight,
            {
              type: UnsignedByteType,
              format: RGBAFormat,
              // sRGB so readback/toDataURL match CSS backgroundColor and
              // display-canvas captures (ColorManagement stores linear).
              colorSpace: SRGBColorSpace,
            }
          );

          const prevRenderTarget = threeRenderer.getRenderTarget();
          const prevViewport = threeRenderer.getViewport(new Vector4());
          const prevClearColor = new Color();
          const prevClearAlpha = threeRenderer.getClearAlpha();
          const prevAutoClear = threeRenderer.autoClear;
          const prevAutoClearColor = threeRenderer.autoClearColor;
          const prevAutoClearDepth = threeRenderer.autoClearDepth;
          const prevAutoClearStencil = threeRenderer.autoClearStencil;
          const prevToneMapping = threeRenderer.toneMapping;
          const prevScissorTest = threeRenderer.getScissorTest();
          threeRenderer.getClearColor(prevClearColor);

          try {
            threeRenderer.setScissorTest(false);
            threeRenderer.setRenderTarget(renderTarget);
            threeRenderer.setViewport(0, 0, captureWidth, captureHeight);
            threeRenderer.setClearColor(bgColor, 1);
            scene.renderShadow(threeRenderer);
            threeRenderer.setRenderTarget(renderTarget);
            // Always render the scene directly into the capture RT. Pipeline /
            // AO / bloom / outline composers implement EffectComposerInterface
            // with renderToScreen presentation, so calling effectRenderer.render
            // would flash the display canvas and leave the capture RT blank.
            threeRenderer.autoClear = true;
            threeRenderer.autoClearColor = true;
            threeRenderer.autoClearDepth = true;
            threeRenderer.autoClearStencil = true;
            threeRenderer.toneMapping = scene.toneMapping;
            threeRenderer.clear();
            threeRenderer.render(scene, scene.camera);

            const baseDataUrl = renderTargetToDataURL(
              threeRenderer,
              renderTarget,
              captureWidth,
              captureHeight,
              bgColor,
              fileType,
              encoderOptions
            );
            // If no frame is specified, return the raw offscreen capture (legacy behavior).
            if (!options.frame) {
              return baseDataUrl;
            }

            // Otherwise, apply frame-based crop/fit in 2D, similar to an image CDN pipeline.
            const img = await new Promise<HTMLImageElement>(
              (resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = (e) => reject(e);
                i.src = baseDataUrl;
              }
            );

            const framedUrl = drawFramedImageToCanvas(
              img,
              captureWidth,
              captureHeight,
              options,
              bgColor,
              fileType,
              encoderOptions
            );
            return framedUrl;
          } finally {
            threeRenderer.setRenderTarget(prevRenderTarget);
            threeRenderer.setViewport(prevViewport);
            threeRenderer.setClearColor(prevClearColor, prevClearAlpha);
            threeRenderer.autoClear = prevAutoClear;
            threeRenderer.autoClearColor = prevAutoClearColor;
            threeRenderer.autoClearDepth = prevAutoClearDepth;
            threeRenderer.autoClearStencil = prevAutoClearStencil;
            threeRenderer.toneMapping = prevToneMapping;
            threeRenderer.setScissorTest(prevScissorTest);
            renderTarget.dispose();

            if (sceneCamera instanceof PerspectiveCamera) {
              sceneCamera.aspect = prevAspect;
              sceneCamera.updateProjectionMatrix();
            } else if (
              sceneCamera instanceof OrthographicCamera &&
              prevLeft != null
            ) {
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

        // When a frame is specified, apply frame-based crop/fit in 2D.
        if (options.frame) {
          return drawFramedImageToCanvas(
            sourceCanvas,
            srcWidth,
            srcHeight,
            options,
            bgColor,
            fileType,
            encoderOptions
          );
        }

        // Legacy behavior: pixel-based crop rect in source canvas pixels only.
        let sx = 0;
        let sy = 0;
        let sw = srcWidth;
        let sh = srcHeight;

        if (crop != null) {
          sx = Math.max(0, Math.floor(crop.x ?? 0));
          sy = Math.max(0, Math.floor(crop.y ?? 0));
          sw = Math.max(1, Math.floor(crop.width ?? srcWidth - sx));
          sh = Math.max(1, Math.floor(crop.height ?? srcHeight - sy));
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
        if (
          savedCameraJSON != null &&
          typeof element.setCameraFromJSON === 'function'
        ) {
          const data = savedCameraJSON.object ?? savedCameraJSON;
          // fitToBox mutates CameraControls spherical/dolly state. Object
          // snapshots normally skip fromJSON inside setCameraFromJSON; rewind
          // explicitly so the live view cannot stay on the fit pose.
          const controls = (this as any)[$controls];
          const snapshot = data?.controlsSnapshot;
          if (
            snapshot != null &&
            controls &&
            typeof controls.fromJSON === 'function'
          ) {
            try {
              const json =
                typeof snapshot === 'string'
                  ? snapshot
                  : JSON.stringify(snapshot);
              controls.fromJSON(json, false);
              const cc = controls.thirdPartyControls;
              if (cc) {
                if (typeof cc.stop === 'function') cc.stop();
                if (typeof cc.update === 'function') {
                  for (let i = 0; i < 3; ++i) cc.update(0);
                }
                cc._needsUpdate = false;
              }
            } catch {
              // Fall through to setCameraFromJSON reconcile.
            }
          }
          await element.setCameraFromJSON(data);
        }
      }
    }
  }

  return LDImageCaptureModelViewerElement as Constructor<LDImageCaptureInterface> &
    T;
};
