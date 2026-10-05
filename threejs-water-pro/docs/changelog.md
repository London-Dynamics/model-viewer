# Changelog

All notable changes to Three.js Water Pro are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## v3.5.1 - 8/19/26

 This patch fixes an issue with WebGL mode that would cause the water to not render when integrating Water Pro and Sky Pro in the same project.

### Fixed

- Physical water transmittance LUT switched from texture to uniform buffer
- Disabled water masking no longer reserves an image unit or performs mask rendering.

## v3.5.0 - 8/19/26

v3.5 focuses on improving performance across all quality levels.

### Changed

- WebGPU wave updates now reduce CPU scheduling overhead and GPU memory traffic, with automatic compatibility on devices that cannot use the optimized mode.
- Calm wakes no longer consume ongoing simulation work and resume automatically when disturbed.
- Disabled screen-space reflections no longer consume ongoing GPU work.
- Underwater transparency, sun shafts, and water-depth rendering now use less GPU memory and bandwidth.
- Max quality now allocates more detail to large swells while preserving the finest surface detail at lower total wave-update cost.
- The demo replaces automatic dynamic resolution with direct DPR control.

## v3.4.0 - 8/14/26

v3.4 adds selectable physical and artist-authored water color while preserving v3.3 configurations. See the [v3.3 → v3.4 migration guide](/guide/migrating-from-v3-3-to-v3-4).

### Added

- `water.color.mode` switches at runtime between spectral Jerlov-based physical optics and the artist-authored color model.
- `water.color.setJerlovType()` seeds adjustable algae, silt, and stain concentrations from ten oceanic and coastal Jerlov water types.

### Changed

- Existing v3.3 `color.waterColor`, `color.absorptionColor`, and `color.transmissionColor` configurations select custom mode and remain supported without changes.
- The Commercial Software License Agreement is updated to version 2.2, with a fourteen-day refund window when the software files have not been downloaded.

### Fixed

- Wave surfaces now start with naturally varied fine detail instead of uniform circular ringing, and different `seed` values produce distinct waves.

## v3.3.0 - 7/30/26

The wave simulation now runs on a physically calibrated spectrum; wave heights, speeds, and sizes are in real meters and seconds. Saved presets must be updated — see the [v3.2 → v3.3 migration guide](/guide/migrating-from-v3-2).

### Breaking Changes

- Removed the separate `waves` and `ripples` tile scales and the `waves.fft.frequency` multiplier. Set the largest tile with `waves.fft.cascades.maxScale` (meters, default `1024`).
- Removed per-band `amplitudeScale`. Scale wave height with `water.waves.amplitude`.
- Removed the Gerstner swell layer, `water.gerstner`, and the `waves.gerstner` preset block. The wave spectrum now produces large swells on its own.
- Removed `water.fresnel.normalStrength`, `fadePower`, and `fadeStart`. The effects they tuned are now automatic; saved presets containing them still load.
- Removed `sky.reflectionBlurDistance` and `sky.reflectionDistanceBlur`. Reflection blur is now automatic; `sky.reflectionRoughness` sets the base blur.
- `water.config.cascades` is now an array of `{ resolution, enabled }` entries ordered coarsest to finest, replacing the named `waves` and `ripples` fields.

### Added

- New "Max" quality level above "Ultra", with finer wave and ripple detail.
- `water.waves.peakWavelength` sets the dominant wave size. Wind speed now controls wave energy and steepness only.
- `water.setMaxScale()` resizes the wave field at runtime.

### Changed

- Wave heights, speeds, and sizes are physically accurate; sea states may look calmer or larger than before.
- Quality levels now select which frequency bands render (swell, waves, ripples) instead of rendering every band at lower detail, so wave shape no longer changes with quality.
- Wave detail and sky reflection sharpness fade automatically where waves are too small or too distant to resolve, removing distant shimmer and the flat-mirror horizon.

## v3.2.1 - 7/21/26

### Added

