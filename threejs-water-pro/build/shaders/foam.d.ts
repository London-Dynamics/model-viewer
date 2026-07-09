import type { FoamBuildParams, FoamResult } from "./foamTypes";
/**
 * Foam orchestrator that combines surface, wave, and shoreline foam.
 *
 * Unlike other shader classes, Foam doesn't own uniforms. It coordinates
 * the sub-foam classes which each own their own uniforms, and combines
 * their outputs into a unified result.
 */
export declare class Foam {
    /**
     * Builds all foam effects and combines them.
     *
     * Surface foam and turbulent foam are blended additively. Shoreline
     * foam has its own tint color and is blended separately.
     *
     * @param params - Parameters for foam calculation including sub-foam instances.
     * @returns Object with foam strengths, tint colors, and effective fresnel.
     */
    build(params: FoamBuildParams): FoamResult;
}
//# sourceMappingURL=foam.d.ts.map