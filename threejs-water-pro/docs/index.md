---
layout: home

hero:
  name: Three.js Water Pro
  tagline: Real-time, physically-based ocean rendering for Three.js WebGPU
  actions:
    - theme: brand
      text: Get Started
      link: /guide/installation

features:
  - icon: 🌊
    title: FFT-Based Waves
    details: JONSWAP spectrum with 2 cascades (waves, ripples) plus analytical Gerstner swells for realistic ocean behavior at any scale.
  - icon: ⚡
    title: WebGPU Compute
    details: Built with WebGPU and Three.js TSL (Three Shading Language) for modern GPU acceleration and optimal performance.
  - icon: 🎨
    title: 8 Environment Presets
    details: From violent storms to serene - ready-to-use configurations for different ocean environments and moods.
  - icon: 🚢
    title: Buoyancy Physics
    details: GPU-accelerated water sampling for realistic floating objects with multi-point hull support.
  - icon: 🌅
    title: Procedural Sky
    details: Rayleigh scattering atmosphere with animated clouds, sunset coloring, and dynamic sun disc.
  - icon: 🐠
    title: Underwater Effects
    details: Physically-accurate underwater lighting with reflection, refraction, caustics, and fog.
---

## Why Three.js Water Pro?

This library provides a complete ocean rendering solution built specifically for Three.js WebGPU. Unlike traditional approaches that rely on noise-based wave approximations, Three.js Water Pro uses FFT (Fast Fourier Transform) to generate physically accurate ocean waves based on real oceanographic research.

### Key Features

- **Multi-cascade FFT simulation** - Two FFT frequency bands (waves, ripples) plus analytical Gerstner swells combine for detail at all distances
- **JONSWAP spectrum** - Scientifically accurate wave generation based on wind conditions
- **Subsurface scattering** - Light transmission through wave crests for that characteristic ocean glow
- **Foam rendering** - Jacobian-based wave breaking detection plus procedural surface foam
- **Infinite water** - Clipmap geometry with LOD for seamless ocean rendering to the horizon
- **Full underwater support** - Dive below the surface with realistic refraction and caustics

## Requirements

- Three.js r181.0 or later (WebGPU build)
- WebGPU-capable browser (Chrome 113+, Edge 113+, or Firefox Nightly)
- ES2020+ module support

## License

See license agreement [here](license.md)
