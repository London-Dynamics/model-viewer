# Progressive bake capture

Headless captures for the progressive path tracer: contact shadow, texture AO, probes, and the white-material AO comparison against a 2-bounce trace.

Models and HDRs are downloaded on first run. They are not stored in git.

| Scene | Model | Environment |
| --- | --- | --- |
| Aquila 45 Sport | [default GLB](https://assets.v2.londondynamics.com/019e4651-0c20-7aa0-a5f4-789b9df05fd0/puzzle/49cdcf76-f547-483d-60d6-640a65b436e3.glb) | [photo_studio_01_1k.hdr](https://assets.v2.londondynamics.com/00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000/environments/photo_studio_01_1k.hdr) |
| Triton Master Scene V3 | [default GLB](https://assets.v2.londondynamics.com/547e0656-5fe2-4a43-aae0-6b39d3a4ee3a/puzzle/7a414066-17c9-a339-a068-ea4c8c37fbb5.glb) | [dancing_hall_2k_desat.hdr](https://assets.v2.londondynamics.com/00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000/environments/dancing_hall_2k_desat.hdr) |
| Montana 001112 (2027) | [default GLB](https://assets.v2.londondynamics.com/28d24461-579e-4156-99c4-ca336f4369db/puzzledefault/8daea_4e25777e-91ff-80c3-872f-c722d4937c36.glb) | [Centurion-2.hdr](https://d1mepjfmhz5ui7.cloudfront.net/centurion/Centurion-2.hdr) |

Montana's preset HDR is published on the Centurion CDN, not under `assets.v2`. Aquila's night HDR for the light close-up is [evening_road_01_puresky_4k.hdr](https://assets.v2.londondynamics.com/00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000/environments/evening_road_01_puresky_4k.hdr). Set `lightsModel` on a scene in `scenes.json` when a lights-on GLB has a public URL. Until then the light stages use the default model.

Build the viewer once so `dist/model-viewer.js` exists:

```bash
cd packages/model-viewer
npm run build:dev
```

## Graphics backend

`GL_BACKEND` selects Chrome's WebGL backend. The default is `gpu`.

| Value | What it uses |
| --- | --- |
| `gpu` | ANGLE on native GL. This is the real GPU path. |
| `angle` | ANGLE default backend, software rasterizer disabled. |
| `vulkan` | ANGLE on Vulkan. Use this on a headless Linux GPU if `gpu` falls back to software. |
| `swiftshader` | ANGLE SwiftShader. Software GL for machines with no GPU. |

`CHROME_PATH` overrides the Chrome binary. Downloads go to `scripts/progressive-bake/cache` (`BAKE_CACHE`). Frames go to `scripts/progressive-bake/out` (`BAKE_OUT`).

## AO accuracy comparison

White materials, texture AO only, then the same cameras as a 16-sample 2-bounce trace. `KIND=uniform` swaps the scene HDR for a flat white environment so the score is occlusion, not a key light.

```bash
cd packages/model-viewer
GL_BACKEND=gpu SCENE=montana KIND=baked node scripts/progressive-bake/ao-compare.mjs
GL_BACKEND=gpu SCENE=montana KIND=uniform node scripts/progressive-bake/ao-compare.mjs
GL_BACKEND=gpu SCENE=montana KIND=trace node scripts/progressive-bake/ao-compare.mjs
python3 scripts/progressive-bake/ao-error.py
```

Omit `SCENE` to run Aquila, Triton, and Montana. The pass bar is mean error <= 0.08 and p95 error <= 0.18. Sheets and 100% crops land in `out/sheets/`.

## Full progression

Realtime, shader AO, contact shadow, texture AO, light layers, probes, and a short trace:

```bash
GL_BACKEND=gpu SCENE=triton STAGE=ao node scripts/progressive-bake/render-progressive.mjs
```

Omit `SCENE` and `STAGE` for every stage. Timings are appended to `out/timings.json`.
