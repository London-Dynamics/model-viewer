// @ts-nocheck
// clang-format off
/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 * The path integral below is the three-gpu-pathtracer 0.0.27 megakernel
 * (src/webgpu/compute/PathTracerMegaKernel.js, upstream blob 072721fe)
 * with the LD_IRRADIANCE_CACHE blocks added. The npm package stays the
 * source of the wavefront tracer. This file replaces only the megakernel,
 * and only while the irradiance cache is enabled.
 *
 * Licensed under the Apache License, Version 2.0 for the London Dynamics
 * additions. The upstream kernel is MIT, Copyright Garrett Johnson.
 */

import {DataTexture, StorageBufferAttribute, StorageTexture, Vector2, Vector3} from 'three/webgpu';
import {ComputeKernel} from 'three-gpu-pathtracer/src/webgpu/compute/ComputeKernel.js';
import {globalId, sampler, storage, texture, textureStore, uniform} from 'three/tsl';
import {RNG_INDEX_ALPHA_TEST, RNG_INDEX_BACKGROUND_SAMPLE, RNG_INDEX_DIRECT_LIGHT_SAMPLE, RNG_INDEX_DISPERSION_WAVELENGTH, RNG_INDEX_RAY_JITTER, RNG_INDEX_RUSSIAN_ROULETTE, rand1, rand2, rand3, rngInit, rngNextBounce} from 'three-gpu-pathtracer/src/webgpu/nodes/random.wgsl.js';
import {misHeuristicFn, weightedAlphaBlendFn} from 'three-gpu-pathtracer/src/webgpu/nodes/sampling.wgsl.js';
import {proxy, proxyFn, rayStruct, wgslTagFn} from 'three-mesh-bvh/webgpu';
import {clampPathContributionFunc, isTerminatingScatterFunc, offsetRayOriginFunc} from 'three-gpu-pathtracer/src/webgpu/nodes/utils.wgsl.js';
import {lightRecordStruct} from 'three-gpu-pathtracer/src/webgpu/nodes/structs.wgsl.js';
import {ENVIRONMENT_LIGHT_TYPE, LIGHT_EPSILON, LIGHT_FAR_DISTANCE, isMISWeightLightFn} from 'three-gpu-pathtracer/src/webgpu/nodes/lights.wgsl.js';
import {DISPERSION_MAX_WAVELENGTH, DISPERSION_MIN_WAVELENGTH, applyDispersionFunc, dispersionColorWeightFunc, transmissionAttenuationFunc} from 'three-gpu-pathtracer/src/webgpu/nodes/material.wgsl.js';
import {TRANSMISSIVE_BACKGROUND_ENVIRONMENT, TRANSMISSIVE_BACKGROUND_OVERLAY, TRANSMISSIVE_BACKGROUND_TRANSPARENT} from 'three-gpu-pathtracer/src/webgpu/constants.js';

import {IRRADIANCE_SLOT_COUNT} from './path-tracer-irradiance-cache.js';

export class LDIrradianceCacheMegaKernel extends ComputeKernel {

	constructor( ) {

		const cacheAttribute = new StorageBufferAttribute( IRRADIANCE_SLOT_COUNT * 2, 4 );
		const params = {
			bvhData: { value: null },
			material: { value: null },
			envInfo: { value: null },
			lightsInfo: { value: null },

			// targets
			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// tiles
			offset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),

			// settings
			seed: uniform( 0 ),
			maxBounces: uniform( 5 ),
			maxTransparentBounces: uniform( 5, 'uint' ),
			misEnabled: uniform( 1, 'uint' ),
			maxSamples: uniform( 0, 'uint' ),
			filterGlossy: uniform( 1 ),
			clampDirect: uniform( 0 ),
			clampIndirect: uniform( 10 ),

			backgroundInfo: { value: null },

			transmissiveBackground: uniform( TRANSMISSIVE_BACKGROUND_OVERLAY ),

			// LD_IRRADIANCE_CACHE world-space hash grid. Two vec4 slots:
			// irradiance.rgb + weight, then normal.xyz. Hash constants match
			// path-tracer-irradiance-cache.ts (73856093, 19349663, 83492791, 16777619).
			cacheBuffer: storage( cacheAttribute, 'vec4', IRRADIANCE_SLOT_COUNT * 2 ),
			cacheRead: uniform( 0, 'uint' ),
			cacheWrite: uniform( 0, 'uint' ),
			cacheOrigin: uniform( new Vector3() ),
			cacheCellSize: uniform( 1 ),
			cacheMinSamples: uniform( 4, 'uint' ),

			textures: texture( new DataTexture() ),
			textureSampler: sampler( new DataTexture() ),

			// compute variables
			globalId: globalId,
		};

		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxyFn( 'bvhData.value.fns.raycastFirstHit', params );
		const raycastShadowFn = proxyFn( 'bvhData.value.fns.raycastShadow', params );
		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const getSurfaceRecordFn = proxyFn( 'bvhData.value.fns.getSurfaceRecord', params );
		const getCameraRayFn = proxyFn( 'bvhData.value.fns.getCameraRay', params );
		const bsdfSampleFn = proxyFn( 'material.value.bsdfSample', params );
		const bsdfEvalPdfFn = proxyFn( 'material.value.bsdfEvalPdf', params );

