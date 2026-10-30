# Local dependency patches

Minimal, isolated patches applied on top of pinned dependencies. The dependency
versions are unchanged; `node scripts/apply-dependency-patches.mjs` (also
`npm run patch:deps`) applies every `patches/<package>+<version>+<name>.patch`
to `node_modules/<package>` when the installed version matches, and skips
patches that are already applied. Run it after `npm install`, before a build.

## three-gpu-pathtracer+0.0.27+max-ray-distance.patch

Adds `WebGPUPathTracer.maxRayDistance` (world units, 0 = unbounded, the
default). On the wavefront backend, bounce rays (not camera rays) and NEE
shadow rays stop at that distance and count as misses. With one bounce on the
white proxy, and the composite's ratio against the untraced proxy cancelling
the environment, the trace is range-limited ambient occlusion: the fast
short-range shadow mode of the trace composite
(`path-tracer-shadow-quality="fast"`, `path-tracer-ao-distance`). With 0
the tracer behaves exactly as upstream 0.0.27.

Files: `src/webgpu/compute/wavefront/TraceRayKernel.js`,
`TraceShadowRayKernel.js`, `src/webgpu/WaveFrontPathTracer.js`,
`src/webgpu/WebGPUPathTracer.js`. The megakernel backend is untouched and
ignores the setting.
