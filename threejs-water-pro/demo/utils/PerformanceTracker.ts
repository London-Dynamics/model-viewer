import * as THREE from "three/webgpu";

export interface PerformanceParams {
  showMonitor: boolean;
  dynamicResolution: boolean;
  targetFps: number;
  minPixelRatio: number;
  maxPixelRatio: number;
}

export class PerformanceTracker {
  private frameTimeHistory: number[] = [];
  private lastDisplayUpdate = 0;
  private lastSnapshotCalls = 0;
  private snapshotDrawCalls = 0;

  // Lazily resolved — HUD may create these after tracker construction
  private _fps: HTMLElement | null = null;
  private _frameTime: HTMLElement | null = null;
  private _drawCalls: HTMLElement | null = null;
  private _triangles: HTMLElement | null = null;
  private _renderer: HTMLElement | null = null;
  private _pixelRatio: HTMLElement | null = null;
  private resolved = false;

  private resolve(): void {
    if (this.resolved) return;
    this._fps = document.getElementById("hud-fps");
    this._frameTime = document.getElementById("hud-frame-time");
    this._drawCalls = document.getElementById("hud-draw-calls");
    this._triangles = document.getElementById("hud-triangles");
    this._renderer = document.getElementById("hud-renderer");
    this._pixelRatio = document.getElementById("hud-pixel-ratio");
    if (this._fps) this.resolved = true;
  }

  /**
   * Set the rendering backend display
   */
  setBackend(backend: "webgpu" | "webgl"): void {
    this.resolve();
    if (this._renderer) {
      this._renderer.textContent = backend === "webgpu" ? "WebGPU" : "WebGL";
    }
  }

  /**
   * Set the pixel ratio display
   */
  setPixelRatio(ratio: number): void {
    this.resolve();
    if (this._pixelRatio) {
      this._pixelRatio.textContent = ratio.toFixed(2);
    }
  }

  /**
   * Update performance panel with current frame data
   */
  update(deltaTime: number, renderer: THREE.WebGPURenderer): number {
    // Track frame times for averaging (keep last 60 frames)
    this.frameTimeHistory.push(deltaTime * 1000);
    if (this.frameTimeHistory.length > 60) {
      this.frameTimeHistory.shift();
    }

    // Calculate average frame time
    const avgFrameTime =
      this.frameTimeHistory.reduce((a, b) => a + b, 0) /
      this.frameTimeHistory.length;

    // Snapshot per-frame draw calls every frame
    const info = renderer.info;
    this.snapshotDrawCalls = info.render.calls - this.lastSnapshotCalls;
    this.lastSnapshotCalls = info.render.calls;

    // Throttle DOM updates to every 500ms
    const now = performance.now();
    if (now - this.lastDisplayUpdate >= 500) {
      this.lastDisplayUpdate = now;
      this.resolve();

      const fps = 1000 / avgFrameTime;

      if (this._fps) {
        this._fps.textContent = fps.toFixed(0);
      }

      if (this._frameTime) {
        this._frameTime.textContent = Math.round(avgFrameTime) + " ms";
      }

      if (this._drawCalls) {
        this._drawCalls.textContent = this.snapshotDrawCalls.toString();
      }

      if (this._triangles) {
        const triangles = info.render.triangles;
        this._triangles.textContent =
          triangles >= 1000000
            ? (triangles / 1000000).toFixed(2) + "M"
            : triangles >= 1000
              ? (triangles / 1000).toFixed(1) + "K"
              : triangles.toString();
      }
    }

    return avgFrameTime;
  }
}

/**
 * Dynamic resolution scaling manager
 */
export class DynamicResolutionManager {
  private currentPixelRatio: number;
  private pixelRatioAdjustCooldown = 0;

  constructor(initialPixelRatio: number) {
    this.currentPixelRatio = initialPixelRatio;
  }

  setPixelRatio(ratio: number, renderer: THREE.WebGPURenderer): void {
    this.currentPixelRatio = ratio;
    renderer.setPixelRatio(ratio);
  }

  /**
   * Update pixel ratio dynamically to maintain target FPS
   */
  update(
    avgFrameTime: number,
    renderer: THREE.WebGPURenderer,
    performanceParams: PerformanceParams
  ): void {
    if (!performanceParams.dynamicResolution) return;

    // Decrease cooldown
    if (this.pixelRatioAdjustCooldown > 0) {
      this.pixelRatioAdjustCooldown--;
      return;
    }

    const targetFrameTime = 1000 / performanceParams.targetFps;
    const minRatio = performanceParams.minPixelRatio;
    const maxRatio = performanceParams.maxPixelRatio;

    // If frame time is too high (low FPS), decrease pixel ratio
    if (avgFrameTime > targetFrameTime * 1.1) {
      const newRatio = Math.max(minRatio, this.currentPixelRatio - 0.1);
      if (newRatio !== this.currentPixelRatio) {
        this.currentPixelRatio = newRatio;
        renderer.setPixelRatio(this.currentPixelRatio);
        this.pixelRatioAdjustCooldown = 30;
      }
    }
    // If frame time is low enough (good FPS), try increasing pixel ratio
    else if (avgFrameTime < targetFrameTime * 0.85) {
      const newRatio = Math.min(maxRatio, this.currentPixelRatio + 0.05);
      if (newRatio !== this.currentPixelRatio) {
        this.currentPixelRatio = newRatio;
        renderer.setPixelRatio(this.currentPixelRatio);
        this.pixelRatioAdjustCooldown = 60;
      }
    }
  }
}
