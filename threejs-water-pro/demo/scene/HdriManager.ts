// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import { UltraHDRLoader } from "three/addons/loaders/UltraHDRLoader.js";
import type { Sky } from "threejs-water-pro";

export interface HdriOption {
  label: string;
  url: string;
}

/**
 * Equirectangular HDRI files served from `demo/public/hdris/`. Add an entry
 * here for each file dropped into that directory — Vite serves `public/`
 * statically and cannot enumerate it at runtime.
 */
export const HDRI_OPTIONS: ReadonlyArray<HdriOption> = [
  {
    label: "Citrus Orchard Road (puresky)",
    url: "hdris/citrus_orchard_road_puresky_4k.jpg",
  },
  {
    label: "Industrial Sunset 02 (puresky)",
    url: "hdris/industrial_sunset_02_puresky_4k.jpg",
  },
  {
    label: "Kloofendal 43d Clear (puresky)",
    url: "hdris/kloofendal_43d_clear_puresky_4k.jpg",
  },
  {
    label: "Kloofendal 48d Partly Cloudy (puresky)",
    url: "hdris/kloofendal_48d_partly_cloudy_puresky_4k.jpg",
  },
  {
    label: "Night Sky HDRI 008",
    url: "hdris/NightSkyHDRI008_4K_HDR.jpg",
  },
  {
    label: "Overcast Soil (puresky)",
    url: "hdris/overcast_soil_puresky_4k.jpg",
  },
  {
    label: "Qwantani Dusk 2 (puresky)",
    url: "hdris/qwantani_dusk_2_puresky_4k.jpg",
  },
  {
    label: "Qwantani Moonrise (puresky)",
    url: "hdris/qwantani_moonrise_puresky_4k.jpg",
  },
];

/**
 * Loads equirectangular Adobe UltraHDR JPGs as HDRI sky sources. The loader
 * parses the gain map embedded alongside the SDR base image and produces a
 * linear `HalfFloat` texture — no manual colour-space assignment is needed.
 * For plain LDR JPGs the gain map is absent and the loader falls back to the
 * SDR base image.
 */
export class HdriManager {
  readonly options = HDRI_OPTIONS;

  private readonly _loader = new UltraHDRLoader();

  /**
   * Returns true if `url` matches one of the bundled options. A persisted
   * URL from localStorage may no longer match anything if assets were
   * renamed; in that case the dev server's 404 HTML would be parsed as a
   * JPEG and die in `UltraHDRLoader.parse`. Callers should fall back to
   * `options[0].url`.
   */
  isValid(url: string): boolean {
    return this.options.some((opt) => opt.url === url);
  }

  /** Load the equirect at `url` (relative to `demo/public/`). */
  load(url: string): Promise<THREE.Texture> {
    return new Promise((resolve, reject) => {
      this._loader.load(
        url,
        (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          // Wrap U around the antimeridian; without this, ClampToEdge filtering
          // produces a hard seam where U=0 and U=1 meet at the back of the dome.
          texture.wrapS = THREE.RepeatWrapping;
          // The atan2-based UV used by `equirectUV()` is discontinuous at the
          // seam, so dFdx/dFdy explode there and the GPU picks a tiny mip,
          // producing the bright/sparkly seam. Disable mipmaps and use a
          // linear filter — fine for a sky/reflection source where mip-AA
          // isn't critical.
          texture.generateMipmaps = false;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.needsUpdate = true;
          resolve(texture);
        },
        undefined,
        (error) => reject(error),
      );
    });
  }

  /** Load `url` and swap it in on `sky` (refreshes the reflection PMREM too). */
  async apply(
    url: string,
    sky: Sky,
    renderer: THREE.WebGPURenderer,
  ): Promise<void> {
    const tex = await this.load(url);
    sky.setTexture(tex, renderer);
  }
}
