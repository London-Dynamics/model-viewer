// oidn-web's declarations reference WebGPU, which this tsconfig's DOM lib
// does not include. These names exist only so that import type-checks.
export {};

declare global {
  interface GPUAdapterInfo {}

  interface GPUBuffer {}

  interface GPUDevice {}

  interface GPUQueue {
    onSubmittedWorkDone(): Promise<void>;
  }

  interface GPUTexture {}
}
