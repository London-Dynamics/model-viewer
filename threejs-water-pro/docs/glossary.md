# Glossary

Ocean simulation and rendering terminology used in Three.js Water Pro.

## Wave Physics

### Amplitude
The height of a wave from its rest position to its peak (or trough). In Three.js Water Pro, controlled by `water.waves.amplitude` (a global multiplier affecting both FFT cascades and Gerstner waves).

### Cascade
A frequency band of the FFT simulation. Three.js Water Pro uses two cascades:
- **Waves**: Medium-frequency, wind-driven waves
- **Ripples**: High-frequency, small-scale surface detail

Large-scale swells are handled analytically by [Gerstner waves](/api/gerstner).

### Choppiness
Horizontal displacement of wave peaks that creates the characteristic "chopping" motion of ocean waves. Higher choppiness creates steeper, more peaked waves.

### Dispersion Relation
The mathematical relationship between wave frequency and wavelength. In deep water: ω² = gk, where ω is angular frequency, g is gravity, and k is wavenumber.

### FFT (Fast Fourier Transform)
Algorithm for efficiently computing the discrete Fourier transform. Used to convert wave spectrum (frequency domain) to displacement map (spatial domain).

### Frequency
How often a wave oscillates per unit time (or distance). Higher frequency = more waves per second (or meter).

### JONSWAP
Joint North Sea Wave Project - a spectral model for ocean waves based on measurements from the North Sea. Produces realistic wave patterns based on wind speed and fetch length.

### Spectrum
Distribution of wave energy across frequencies. The JONSWAP spectrum defines how much energy exists at each wavelength based on wind conditions.

### Wavelength
Distance between successive wave crests. Longer wavelengths travel faster in deep water.

## Rendering

### Clipmap
A level-of-detail (LOD) technique using nested grids of decreasing resolution. Each level is centered on the camera, providing high detail nearby and lower detail at distance.

### Displacement
Moving vertices from their original positions. The water surface is a flat plane with vertices displaced by FFT-computed wave heights.

### Fresnel Effect
The phenomenon where surfaces become more reflective at grazing angles. Water appears more reflective when you look across it (horizon) than when you look straight down.

### HDR (High Dynamic Range)
Color values that exceed the standard 0-1 range. Used for realistic lighting where bright areas (sun, reflections) can be much brighter than dark areas.

### Jacobian
A matrix of partial derivatives. For water, the Jacobian determinant indicates surface compression/expansion. Negative Jacobian means wave folding (breaking).

### LOD (Level of Detail)
Technique for using simpler geometry/textures at distance to improve performance while maintaining visual quality nearby.

### Normal Map
A texture that stores surface normals, allowing flat geometry to appear to have fine detail. Used for wave surface detail in the fragment shader.

### Schlick Approximation
Simplified formula for Fresnel reflectance: F = F₀ + (1-F₀)(1-cosθ)⁵. Used for fast, physically-plausible reflections.

### Tone Mapping
Converting HDR values to displayable LDR (0-1) range. ACES Filmic tone mapping is recommended for realistic results.

### TSL (Three Shading Language)
Three.js node-based shader system for WebGPU. Allows writing shaders as JavaScript function graphs that compile to WGSL.

## Optical Effects

### Caustics
Patterns of light on the ocean floor caused by refraction through the wavy water surface. Creates moving bright lines where light is focused.

### Mie Scattering
Light scattering by particles comparable to the light's wavelength (aerosols, dust). Creates the glow around the sun and atmospheric haze.

### Rayleigh Scattering
Light scattering by molecules much smaller than the light's wavelength. Short wavelengths (blue) scatter more, creating blue skies.

### Refraction
Bending of light as it passes between materials with different refractive indices (air to water). Creates the distorted view through water.

### Snell's Window
The circular window of clear view when looking up through water. Outside this window (~97°), total internal reflection occurs.

### SSS (Subsurface Scattering)
Light that penetrates a translucent material and scatters before exiting. Creates the glowing effect in backlit wave crests.

### TIR (Total Internal Reflection)
When light traveling from a denser medium (water) hits a less dense medium (air) at a shallow angle, it reflects entirely instead of refracting. Creates mirror-like underwater surface outside Snell's window.

## Atmosphere

### Azimuth
Horizontal angle, typically measured from north (or +Z axis in Three.js). Sun azimuth determines the horizontal position of the sun around the horizon.

### Elevation
Vertical angle above the horizon. Sun elevation of 0° is at the horizon, 90° is directly overhead.

### FBM (Fractal Brownian Motion)
Noise technique that sums multiple octaves of noise at increasing frequencies and decreasing amplitudes. Creates natural-looking procedural patterns like clouds.

### Turbidity
Measure of atmospheric clarity. Higher turbidity means more particles in the atmosphere, creating hazier conditions and washing out colors.

## Physics

### Buoyancy
Upward force on an object submerged in fluid, equal to the weight of displaced fluid. In Three.js Water Pro, objects float based on sampled water height.

### IOR (Index of Refraction)
Ratio of light speed in vacuum to light speed in a material. Water has IOR ≈ 1.33, meaning light travels 1.33x slower in water than in vacuum.

### SmoothDamp
Animation technique using a critically damped spring for smooth motion without oscillation. Used for buoyancy to create natural floating motion.

## Quality

### Quality Tier
Predefined configuration balancing visual quality and performance:
- **Low**: Basic waves, minimal effects
- **Medium**: Good waves, essential effects
- **High**: Full waves, all effects
- **Ultra**: Maximum resolution

### Resolution
Number of points in the FFT grid. Higher resolution captures more wave detail but uses more GPU resources. Common values: 32, 64, 128, 256, 512.
