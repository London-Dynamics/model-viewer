import * as THREE from "three/webgpu";
import {
  pass,
  float,
  uv,
  vec2,
  length,
  smoothstep,
  vec3,
  Fn,
  uniform,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { film } from "three/addons/tsl/display/FilmNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import type { WaterSystem, WaterPreset } from "threejs-water-pro";
import type { AntialiasingMode } from "../WaterApp";

export interface PostProcessingUniforms {
  bloom: {
    strength: THREE.UniformNode<number>;
    radius: THREE.UniformNode<number>;
    threshold: THREE.UniformNode<number>;
  };
  filmGrain: {
    intensity: THREE.UniformNode<number>;
  };
  vignette: {
    intensity: THREE.UniformNode<number>;
    smoothness: THREE.UniformNode<number>;
  };
}

export interface PostProcessingContext {
  postProcessing: THREE.PostProcessing;
  uniforms: PostProcessingUniforms;
  scenePass: THREE.PassNode;
}

/**
 * Set up post-processing pipeline with bloom, film grain, vignette, and underwater effects.
 *
 * Note: Fog is handled per-material (water has its own fog, scene objects use FogMaterial).
 */
export function setupPostProcessing(
  renderer: THREE.WebGPURenderer,
  waterSystem: WaterSystem,
  params: WaterPreset,
  antialiasing: AntialiasingMode = "smaa",
): PostProcessingContext {
  const postProcessing = new THREE.PostProcessing(renderer);

  // Create scene pass for main scene
  const scenePass = pass(waterSystem.scene, waterSystem.camera);
  const scenePassColor = scenePass.getTextureNode("output");

  let outputNode: THREE.Node = scenePassColor;

  // Create all uniforms upfront (enabled toggles just set values to 0)
  const bloomConfig = params.postProcessing.bloom;
  const filmConfig = params.postProcessing.filmGrain;
  const vignetteConfig = params.postProcessing.vignette;

  const uniforms: PostProcessingUniforms = {
    bloom: {
      strength: uniform(bloomConfig.enabled ? bloomConfig.strength : 0),
      radius: uniform(bloomConfig.radius),
      threshold: uniform(bloomConfig.threshold),
    },
    filmGrain: {
      intensity: uniform(filmConfig.enabled ? filmConfig.intensity : 0),
    },
    vignette: {
      intensity: uniform(vignetteConfig.enabled ? vignetteConfig.intensity : 0),
      smoothness: uniform(vignetteConfig.smoothness),
    },
  };

  // Apply water post-processing effects (atmospheric fog, underwater haze, distortion)
  outputNode = waterSystem.postProcessing.buildNode(scenePass, outputNode);

  // Anti-aliasing pass - applied AFTER fog to avoid depth blending artifacts at edges
  if (antialiasing === "fxaa") {
    outputNode = fxaa(outputNode);
  } else if (antialiasing === "smaa") {
    outputNode = smaa(outputNode);
  }

  // Bloom pass (strength=0 effectively disables it)
  // BloomNode wraps parameters with uniform() internally, so we create it first
  // then override its internal uniforms with ours for runtime control
  const bloomPass = bloom(outputNode);
  bloomPass.strength = uniforms.bloom.strength;
  bloomPass.radius = uniforms.bloom.radius;
  bloomPass.threshold = uniforms.bloom.threshold;
  outputNode = outputNode.add(bloomPass);

  // Film grain pass (intensity=0 effectively disables it)
  const filmPass = film(outputNode, uniforms.filmGrain.intensity);
  outputNode = filmPass;

  // Vignette pass (intensity=0 effectively disables it)
  const inputNode = outputNode;
  const vignetteIntensity = uniforms.vignette.intensity;
  const vignetteSmoothness = uniforms.vignette.smoothness;
  const vignetteNode = Fn(() => {
    const uvCoord = uv();
    const centered = uvCoord.sub(vec2(0.5, 0.5));
    const dist = length(centered).mul(2.0);
    const innerRadius = float(1.0).sub(vignetteSmoothness);
    const vignette = smoothstep(innerRadius, float(1.0), dist);
    const darkening = float(1.0).sub(vignette.mul(vignetteIntensity));
    return inputNode.mul(vec3(darkening, darkening, darkening));
  })();
  outputNode = vignetteNode;

  postProcessing.outputNode = outputNode;

  return { postProcessing, uniforms, scenePass };
}