		// environment resources
		const envTotalSumNode = proxy( 'envInfo.value.totalSumNode', params );
		const envIntensityNode = proxy( 'envInfo.value.intensityNode', params );
		const sampleEnvColor = proxy( 'envInfo.value.sampleColor', params );
		const sampleEnvDir = proxy( 'envInfo.value.sampleDir', params );
		const getEnvDirPdf = proxy( 'envInfo.value.getDirPdf', params );
		const getEnvWeight = proxy( 'envInfo.value.getWeight', params );
		const sampleBackground = proxy( 'backgroundInfo.value.sampleColor', params );

		// analytic scene lights pulled off the lightsInfo provider ( LightsInfoNode )
		const lightsCountNode = proxy( 'lightsInfo.value.countNode', params );
		const randomLightSampleFn = proxyFn( 'lightsInfo.value.randomLightSample', params );
		const intersectLightAtIndexFn = proxyFn( 'lightsInfo.value.intersectLightAtIndex', params );
		const getLightWeightFn = proxyFn( 'lightsInfo.value.getLightWeight', params );
		const getLightsWeightFn = proxyFn( 'lightsInfo.value.getLightsWeight', params );
		const selectLightFn = proxyFn( 'lightsInfo.value.selectLight', params );
		const isLightVisibleToCameraFn = proxyFn( 'lightsInfo.value.isLightVisibleToCamera', params );

		// Inlined into the kernel. A helper `fn` before `fn compute` becomes the
		// TSL entry point (the parser uses the first function) and the path
		// tracer never runs. Keep this in sync with irradianceSlot().
		const irradianceHashSlot = (slot, cell, normal) => `
				let ${ slot }Cell = ${ cell };
				let ${ slot }Normal = ${ normal };
				let ${ slot }Nqx = select( 0u, 1u, ${ slot }Normal.x >= 0.0 );
				let ${ slot }Nqy = select( 0u, 1u, ${ slot }Normal.y >= 0.0 );
				let ${ slot }Nqz = select( 0u, 1u, ${ slot }Normal.z >= 0.0 );
				let ${ slot }H = ( u32( ${ slot }Cell.x ) * 73856093u ) ^ ( u32( ${ slot }Cell.y ) * 19349663u ) ^ ( u32( ${ slot }Cell.z ) * 83492791u );
				let ${ slot }Nterm = ( ${ slot }Nqx + ${ slot }Nqy * 2u + ${ slot }Nqz * 4u + 1u ) * 16777619u;
				let ${ slot } = ( ${ slot }H ^ ${ slot }Nterm ) & 65535u;
		`;

