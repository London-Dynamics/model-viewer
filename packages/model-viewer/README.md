# `<model-viewer>`

 [![Min Zip](https://badgen.net/bundlephobia/minzip/@google/model-viewer)](https://bundlephobia.com/result?p=@google/model-viewer)
 [![Latest Release](https://img.shields.io/github/v/release/google/model-viewer)](https://github.com/google/model-viewer/releases)
 [![NPM Package](https://img.shields.io/npm/v/@google/model-viewer)](https://www.npmjs.com/package/@google/model-viewer)

 [![follow on Twitter](https://img.shields.io/twitter/follow/modelviewer?style=social&logo=twitter)](https://twitter.com/intent/follow?screen_name=modelviewer)
 [![Github Discussions](https://img.shields.io/github/stars/google/model-viewer.svg?style=social&label=Star&maxAge=2592000)](https://github.com/google/model-viewer/discussions)

`<model-viewer>` is a web component that makes rendering interactive 3D
models - optionally in AR - easy to do, on as many browsers and devices as possible.
`<model-viewer>` strives to give you great defaults for rendering quality and
performance.

As new standards and APIs become available `<model-viewer>` will be improved
to take advantage of them. If possible, fallbacks and polyfills will be
supported to provide a seamless development experience.

[Demo](https://model-viewer.glitch.me) • [Documentation](https://modelviewer.dev/) • [Quality Comparisons](https://github.khronos.org/glTF-Render-Fidelity/comparison/) (courtesy of Khronos)


## Installing

### NPM

The `<model-viewer>` web component can be installed from [NPM](https://npmjs.org):

```sh
# install peer dependency ThreeJS
npm install three 
# install package
npm install @google/model-viewer
```

Finally, include the `<model-viewer>` script in your project.

```js
import '@google/model-viewer';
```

### CDN

It can also be used directly from various free CDNs such as [jsDelivr](https://www.jsdelivr.com/package/npm/@google/model-viewer) and Google's own [hosted libraries](https://developers.google.com/speed/libraries#model-viewer):

```html
<script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js"></script>
```

For more detailed usage documentation and live examples, please visit our docs
at [modelviewer.dev](https://modelviewer.dev)!

### Important note about versions
Our goal for `<model-viewer>` is to be a consistent, stable part of your web
platform while continuing to deliver cutting-edge features. We’ll always try
to minimize breaking changes, and to keep the component backwards compatible.
See our [guide to contributing](../../CONTRIBUTING.md#Stability) for more
information on backwards compatibility.

For your production site you may want the extra stability that comes by
pinning to a specific version, and upgrading on your own schedule (after
testing).

If you’ve installed via [NPM](https://www.npmjs.com/package/@google/model-viewer), you’re all set - you’ll only
upgrade when you run [`npm update`](https://docs.npmjs.com/cli/update.html).
Note that three.js is a peer dependency, so that must also be installed, but can
be shared with other bundled code. Note that `<model-viewer>` requires the
version of three.js we test on to maintain quality, due to frequent upstream
breaking changes. We strongly recommend you keep your three.js version locked to
`<model-viewer>`'s. If you must use a different version, npm will give you an
error which you can work around using their `--legacy-peer-deps` option, which
will allow you to go outside of our version range. Please do not file issues if
you use this option. 

## London Dynamics extensions

This fork ships additional `ld-*` mixins that expose features used across
London Dynamics projects. Alongside the previously documented water, lighting,
camera and measurement utilities, you can now enable real-time ambient occlusion
derived from [Rabbid76/three-js-ao-pass](https://github.com/Rabbid76/three-js-ao-pass).

```html
<model-viewer
  src="Astronaut.glb"
  camera-controls
  ambient-occlusion
  ao-algorithm="gtao"
  ao-radius="5"
  ao-intensity="0.9"
  ao-output="default">
</model-viewer>
```

Key attributes:

* `ambient-occlusion`: master toggle
* `ao-algorithm`: `ssao`, `sao`, `n8ao`, `hbao`, or `gtao`
* `ao-radius`, `ao-intensity`, `ao-bias`, `ao-thickness`, `ao-samples`
* `ao-noise` (`magic-square` or `random`) and `ao-screen-space-radius`
* `ao-output`: `default`, `diffuse`, `ao`, `denoise`, `depth`, `normal`
* Poisson denoise knobs (`ao-denoise-radius`, `ao-denoise-rings`, `ao-denoise-samples`, `ao-denoise-luma-phi`, `ao-denoise-depth-phi`, `ao-denoise-normal-phi`)

The AO mixin will automatically register an internal `EffectComposer`. If you
already provide a custom composer via `registerEffectComposer`, you can integrate
the `AOPass` manually using the same options shown above.

## Browser Support

`<model-viewer>` is supported on the last 2 major versions of all evergreen
desktop and mobile browsers.

|               | <img src="https://github.com/alrra/browser-logos/raw/master/src/chrome/chrome_32x32.png" width="16"> Chrome | <img src="https://github.com/alrra/browser-logos/raw/master/src/firefox/firefox_32x32.png" width="16"> Firefox | <img src="https://github.com/alrra/browser-logos/raw/master/src/safari/safari_32x32.png" width="16"> Safari | <img src="https://github.com/alrra/browser-logos/raw/master/src/edge/edge_32x32.png" width="16"> Edge |
| -------- | --- | --- | --- | --- |
| Desktop  | ✅  | ✅  | ✅  | ✅  |
| Mobile   | ✅  | ✅  | ✅  | ✅  |

`<model-viewer>` builds upon standard web platform APIs so that the performance,
capabilities and compatibility of the library get better as the web evolves.

## Development

To get started, follow the instructions in [the main README.md file](../../README.md).

The following commands are available when developing `<model-viewer>`:

Command                         | Description
------------------------------- | -----------
`npm run build`                 | Builds all `<model-viewer>` distributable files
`npm run build:dev`             | Builds a subset of distributable files (faster than `npm run build`)
`npm run build:pack`            | TypeScript compile only (~2s); enough for `npm pack` into bundler-based host apps
`npm run pack:local`            | Runs `build:pack` and creates a `.tgz` tarball for local install
`npm run test`                  | Run `<model-viewer>` unit tests
`npm run clean`                 | Deletes all build artifacts
`npm run dev`                   | Starts `tsc` and `rollup` in "watch" mode, causing artifacts to automatically rebuild upon incremental changes

### Local tarball for host apps

To test unpublished changes in a host app without running the full production build:

```sh
cd packages/model-viewer
npm run pack:local
```

Then in the host app:

```sh
npm install /path/to/model-viewer/packages/model-viewer/london-dynamics-model-viewer-4.7.4.tgz
```

`build:pack` compiles TypeScript to `lib/` only (~2s). That is sufficient when the host app uses a bundler (Vite, webpack, etc.) and resolves the package via the `module` entry (`lib/model-viewer.js`). It skips rollup entirely, so no `dist/` bundles are included.

Use `npm run build:dev` before packing if you need unminified `dist/` files (e.g. script-tag usage). Use `npm run build` for the full release artifact set.

## Releasing

1. Bump the version in `package.json` and commit (e.g. `4.6.3`).
2. Create and push a matching tag:

```console
git tag v4.6.3
git push origin v4.6.3
```

3. The [release workflow](../../.github/workflows/release-package.yml) will validate the tag, build, test, publish to GitHub Packages, and create a GitHub Release with auto-generated notes.

The tag **must** match `package.json` exactly (`v4.6.3` ↔ `"version": "4.6.3"`). Publishing the same version twice will fail at the registry.

Only strict semver tags (`vX.Y.Z`) trigger a release. Pre-release tags such as `v4.2.0-beta.49` do not.

To re-run manually, use **workflow_dispatch** in the Actions UI and select the tag ref (e.g. `v4.6.3`) — not a branch.

### GitHub settings (one-time, repo admin)

- **Required**: Settings → Actions → General → Workflow permissions → **Read and write permissions**
- **Recommended**: Settings → Tags → protection rule for `v*`
- **No longer needed**: manually creating a GitHub Release before publish

