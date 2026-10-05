/**
 * Draw-order slots for the sky/water backdrop stack.
 *
 * Mirrored verbatim in threejs-sky-pro (`src/rendering/renderOrder.ts`). The two
 * libraries cannot import each other, so both copies are edited together — these values
 * are the contract between them.
 *
 * `opaque` and `transparent` values are never comparable: they sort in separate lists.
 * Slots are spaced by 10 to leave insertion room.
 *
 * The order that matters, all within the transparent list:
 *
 *     stars → cirrus → water surface → cloud composite → scene transparents
 *
 * The water surface writes depth; the cloud composite depth-tests its ray-hit distance
 * against it. The composite must draw after the surface, or the water paints over the
 * clouds.
 *
 * @internal
 */
export declare const RenderOrder: {
    /** For `material.transparent === false`. */
    readonly opaque: {
        /** water-pro's ocean floor. */
        readonly oceanFloor: -100;
        /** Backdrop dome: sky-pro's atmosphere, or water-pro's built-in HDRI sky. */
        readonly skyDome: -90;
        /** water-pro's depth-only underwater volume. */
        readonly underwaterVolume: -80;
    };
    /** For `material.transparent === true`. */
    readonly transparent: {
        /** sky-pro's star panorama. Before cirrus, so a cirrus deck can dim the stars. */
        readonly stars: -50;
        /** sky-pro's cirrus deck. */
        readonly cirrus: -40;
        /** water-pro's water surface. Writes depth. */
        readonly waterSurface: -30;
        /** sky-pro's volumetric cloud layer. Depth-tests against the water surface. */
        readonly cloudComposite: -20;
    };
};
//# sourceMappingURL=renderOrder.d.ts.map