- Sky providers can implement an optional `getBrightnessNode()` so their brightness scales the environment lighting on scene objects. The built-in `Sky` implements it.
- `Sky.brightness` getter and setter for the sky's brightness multiplier.

### Fixed

- Swapping the sky provider or replacing its texture with `Sky.setTexture` now updates environment lighting and reflections across all scene objects.

## v3.2.0 - 7/20/26

This update adds official support for Three.js Sky Pro.

For instructions on integrating Water Pro and Sky Pro into the same project, see the [Sky Pro Integration guide](/guide/sky-pro-integration). The [basic example](/guide/basic-example) shows the built-in HDRI sky setup, and the [`setSky` API](/api/water-system#setsky) documents the provider contract.

### Added

- New `SkyProvider` interface. `water.setSky()` now accepts any implementation, and the type is exported for writing custom providers.
- The water system now manages `scene.environment` and the active sky's scene objects. Setting a sky drives image-based lighting and adds its backdrop to the scene automatically; you no longer add or remove sky objects yourself.

### Changed

- ⚠️ **Breaking.** `Sky` now takes the renderer as its first constructor argument: `new Sky(renderer, params)`. The sky prepares its reflection environment on construction, so calling `uploadSource()` before `setSky()` is no longer needed.
- ⚠️ **Breaking.** The built-in ambient (hemisphere) light is removed. Ambient lighting now comes entirely from the sky's environment lighting; use `water.environment.intensity` to control it. The `lighting.ambient` preset values, the `water.lighting.ambient` object, and `water.lighting.hemisphereLight` are gone — remove `lighting.ambient` from custom presets, and add your own scene lights if you need fill beyond what the sky provides.

## v3.1.1 - 7/8/26

This version introduces a rebuilt transparency pipeline that uses Three.js built-in functionality. These changes have resulted in a 5-10% performance improvement (measured in the demo).

Atmospheric fog now composes correctly with transparent, additive, alpha-tested, and sprite materials, including overlapping transparent objects. Additive materials fade out with distance instead of glowing through the fog. Custom backdrop objects such as sky domes should set `material.fog = false`.

### Added

- New `water.fog` methods for applying the water's atmospheric fog to your own materials: `createFogFactorNode(distance)`, `createFogColorNode(worldDirection, distance)`, and `createFoggedColorNode(color, options)`. Use them with `material.fog = false` when an object needs custom fog behavior. See the [fog API](/api/fog) for details.
- New read-only `water.cameraSubmerged` reports whether the camera is below the water surface. It is always `false` while underwater effects are disabled. Use it to gate submersion-dependent app content such as audio or UI.

### Changed

- ⚠️ **Breaking.** The `SceneDepthPass` and `SceneColorPass` exports have been replaced by `SceneCapturePass` and `SceneDepthSampler`. Update your imports if you referenced them directly.
- The `sceneColorResolutionScale` quality-level option has been removed; what you see through the water always renders at full resolution.

## v3.1.0 - 6/17/26

### Changed

- Persistent wave crest foam now uses a world-fixed texture that follows camera
- Swells and ripples now contribute to wave crest foam
- Foam resolution should be improved on high/ultra quality levels.
- **WebGL**: Stateless wave crest foam implementation has been deprecated; the backend now uses persistent foam to match the WebGPU implementation

### Removed

- The stateless wave-crest foam properties `foam.waves.coverage`, `crestCoverage`, `peakIntensity`, `rippleWeight`, and `waveWeight` have been removed. Wave-crest foam appearance is now controlled by `foam.waves.opacity`, `size`, and `windStretch`, plus the `foam.waves.persistence` energy settings (`crestStrength`, `windwardStrength`, `decayTime`).

### Fixed

- Switching quality levels no longer re-enables effects you turned off. An effect disabled in a preset or the UI (for example sparkle) now stays off when you change quality; a level can still force heavy effects off on lower tiers but never forces them back on.
- Wave height is now consistent across quality levels, and large swells are more evenly distributed. Switching between Low, Medium, High, and Ultra no longer makes the water noticeably taller, shorter, or lumpier; higher levels add finer detail at the same overall height. The Gerstner `amplitude` now maps to the actual swell height instead of growing with the number of swell waves, so you may want to lower it in existing setups.
- Foam textures (surface, wave-crest, and shoreline) now apply reliably the first time you select them, including when changing presets.
- The surface, wave-crest, and shoreline foam layers now each apply their own texture independently, even when two layers use the same bundled foam texture.
- Changing a foam texture in the UI now changes only the texture, leaving that foam's opacity, size, coverage, color, and wave-crest persistence as you set them. A new `loadTexture(name)` method on `water.foam.surface`, `water.foam.waves`, and `water.foam.shoreline` switches the bundled texture on its own.
- Saving a preset now keeps your tuned wave-crest persistence (`crestStrength`, `windwardStrength`, `decayTime`).
- Persistent wave-crest foam no longer drops out of the water near the camera when you look across the surface at a shallow angle.
- **WebGPU**: `WaterSystem.getHeightAt` and buoyancy now track the surface at high choppiness. The solve that inverts horizontal wave displacement is iterated instead of single-stepped, so it converges on steep crests where buoyant objects previously floated above troughs or sank under crests.
- **WebGL**: `WaterSystem.getHeightAt` was broken and should now perform identically to the WebGPU path.
- **WebGL**: Fixed wakes not rendering on WebGL
- **WebGL**: Persistent wave-crest foam no longer builds up far more heavily than on WebGPU. Foam now concentrates on the leading face of waves and matches the WebGPU look in coverage and intensity.

## v3.0.0 - 6/5/26

v3 is a feature- and quality-focused release with several breaking API changes. **If you are upgrading an existing v2 project, see the [v2 → v3 Migration Guide](/guide/migrating-from-v2).**

### Highlights

- **Multiplayer-ready determinism**: Fixed-step simulation and a tick-sync primitive for cross-client wave agreement.
- **Persistent wave-crest foam (WebGPU)**: Foam lingers and rolls off breaking waves.
- **Sea spray emitters**: Up to 16 emitters with 32 probes each, attached to your scene objects.
- **Rain**: Wind-driven streaks plus water-surface ripples.
- **Sun-shadow occluded caustics**: Shadow-casting objects block the caustics pattern on the seafloor.
- **Local Fresnel-based water transparency**: See through thin water from above; the surface remains opaque elsewhere.
- **Library-owned ambient lighting**: Sunset warmth and arctic cool, scene-wide and automatic.
- **Improved wave realism**: An updated spectrum produces more organic wave patterns.
- **Performance**: Roughly 2 ms of CPU saved per frame on WebGPU (non-blocking buoyancy readback), constant-cost SSR, and hardware bilinear FFT normals.
- **Boat wakes**: Realistic dispersive ship wakes with automatic foam on breaking crests (WebGPU).
- **Bundled foam textures**: Foam textures ship with the library; manual asset copying is no longer needed.
- **HDRI-only sky**: A single `Sky` class replaces the procedural sky providers.
- **Physically-based water color**: Beer-Lambert absorption replaces the old shallow/deep color model.

The full notes are grouped by area below; breaking changes are flagged inline with ⚠️.

### Lighting

- ⚠️ **Breaking.** `water.sun` moved under a new `water.lighting` subsystem; use `water.lighting.sun` instead. The uniforms are unchanged; only the access path differs.
- **New API.** `water.lighting.sunLight` exposes the directional light driving the scene as a read-only handle. Toggle `castShadow` and tune `shadow.mapSize`, `shadow.bias`, and the shadow camera frustum to fit your scene. Position, target, and intensity remain owned by the water system.
- **New API.** `water.lighting.hemisphereLight` adds a scene-wide ambient fill driven by the new `lighting.ambient` preset fields (`skyColor`, `groundColor`, `intensity`, useful intensity range `0–2`), so the shaded sides of boats and terrain warm at sunset, cool in arctic light, and dim at night.
- The directional light now tracks the sun colour set in the preset (`sky.sun.diskColor`). Sunsets warm the lighting and arctic skies stay cool. Previously the light was always white.

### Wave Simulation

- ⚠️ **Breaking.** `directionalSpreading` replaced with `spectralSharpness` (default `1.0`). Higher values narrow waves toward the wind direction; lower values broaden them. The two are not interchangeable: `spectralSharpness` multiplies a frequency-dependent spread curve rather than setting a constant exponent, so existing values do not map directly.
- **Improved wave realism.** The wave simulation model has been updated to create more realistic and organic-looking wave patterns.
- **Multiplayer-ready determinism.** See the new [Multiplayer guide](/guide/multiplayer).

### Foam

- ⚠️ **Breaking.** Removed `foam.waves.windBias`. Leading-edge gating is now exclusively the persistent foam's job on WebGPU and uses internal defaults on WebGL. Use `foam.waves.persistence.windwardStrength` to control how much foam appears on the rising face of waves.
- ⚠️ **Breaking.** Foam textures are now bundled with the library. The `foam.{surface,waves,shoreline}.texture` preset field is now a built-in name (`"foam1" | "foam2" | "foam3" | "foam4"`) instead of a filename, and apps no longer need to copy `foam1.jpg`–`foam4.jpg` into their public folder. Update preset values from `"foamN.jpg"` to `"foamN"`. Custom foam textures are still supported by assigning a `THREE.Texture` to the appropriate shader class, e.g. `water.foam.surface.foamTexture = myTexture`.
- **Persistent wave-crest foam (WebGPU only).** Foam on whitecaps now persists and rolls off the back of the wave before decaying, creating much more realistic breaking-wave behaviour.

### Spray (NEW)

- **Sea-spray emitters.** New in v3. Attach emitters to objects (rocks on the shoreline, boat hull) and define probes that generate sea spray when the water velocity exceeds a threshold. Up to 16 emitters with 32 probes each. Configured via `water.spray`. See the [Spray guide](/guide/spray) and [Spray API](/api/spray) for details.

### Rain (NEW)

- **Rain effect** with wind-driven streaks and water-surface ripples. Access via `water.rain`.

### Surface Optics, Fresnel & Color

- ⚠️ **Breaking.** Fresnel `power` replaced by `iorRatio` (refractive index of water relative to air, default `1.33`). Higher values shrink Snell's window and raise grazing reflectance. The two parameters control the same curve but through different physics, so existing `power` values do not map directly.
- **Unified Fresnel curve** above and below water. A single physically-derived curve drives both viewing directions. Looking up from beneath the surface produces the correct Snell's window (a bright cone of refracted sky surrounded by total internal reflection) without depending on a separate underwater glow effect.
- **Local Fresnel-based water transparency.** Looking nearly straight down at thin water (over a boat, sea floor, or shallow terrain), the surface fades toward transparent and the underwater scene shows through; at grazing angles or over deep water the surface stays opaque. Tune `color.absorptionColor` to control how murky deep water becomes: larger values turn opaque sooner, and smaller values stay see-through farther down.
- **Above-water refraction.** Looking down at the sea floor, the seabed now warps with the surface waves instead of sitting flat under the water. New `fresnel.refractionStrength` parameter (default `0.1`, useful range `0`–`0.5`) controls the wobble; the same value drives the Snell's-window warp seen from below the surface.

### Underwater

- ⚠️ **Breaking.** Removed the underwater "surface glow" effect. The bright Snell's window halo now comes entirely from the corrected refraction sampling, so the separate glow effect is no longer needed. Drop references to `water.underwaterSurfaceGlow`, the preset's `oceanFloor.surfaceGlow`, and the `underwaterTIR` quality feature flag.
- ⚠️ **Breaking.** Underwater fog is now unified with the above-water water colour. The `postProcessing.underwater` config no longer has `fogColor`, `fogDensity`, or `fogPower` fields; fog colour and falloff are derived from `color.waterColor` and `color.absorptionColor`, so the same per-channel Beer-Lambert attenuation applies above and below the surface. Remove those three fields from custom underwater configs; set `color.waterColor` to your old fog colour and tune `color.absorptionColor` for how fast things fade with depth.
- **New API.** `water.underwater.tintColor` (default `#ffffff`) multiplies the entire underwater view, letting you shift its overall hue without changing the physical absorption.
- **Bug fix.** Snell's window now uses the correct water→air refraction direction. Previously the sky was sampled with the inverse ratio, so the sun and horizon appeared at expanded angles instead of compressed; the corrected version puts the sun closer to the zenith and the horizon at the window's edge, matching real underwater optics.
- **Bug fix.** Underwater sun shafts now centre on the sun's apparent (refracted) position through the surface, so the radial god-ray pattern lines up with the bright sun image inside Snell's window.
- **Bug fix.** Removed the bright "water-behind" hairline halo the underwater fog left around plants and other objects when distortion was enabled. The fog samples scene depth with smooth interpolation so the depth-driven fog amount transitions across silhouettes the same way the scene colour does.
- **Bug fix.** Fixed scattered bright pixel artifacts visible on the underside of the water surface when the camera is submerged.

### Caustics

- Caustics now show through the water surface when viewed from above, not only when the camera is submerged. They refract with the surface waves and are attenuated by water absorption like everything else under the surface.
- Sun-shadow occlusion is unchanged: shadow-casting objects block the dancing caustic pattern on the seabed. Disabling `water.lighting.sunLight.castShadow` restores the un-occluded caustics.

### Sky

- ⚠️ **Breaking.** Procedural sky removed. The library now ships a single `Sky` class that samples an equirectangular HDRI (`.hdr`, `.exr`, Adobe UltraHDR JPG, or plain LDR JPG); `RayleighSky`, `GradientSky`, `CubeMapSky`, and the `SkyProvider` interface are gone, along with `water.setEnvironmentMap`; pass a `Sky` instance to `water.setSky()` instead. Bake atmosphere, gradient, or cubemap looks into an equirect image and use `Sky`. See the [v2 migration guide](/guide/migrating-from-v2#sky-providers) for the swap recipe.
- ⚠️ **Breaking.** Ambient lighting moved to `water.lighting.ambient` (`skyColor`, `groundColor`, `intensity`). Preset field moved from `sky.ambient.intensity` to `lighting.ambient.{skyColor, groundColor, intensity}`. The HemisphereLight is no longer driven by the sky image.
- ⚠️ **Breaking.** Preset shape: `sky.atmosphere`, `sky.clouds`, and `sky.ambient` removed. New optional `sky.source: { type: "hdri" | "cubemap", url }` lets a preset specify a default sky image. `sky.sun` gains a `diskEnabled` boolean for the overlay.
- New optional sun disk overlay on `Sky` (off by default). It places a stylised sun on top of the image without re-baking. The disk reads its direction from `water.lighting.sun.direction`, so it tracks the same sun used by the directional light, sparkle, sun shafts, and SSS.

### Wake

- Objects registered via `water.wake.addGenerator(object, options?)` leave a realistic wake with automatic foam on breaking crests (WebGPU; the WebGL backend renders calm water). See the [Wake API](/api/wake) for tuning options.
- ⚠️ **Breaking.** The old wake-foam API is removed. Wake foam is now automatic; remove any references to `foam.wake`, `WakeSystem.applyParams`, `WaterSurfaceMaterial.setWakeSystem`, and the removed exports `Wake`, `WakeCompute`, `MAX_WAKE_GENERATORS`, `WAKE_DEFAULTS`, and `WakeParams`.

### Multiplayer

- **Runtime deterministic toggle.** `water.deterministic` is now writable. Changing it at runtime preserves absolute simulation time, so wave phases continue unbroken. Switching from non-deterministic to deterministic mode snaps to the nearest integer tick; call `syncToTick` afterwards if you need an exact authoritative tick. The demo's Multiplayer folder exposes the toggle as a checkbox.

### Color

- ⚠️ **Breaking.** The water color model is now physically based. The depth-dependent appearance comes from per-channel Beer-Lambert absorption against a single intrinsic water color, so the seabed naturally shifts toward the water color with depth, and refracted underwater silhouettes no longer leave a tint halo. Replace `color.shallowWaterColor`, `color.deepWaterColor`, `color.depthFalloff`, and the scalar `color.absorptionRate` with two fields: `color.waterColor` (the intrinsic color; copy your old `deepWaterColor` here) and `color.absorptionColor` (per-channel extinction as a hex color, e.g. `#0a0503` for clear ocean). Larger values are murkier; tinted values such as a redder absorption let blue light pass farthest.
- ⚠️ **Breaking.** `color.alpha` is removed. Surface transparency is now driven entirely by absorption and Fresnel, so a separate global opacity control is redundant. Drop the field from preset objects and any code that sets `water.color.alpha`. To make water more see-through everywhere, lower `color.absorptionColor`; to make it opaque sooner, raise it.

### Presets

- ⚠️ **Breaking.** The `choppy` preset has been replaced by a new `dusk` preset, a calm twilight scene with a low golden-pink sun over gentle swells. Update any `"choppy"` references to `"dusk"`.
- **New `blackFlag` preset**: a high-seas pirate look with strong winds, churning teal seas under a bright sky, and dense, long-lived crest foam.

### Rendering & Quality

- ⚠️ **Breaking.** `water.createPostProcessingNode(scenePass, inputColor)` replaced by `water.postProcessing.buildNode(scenePass, inputColor)`. Same signature, same return value, different access path.
- ⚠️ **Breaking.** Removed the dynamic-object API: `water.rendering.addDynamicObject()`, `water.rendering.removeDynamicObject()`, `water.rendering.getDynamicObjects()`. This was previously used to disable shoreline foam being applied to floating objects (ships, buoys, etc.). All objects now have this foam enabled by default.
- ⚠️ **Breaking.** Water-surface mesh resolution is now determined solely by the quality level. The `clipmap.segments` preset field has been removed, and `rebuildGeometry` no longer accepts `segments`. To use a different resolution, set `segments` on the `QUALITY_LEVELS` entry for your quality level (or define your own quality configuration) before creating the water system.
- **Bug fix.** Transparent objects (glass panels, soft-edged sprites) are now fogged correctly above and below water. Fog no longer washes over a near transparent object as if it sat as far away as the scene behind it, and soft-edged textures no longer leave a faint rectangular outline in the fog.
- **Bug fix.** Scenes containing transparent objects no longer fail to render on the WebGL backend.

### Performance

- Quality-level swaps are faster and preserve sky and mask registrations automatically; re-registering after `setQualityLevel` is no longer needed.
- Buoyancy sampling no longer stalls the frame waiting for a GPU readback. As a result, _heights and normals used to position floating objects are one frame older than before_, which is negligible in practice. **This frees roughly 2 ms of CPU time per frame on WebGPU.** `WaterSystem.getHeightAt()` is unchanged and still returns fresh data for one-off queries.
- Screen-space reflection cost no longer scales with how much of the screen the water covers; looking down at water performs the same as a horizon view.
- Faster water shading on WebGPU: per-fragment FFT normal sampling now uses hardware bilinear filtering instead of a manual four-tap fetch.

## v2.1.2 - 4/1/26

### Bug Fixes

- Reverted build output filename from `threejs-water-pro.js` back to `index.js` to fix import resolution errors introduced in 2.1.1

## v2.1.1 - 3/31/26

### Improvements

- Boat wake foam now works on WebGL backend (previously WebGPU-only), using render-to-texture fallback
- Added `cameraTracking` property to disable automatic camera-following behavior. When disabled, use `setPosition(x, z)` to manually position the water grid
- Compressed demo assets and excluded unused cache files, reduced zipped package size from 39MB -> 22MB

### Breaking Changes

- Minimum Three.js peer dependency raised from `>=0.170.0` to `>=0.181.0` (this was incorrectly set)

### Bug Fixes

- Fixed WebGL backend detection failing in production builds due to minified constructor names
- Fixed WebGL fallback producing transform feedback errors on mobile devices by using build-time branching for storage buffer vs texture paths in caustics and sun shafts shaders
- Fixed demo failing to load on browsers without WebGPU support; now gracefully falls back to WebGL
- Fixed shoreline foam rendering incorrectly at certain camera angles
- Fixed shoreline foam not rendering when SSR disabled
- Fixed sky sphere deforming when camera moves far from origin
- Fixed `water.floor.setVisible(false)` being overridden every frame by underwater state

## v2.1.0 - 3/23/26

### New Features

- Added `standingWaveRatio` parameter to FFT waves, controlling the blend between traveling waves (0) and standing waves (1). Wind directional bias applies only to the traveling portion, producing natural sheltered-water oscillation at higher values
- Transparent objects now render correctly with the water system, including proper underwater fog, reflections, and depth sorting
- `underwater.enabled` is now a unified toggle that disables all underwater-related work: post-processing (fog, distortion), sun shafts, water depth passes, waterline meniscus, particles, and ocean floor rendering. Use this for above-water-only projects to eliminate underwater GPU/CPU overhead entirely

### Quality Level Changes

- Shader effects (SSR, SSS, foam, sparkle, underwater TIR) are now runtime-toggleable at all quality levels. Quality levels set defaults; individual features can be overridden without shader recompile, like game graphics options
- SSS, shoreline foam, wake foam, and underwater TIR are now enabled at all quality levels

### Bug Fixes

- Wake foam now survives quality level changes (WakeSystem is no longer recreated)
- Ocean floor caustics no longer freeze after switching quality levels
- Underwater refraction intensity now correctly scales by distance from the water surface

### Performance

- Performance has been improved significantly (~30%) across all quality levels.
- All toggleable shader effects now early-exit when disabled at runtime via `If()` guards, skipping expensive GPU work (ray marching, texture samples, noise, specular) instead of computing results and discarding them
- Sun shaft intensity is now rendered at reduced resolution via a separate pass (`SunShaftPass`), then composited at full resolution with bilinear filtering. Resolution scale is configurable per quality level via `sunShaftResolutionScale`
- Scene color pass resolution is now configurable per quality level (1/4x low, 1/2x medium/high, 1x ultra), reducing fill rate for SSR and underwater refraction
- Eliminated redundant GPU readback for camera submersion detection by piggybacking on the buoyancy sampler
- Reduced GPU memory and bandwidth for render targets: DepthPass and WaterDepthPass use `HalfFloatType` (64 bits/px), MaskPass uses `UnsignedByteType` (32 bits/px), down from `FloatType` (128 bits/px)
- Wake system persists across quality level changes instead of being recreated

### Internal

- Replaced underwater geometry used for fog depth calculations with depth-only material
- `RenderPassManager` constructor refactored to use an options object; removed unused `_underwaterPlane` parameter
- Exposed `RenderPassManager` via `WaterSystem.rendering` accessor
- Preset and quality selects now show an asterisk when the user has changed settings from the selected preset or quality level defaults

## v2.0.0 - 3/10/26

### Migrating from v1 to v2

Since v2 was a complete overhaul of nearly every system in terms of quality and functionality, there is not a clear upgrade path from v1 to v2. As the project reaches maturity, the API will become more stable. A considerable amount of time was spent refactoring the entire codebase to build a strong foundation for future versions to build on, as well as making the API cleaner and easier to use.

### New Features

- **Gerstner Waves**: Waves swells are now modeled using Gerstner waves. Addresses tiling-issues that existed with the FFT-only approach.
- **Screen-Space Reflections (SSR)**: Real-time reflections on the water surface using screen-space ray marching.
- **Wake System**: Moving objects generate dynamic wakes with configurable spread, intensity, and decay.
- **Improved Foam System**: Replaced procedural foam with a texture-based approach resulting in improved visuals and performance
  - **Surface Foam**: Ambient foam applied to the entire water surface
  - **Wave Foam**: Foam on wave crests with wind stretch, wind bias, and per-cascade weights
  - **Shoreline Foam**: Depth-based foam near shores with configurable range
- **Simplified Wave Height Sampling**: Access water height/normal using a single call
- **Seamless Sky/Water Transitions**: Smoothly transition from above water to below water, support for partial submersion.
- **Sun Shafts (God Rays)**: Volumetric light effect for underwater scenes using procedural projection. Configurable intensity and scale. Works from any viewing angle.
- **Underwater Caustics**: Wave-based caustic patterns projected onto underwater surfaces.
- **Physical Meniscus Effect**: Realistic water-line curvature visible during partial submersion.
- **WebGL Fallback**: Implemented a proper WebGL fallback when the browser does not support WebGPU.

### Improvements

- `createPostProcessingNode` is now chainable, enabling cleaner post-processing setup
- Up to 100% improvement in rendering performance
- Reduced foam parameters from 27 to 22 by removing jargon (e.g., `jacobianThreshold` -> `crestCoverage`), fixing inverted controls, and using intuitive names like `opacity`, `size`, `coverage`
- Reduced from 3 cascades (swells/waves/ripples) to 2 cascades (waves/ripples). Large-scale swells are now handled analytically by Gerstner waves.
- Increased cascade resolutions across all quality levels (e.g., low: 64 -> 128, medium: 64/128 -> 128/256)
- Foam uniforms are now accessed via `water.foam.surface`, `water.foam.waves`, `water.foam.shoreline` instead of separate `water.foam`, `water.proceduralFoam`, `water.shorelineFoam` accessors
- Added `setSurfaceFoamTexture()`, `setWaveFoamTexture()`, and `setShorelineFoamTexture()` methods for per-layer texture customization
- Removed depth-based alpha (`shallowWaterAlpha`, `depthAlpha`) and distance-based alpha override (`alphaFalloff`). Water alpha is now a simple global control.
- Added `peakIntensity` parameter for wave foam to cap maximum foam density on wave crests
- Added `waves.amplitude` property as a global multiplier affecting both FFT cascades and Gerstner waves
- All presets updated with new foam, trail, and Gerstner parameters
- Fog and fresnel `fadeEnd` are now automatically set to the water extent (half of total clipmap size). This ensures effects fade at the water's edge regardless of geometry configuration.

### Bug Fixes

- Fixed SSS wave transmission calculation (redundant `vec3()` wrapper was breaking the dot product with wave normals)
- Fixed white outlines on objects in front of water caused by shoreline foam incorrectly triggering on scene geometry closer than the water surface
- Fixed mask texture to only apply when front-facing

## v1.1.0 - 1/28/26

### Improvements

- Add ESM module build option. See [installation](/guide/installation) for instructions.
- Added new "Choppy" and "Sea of Thieves" presets
- Replaced ocean floor textures with procedurally generated texture to reduce build size (now ~50KB zipped). See [`OceanFloor`](/api/ocean-floor) documentation for more details.
- Added proper support for different sky providers and cube maps
- Minor tweaks to all presets to improve look and feel
- Improved organization and layout of the docs

### Bug Fixes

- [DEMO] Fixed some settings not being applied when switching presets
- [DEMO] Fixed underwater controls not working
- [LIB] Added missing `turbidity` calculation to sky shader
- [LIB] Removed unused settings from presets (all debug settings, `wave.amplitudeScale`, `wave.scale`
- [LIB] Removed per-cascade `enabled` and `resolution` settings in the presets; this is handled by the quality settings.

## v1.0.0 - 1/27/26

Initial release
