# Trace composite test matrix

Headed Chrome (WebGPU) runs of the trace composite against the baked test
products in `bake-cache/` (served by `../harness.mjs`). Build model-viewer
first (`npm run build:dev`) and apply `npm run patch:deps`.

    HEADLESS=0 MODELS=montana,aquila,triton node trace-modes/run.mjs
    HEADLESS=0 RESUME=orbit MODELS=montana node trace-modes/run.mjs   # orbit + env extras only
    HEADLESS=0 node trace-modes/page-shot.mjs                         # example page screenshot

Output goes to `out/trace-modes/`: `shots/<model>__<angle>__<mode>__<view>__<excl>__<samples>.png`
and `manifest-<models>.json` (shot metadata + per-run timings from
`pathTracerStats`). Env: `CAMS`, `MODES` (full, shadows-normal, shadows-fast,
lighting), `EXCLS` (none, semi, semi-cast), `SAMPLES` (16), `BOUNCES` (8),
`EXTRAS=0` to skip sample/orbit/env extras.
