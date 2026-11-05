/**
 * AO sample radius is scaled from the src model's framing sphere.
 * `ModelScene.boundingSphere` is that sphere: environment-model geometry is
 * parented under `environmentRoot` and is not included. Folding the
 * environment into the scale shrinks the effect until it disappears on a
 * small product sitting in a large set.
 */
export const AO_RADIUS_MIN_REFERENCE = 0.5;
export const AO_RADIUS_FINE_TUNE = 0.1;

export const srcModelBoundingRadius =
    (scene: {boundingSphere?: {radius?: number}|null}|null|undefined):
        number => {
          const radius = scene?.boundingSphere?.radius;
          if (typeof radius === 'number' && Number.isFinite(radius)) {
            return radius;
          }
          return 1;
        };

export const scaleAmbientOcclusionRadius =
    (aoRadius: number, aoThickness: number, srcRadius: number):
        {radius: number; thickness: number} => {
          const radiusScale = 1 / Math.max(srcRadius, AO_RADIUS_MIN_REFERENCE);
          const factor = radiusScale * AO_RADIUS_FINE_TUNE;
          return {
            radius: aoRadius * factor,
            thickness: aoThickness * factor,
          };
        };
