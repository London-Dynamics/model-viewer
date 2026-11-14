import {MaterialKernel as ShadowCatcherMaterialKernel} from './LDShadowCatcherMaterialKernel.js';
import {LogicKernel as ShadowCatcherLogicKernel} from './LDShadowCatcherLogicKernel.js';
import {IrradianceKernelTracer} from './install-irradiance-kernel.js';

interface KernelFields {
  bvhData: unknown;
  material: unknown;
  filterGlossy: number;
  maxBounces: number;
  maxTransparentBounces: number;
  maxSamples: number;
  seed: number;
}

interface LogicFields {
  envInfo: unknown;
  backgroundInfo: unknown;
  lightsInfo: unknown;
  misEnabled: number;
  maxBounces: number;
  clampDirect: number;
  clampIndirect: number;
  transmissiveBackground: number;
}

/**
 * Matte materials are shadow catchers: the page shows through the lit floor
 * and occluded direct light becomes the shadow's coverage. Installed once,
 * underneath the irradiance kernel, so turning the cache off keeps the catcher.
 */
export const installShadowCatcher = (tracer: IrradianceKernelTracer): void => {
  if (tracer._ldShadowCatcherMaterialKernel != null) {
    return;
  }
  const backend = tracer._pathTracer;
  if (backend.materialKernel == null) {
    tracer.useMegakernel(false);
  }
  const stock = backend.materialKernel as KernelFields|undefined;
  const stockLogic = backend.logicKernel as LogicFields|undefined;
  if (stock == null || stockLogic == null) {
    return;
  }
  const material = new ShadowCatcherMaterialKernel() as KernelFields;
  material.bvhData = stock.bvhData;
  material.material = stock.material;
  material.filterGlossy = stock.filterGlossy;
  material.maxBounces = stock.maxBounces;
  material.maxTransparentBounces = stock.maxTransparentBounces;
  material.maxSamples = stock.maxSamples;
  material.seed = stock.seed;
  const logic = new ShadowCatcherLogicKernel() as LogicFields;
  logic.envInfo = stockLogic.envInfo;
  logic.backgroundInfo = stockLogic.backgroundInfo;
  logic.lightsInfo = stockLogic.lightsInfo;
  logic.misEnabled = stockLogic.misEnabled;
  logic.maxBounces = stockLogic.maxBounces;
  logic.clampDirect = stockLogic.clampDirect;
  logic.clampIndirect = stockLogic.clampIndirect;
  logic.transmissiveBackground = stockLogic.transmissiveBackground;
  if (tracer._ldStockMaterialKernel == null) {
    tracer._ldStockMaterialKernel = stock as IrradianceKernelTracer['_ldStockMaterialKernel'];
  }
  if (tracer._ldStockLogicKernel == null) {
    tracer._ldStockLogicKernel = stockLogic as IrradianceKernelTracer['_ldStockLogicKernel'];
  }
  backend.materialKernel = material as IrradianceKernelTracer['_pathTracer']['materialKernel'];
  backend.logicKernel = logic as IrradianceKernelTracer['_pathTracer']['logicKernel'];
  tracer._ldShadowCatcherMaterialKernel = material as IrradianceKernelTracer['_ldShadowCatcherMaterialKernel'];
  tracer._ldShadowCatcherLogicKernel = logic as IrradianceKernelTracer['_ldShadowCatcherLogicKernel'];
  backend.rebuild();
};
