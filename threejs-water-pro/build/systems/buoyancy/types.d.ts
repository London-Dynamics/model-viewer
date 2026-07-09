/**
 * Type definitions for buoyancy system.
 */
import * as THREE from "three/webgpu";
/**
 * Options for adding a buoyant object.
 * All properties are optional and have sensible defaults.
 */
export interface BuoyancyOptions {
    /** Vertical offset relative to the water surface. Default: 0 */
    heightOffset?: number;
    /** Response time for height changes in seconds. Default: 0.15 */
    heightSmoothing?: number;
    /**
     * When true, uses 5 sample points (center, bow, stern, port, starboard) for
     * full pitch/roll dynamics. When false, uses a single center point for height
     * tracking only (no rotation changes). Default: true
     */
    multiPoint?: boolean;
    /** Ship length for pitch calculation. Default: 0 (auto from bounding box) */
    sampleLength?: number;
    /** Ship width for roll calculation. Default: 0 (auto from bounding box) */
    sampleWidth?: number;
    /** Local offset for the sampling center. Default: (0, 0, 0) */
    sampleOffset?: THREE.Vector3;
    /**
     * When true, automatically calculates sampleLength and sampleWidth from the
     * object's bounding box. Only used when multiPoint is true. Default: true
     */
    useBoundingBox?: boolean;
    /** Euler rotation offset applied after wave alignment. Default: (0, 0, 0) */
    rotationOffset?: THREE.Euler;
    /** How much the object tilts with waves (0-1). Default: 0.5 */
    rotationInfluence?: number;
    /** Response time for rotation changes in seconds. Default: 0.2 */
    rotationSmoothing?: number;
}
/**
 * Internal representation of a registered buoyant object.
 */
export interface BuoyantObject {
    id: number;
    object: THREE.Mesh;
    heightOffset: number;
    heightSmoothing: number;
    multiPoint: boolean;
    sampleLength: number;
    sampleWidth: number;
    sampleOffset: THREE.Vector3;
    rotationOffset: THREE.Euler;
    rotationInfluence: number;
    rotationSmoothing: number;
    currentHeight: number;
    currentQuaternion: THREE.Quaternion;
    heightVelocity: number;
    angularVelocity: THREE.Vector3;
    isFirstFrame: boolean;
    sampleIndices: number[];
}
/** Default values for BuoyantObjectConfig */
export declare const BUOYANCY_DEFAULTS: {
    heightOffset: number;
    heightSmoothing: number;
    multiPoint: boolean;
    useBoundingBox: boolean;
    sampleLength: number;
    sampleWidth: number;
    rotationInfluence: number;
    rotationSmoothing: number;
};
/**
 * Sample point data for debug visualization
 */
export interface SamplePointData {
    /** World position of the sample point */
    position: THREE.Vector3;
    /** Water height at this point */
    height: number;
    /** Surface normal at this point */
    normal: THREE.Vector3;
    /** Label for this point (e.g., "center", "bow", "stern", "port", "starboard") */
    label: string;
}
/**
 * Debug data for a single buoyant object
 */
export interface BuoyancyDebugData {
    /** Object ID */
    id: number;
    /** Sample points for this object */
    samplePoints: SamplePointData[];
}
/**
 * Configuration for the debug visualizer
 */
export interface BuoyancyDebugConfig {
    /** Size of sample point markers */
    markerSize: number;
    /** Length of normal arrows */
    arrowLength: number;
    /** Color for sample point markers */
    markerColor: number;
    /** Color for normal arrows */
    arrowColor: number;
    /** Color for the center point marker */
    centerMarkerColor: number;
}
//# sourceMappingURL=types.d.ts.map