		const shader = wgslTagFn/* wgsl */`


			fn compute(

				// indices and target
				globalId: vec3u,

				// tiles
				offset: vec2u,
				tileSize: vec2u,

				// settings
				seed: u32,
				maxBounces: u32,
				maxTransparentBounces: u32,
				misEnabled: u32,
				maxSamples: u32,
				filterGlossy: f32,
				clampDirect: f32,
				clampIndirect: f32,

				transmissiveBackground: u32,

			) -> void {

				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };
				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };

				// make sure we don't bleed over the edge of our tile
				if ( globalId.x >= tileSize.x || globalId.y >= tileSize.y ) {

					return;

				}

				// to screen coordinates
				let indexUV = offset + globalId.xy;
				let targetDimensions = textureDimensions( ${ params.outputTarget } );
				if ( indexUV.x >= targetDimensions.x || indexUV.y >= targetDimensions.y ) {

					return;

				}

				// skip the pixel once it has hit the sample limit
				let sampleCount = textureLoad( ${ params.sampleCountTarget }, indexUV ).r;
				if ( maxSamples != 0u && sampleCount >= maxSamples ) {

					return;

				}

				let uv = vec2f( indexUV ) / vec2f( targetDimensions );
				${ rngInit }( indexUV.xy, seed, 0 );

				// scene ray
				let jitteredUv = uv + ${ rand2 }( ${ RNG_INDEX_RAY_JITTER } ) / vec2f( targetDimensions );
				var ray: ${ rayStruct };
				if ( ! ${ getCameraRayFn }( jitteredUv, vec2f( targetDimensions ), &ray ) ) {

					return;

				}

				ray.direction = normalize( ray.direction );

				var resultColor = vec4f( 0, 0, 0, 1 );
				var throughputColor = vec3f( 1.0 );
				var bsdfPdf = 0.0;
				var isFullyTransmissive = true;
				var minPdf = 1.0;
				var transparentBounce = 0u;
				// A negative value marks a sampled wavelength whose RGB reconstruction weight has not been applied yet.
				var dispersionWavelength = - mix( ${ DISPERSION_MIN_WAVELENGTH }.0, ${ DISPERSION_MAX_WAVELENGTH }.0, ${ rand1 }( ${ RNG_INDEX_DISPERSION_WAVELENGTH } ) );

				// one-sample NEE chooses between the analytic lights and the environment
				let envActive = ${ envTotalSumNode } > 0.0 && ${ envIntensityNode } > 0.0;
				let lightsCount = ${ lightsCountNode };
				var envWeight = 0.0;
				if ( envActive ) {

					envWeight = ${ getEnvWeight }();

				}

				// added last, since a camera ray miss overwrites the pixel with the background
				var lightHits = vec3f( 0.0 );
				var cameraHitLight = false;
				var ldPrimaryAlbedo = vec3f( 0.0 );
				var ldPrimaryNormal = vec3f( 0.0 );
				var ldPrimaryCell = vec3i( 0 );
				var ldPrimaryCache = false;
				var ldPrimaryCacheHit = false;

				for ( var bounce = 0u; bounce < maxBounces; bounce ++ ) {

					var hitResult: ${ raycastOutput };
					let didHit = ${ raycastFirstHitFn }( ray, &hitResult );
					let surfaceDist = select( ${ LIGHT_FAR_DISTANCE }, hitResult.dist, didHit );

					// NEE's total weight at the vertex this ray left, for MIS. Camera rays have none
					let isMISWeighted = misEnabled != 0u && bounce > 0u;
					var lightTotalWeight = 0.0;
					if ( isMISWeighted ) {

						lightTotalWeight = ${ getLightsWeightFn }( ray.origin ) + envWeight;

					}

					// forward hits on area lights. Camera rays only see visibleToCameraRays lights, at full weight
					for ( var li = 0u; li < lightsCount; li ++ ) {

						if ( bounce == 0u && ! ${ isLightVisibleToCameraFn }( li ) ) {

							continue;

						}

						var lightRec: ${ lightRecordStruct };
						if ( ${ intersectLightAtIndexFn }( ray.origin, ray.direction, li, &lightRec ) && lightRec.dist < surfaceDist ) {

							var misWeight = 1.0;
							if ( isMISWeighted ) {

								let selectionPdf = ${ getLightWeightFn }( li, ray.origin ) / lightTotalWeight;
								misWeight = ${ misHeuristicFn }( bsdfPdf, lightRec.pdf * selectionPdf );

							}

							lightHits += ${ clampPathContributionFunc }( lightRec.emission * throughputColor * misWeight, bounce, clampDirect, clampIndirect );
							cameraHitLight = cameraHitLight || bounce == 0u;

						}

					}

					if ( didHit ) {

						let objectInfo = transforms[ hitResult.objectIndex ];
						var materialInfo = ( *materials )[ objectInfo.materialIndex ];

						// The wavefront kernels own the holdout (shadow ratio and
						// subject reflection). This backend is the bench
						// megakernel: a primary matte hit stays transparent
						// rather than shading a floor card.
						if ( materialInfo.matte != 0 && bounce == 0u ) {

							resultColor = vec4f( 0.0 );
							break;

						}

						// apply per-object colors
						materialInfo.color *= objectInfo.color.rgb;
						materialInfo.opacity *= objectInfo.color.a;

						let view = - ray.direction;
						var vertexData = ${ sampleTrianglePointFn }( hitResult.barycoord, hitResult.indices.xyz );
						vertexData.normal = normalize( transpose( objectInfo.inverseMatrixWorld ) * vertexData.normal );
						vertexData.tangent = vec4f( ( objectInfo.matrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w );
						vertexData.position = objectInfo.matrixWorld * vertexData.position;

						// blur glossy surfaces after low-probability bounces to suppress fireflies,
						// from the Cycles "filter glossy" approach in integrator/surface_shader.h
						// The smallest pdf seen along the path for the glossy filter is tracked below
						let blurRoughness = sqrt( clamp( 1.0 - filterGlossy * minPdf, 0.0, 1.0 ) ) * 0.5;

						var surface = ${ getSurfaceRecordFn }( materialInfo, vertexData, hitResult.side, hitResult.normal, view, blurRoughness );

						// Stochastically pass through partially transparent surfaces by restarting
						// the ray at the hit point, advancing the rng but not the bounce count.
						if ( ${ rand1 }( ${ RNG_INDEX_ALPHA_TEST } ) > surface.opacity ) {

							// stop once the transparent bounces run out
							if ( transparentBounce >= maxTransparentBounces ) {

								break;

							}

							ray.origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, ray.direction, hitResult.normal );
							${ rngNextBounce }();
							transparentBounce ++;
							bounce --;
							continue;

						}

						// LD_IRRADIANCE_CACHE: diffuse primary hits reuse world-space
						// irradiance and shade it with the current albedo, so a pure
						// colour change does not need a new grid.
						if ( bounce == 0u && ( ${ params.cacheRead } != 0u || ${ params.cacheWrite } != 0u ) ) {

							let ldDiffuse = surface.roughness >= 0.35 && surface.metalness <= 0.25 && surface.transmission <= 0.05 && dot( surface.emission, vec3f( 1.0 ) ) <= 0.001;
							if ( ldDiffuse ) {

								let ldAlbedo = max( surface.color, vec3f( 0.04 ) );
								let ldCell = vec3i( floor( ( vertexData.position.xyz - ${ params.cacheOrigin } ) / ${ params.cacheCellSize } ) );
								${ irradianceHashSlot('ldSlot', 'ldCell', 'vertexData.normal.xyz') }
								ldPrimaryAlbedo = ldAlbedo;
								ldPrimaryNormal = vertexData.normal.xyz;
								ldPrimaryCell = ldCell;
								ldPrimaryCache = true;
								if ( ${ params.cacheRead } != 0u ) {

									let ldBase = ldSlot * 2u;
									let ldIrr = ${ params.cacheBuffer }[ ldBase ];
									let ldNrm = ${ params.cacheBuffer }[ ldBase + 1u ];
									if ( ldIrr.w >= f32( ${ params.cacheMinSamples } ) && dot( normalize( ldNrm.xyz ), vertexData.normal.xyz ) > 0.5 ) {

										resultColor = vec4f( ldAlbedo * ldIrr.xyz, surface.opacity );
										lightHits = vec3f( 0.0 );
										cameraHitLight = false;
										ldPrimaryCacheHit = true;
										break;

									}

								}

							}

						}

						let isDispersive = materialInfo.dispersion > 0.0 && surface.ior > 1.0 && surface.transmission > 0.0 && ! surface.thinWall;
						if ( isDispersive ) {

							let wavelength = abs( dispersionWavelength );
							${ applyDispersionFunc }( &surface, materialInfo.dispersion, wavelength );
							if ( dispersionWavelength < 0.0 ) {

								dispersionWavelength = wavelength;
								throughputColor *= ${ dispersionColorWeightFunc }( wavelength );

							}

						}

						// attenuate the light transmitted through the volume when exiting a backface
						if ( hitResult.side < 0.0 && materialInfo.transmission > 0.0 ) {

							throughputColor *= ${ transmissionAttenuationFunc }( hitResult.dist, materialInfo.attenuationColor, materialInfo.attenuationDistance );

						}

						// emission, clamped at the depth of the segment that found it, as in Cycles
						let emission = ${ clampPathContributionFunc }( throughputColor * surface.emission, bounce, clampDirect, clampIndirect );
						resultColor += vec4f( emission, 0.0 );

						// next event estimation: choose one light or the environment by its estimated
						// contribution
						if ( misEnabled != 0u ) {

							let ruv = ${ rand3 }( ${ RNG_INDEX_DIRECT_LIGHT_SAMPLE } );
							var selectionPdf = 0.0;
							let lightIndex = ${ selectLightFn }( vertexData.position.xyz, envWeight, ruv.x, &selectionPdf );
							if ( selectionPdf > 0.0 ) {

								var lightRec: ${ lightRecordStruct };
								if ( envActive && lightIndex == lightsCount ) {

									// the environment, sampled from its CDF, as a light of kind ENVIRONMENT
									let envSample = ${ sampleEnvDir }( ruv.yz );
									lightRec.direction = envSample.direction;
									lightRec.emission = envSample.color;
									lightRec.pdf = envSample.pdf;
									lightRec.dist = ${ LIGHT_FAR_DISTANCE };
									lightRec.lightType = ${ ENVIRONMENT_LIGHT_TYPE };

								} else {

									lightRec = ${ randomLightSampleFn }( lightIndex, vertexData.position.xyz, ruv.yz );

								}

								if ( lightRec.pdf > 0.0 ) {

									let evalRec = ${ bsdfEvalPdfFn }( view, lightRec.direction, surface );
									if ( evalRec.pdf > 0.0 ) {

										var shadowRay: ${ rayStruct };
										shadowRay.origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, lightRec.direction, hitResult.normal );
										shadowRay.direction = lightRec.direction;
										shadowRay.maxDist = lightRec.dist * ( 1.0 - ${ LIGHT_EPSILON } );

										// opaque occlusion up to the light distance. A shadow-specific any hit
										// traversal could support tinted shadows from transmissive and partially
										// opaque objects
										var shadowHit: ${ raycastOutput };
										let occluded = ${ raycastShadowFn }( shadowRay, &shadowHit );
										if ( ! occluded ) {

											let lightPdf = lightRec.pdf * selectionPdf;

											// env + area lights are also bsdf-sampled, so MIS-weight them - punctual lights take full weight,
											// or when a bsdf ray could never reach the light
											let isMISWeighted = ${ isMISWeightLightFn }( lightRec.lightType ) && ! shadowHit.forwardBlocked;
											let misWeight = select( 1.0, ${ misHeuristicFn }( lightPdf, evalRec.pdf ), isMISWeighted );
											let directLight = throughputColor * lightRec.emission * evalRec.color * misWeight / lightPdf;
											let contribution = ${ clampPathContributionFunc }( directLight, bounce + 1u, clampDirect, clampIndirect );
											resultColor += vec4f( contribution, 0.0 );

										}

									}

								}

							}

						}

						let scatterRec = ${ bsdfSampleFn }( view, surface );
						if ( ${ isTerminatingScatterFunc }( scatterRec ) ) {

							break;

						}

						isFullyTransmissive = isFullyTransmissive && scatterRec.isTransmissive;

						// track the smallest pdf seen along the path for the glossy filter
						minPdf = min( minPdf, scatterRec.pdf );

						// russian roulette early out:
						// Matches Cycles path_state_continuation_probability in integrator/path_state.h
						if ( bounce >= 3u ) {

							let rrThroughput = throughputColor * scatterRec.color / scatterRec.pdf;
							let rrProb = saturate( sqrt( max( max( rrThroughput.r, rrThroughput.g ), rrThroughput.b ) ) );
							if ( rrProb <= 0.0 || ${ rand1 }( ${ RNG_INDEX_RUSSIAN_ROULETTE } ) > rrProb ) {

								break;

							}

							throughputColor /= rrProb;

						}

						throughputColor *= scatterRec.color;
						throughputColor /= scatterRec.pdf;
						bsdfPdf = scatterRec.pdf;

						// exit if our throughput is 0.0
						if ( all( throughputColor == vec3f( 0.0 ) ) ) {

							break;

						}

						ray.origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, scatterRec.direction, hitResult.normal );
						ray.direction = scatterRec.direction;
						ray.maxDist = 0.0;

					} else {

						if ( bounce > 0u && ! isFullyTransmissive ) {

							var misWeight = 1.0;
							if ( isMISWeighted && envActive ) {

								// match the env pdf scaling used by the NEE selection so the two estimators balance
								let envPdf = ${ getEnvDirPdf }( ray.direction ) * envWeight / lightTotalWeight;
								misWeight = ${ misHeuristicFn }( bsdfPdf, envPdf );

							}

							let environment = ${ sampleEnvColor }( ray.direction ).rgb * throughputColor * misWeight;
							let contribution = ${ clampPathContributionFunc }( environment, bounce, clampDirect, clampIndirect );
							resultColor += vec4f( contribution, 0.0 );

						} else {

							// hit the background
							// support multiple transparent background blending techniques
							let rng = ${ rand2 }( ${ RNG_INDEX_BACKGROUND_SAMPLE } );
							let bg = ${ sampleBackground }( ray.direction, rng );
							if ( bounce == 0u ) {

								// sample the background directly if this is the primary ray
								let background = ${ clampPathContributionFunc }( bg.a * bg.rgb, bounce, clampDirect, clampIndirect );
								resultColor = vec4f( background, bg.a );

							} else {

								// transmissive ray handling
								let env = ${ sampleEnvColor }( ray.direction );
								let avg = saturate( dot( throughputColor, vec3f( 1.0 / 3.0 ) ) );
								let transparency = ( 1.0 - bg.a ) * avg;
								var envMisWeight = 1.0;
								if ( misEnabled != 0u && ${ envTotalSumNode } > 0.0 ) {

									let envPdf = ${ getEnvDirPdf }( ray.direction );
									envMisWeight = ${ misHeuristicFn }( bsdfPdf, envPdf );

								}

								if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_ENVIRONMENT }u ) {

									// display the env map through transmissive surfaces
									let background = ${ clampPathContributionFunc }( env.rgb * throughputColor * envMisWeight, bounce, clampDirect, clampIndirect );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0,
									);

								} else if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_TRANSPARENT }u ) {

									// fade the background by the throughput color average
									let background = ${ clampPathContributionFunc }( bg.a * bg.rgb * throughputColor * envMisWeight, bounce, clampDirect, clampIndirect );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0 - transparency,
									);

								} else {

									// fade the background by the throughput color average, mixing in env lighting
									var light = mix( env.rgb, bg.rgb, bg.a ) * envMisWeight;
									let background = ${ clampPathContributionFunc }( light * throughputColor, bounce, clampDirect, clampIndirect );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0 - transparency,
									);

								}

							}

						}

						break;

					}

					${ rngNextBounce }();

				}

				// visible lights are opaque against a transparent background
				resultColor += vec4f( lightHits, 0.0 );
				if ( cameraHitLight ) {

					resultColor.a = 1.0;

				}

				// LD_IRRADIANCE_CACHE write: store lighting with albedo divided out.
				if ( ${ params.cacheWrite } != 0u && ldPrimaryCache && ! ldPrimaryCacheHit ) {

					let ldIrradiance = resultColor.rgb / ldPrimaryAlbedo;
					${ irradianceHashSlot('ldWriteSlot', 'ldPrimaryCell', 'ldPrimaryNormal') }
					let ldBase = ldWriteSlot * 2u;
					let ldPrev = ${ params.cacheBuffer }[ ldBase ];
					let ldWeight = ldPrev.w;
					let ldNextWeight = ldWeight + 1.0;
					${ params.cacheBuffer }[ ldBase ] = vec4f( ( ldPrev.xyz * ldWeight + ldIrradiance ) / ldNextWeight, ldNextWeight );
					let ldPrevN = ${ params.cacheBuffer }[ ldBase + 1u ].xyz;
					let ldNextN = select( ldPrimaryNormal, normalize( ldPrevN * ldWeight + ldPrimaryNormal ), ldWeight > 0.0 );
					${ params.cacheBuffer }[ ldBase + 1u ] = vec4f( ldNextN, 0.0 );

				}

				let nextSampleCount = sampleCount + 1;
				// store the color rows top down to match a rasterized render target
				let colorIndex = vec2u( indexUV.x, targetDimensions.y - 1u - indexUV.y );

				let prevColor = textureLoad( ${ params.prevOutputTarget }, colorIndex );
				let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( nextSampleCount ) );
				textureStore( ${ params.sampleCountTarget }, indexUV, vec4( nextSampleCount ) );
				textureStore( ${ params.outputTarget }, colorIndex, blendedColor );

			}`;

		super( shader( params ) );

		this.defineUniformAccessors( params );
		this.cacheAttribute = cacheAttribute;

	}

}
