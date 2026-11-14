// @ts-nocheck
// clang-format off
/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 * The body is the three-gpu-pathtracer 0.0.27 wavefront MaterialKernel
 * (src/webgpu/compute/wavefront/MaterialKernel.js) with one LD block: a
 * secondary hit can read the irradiance grid and end the path. A miss
 * marks the path so the logic kernel writes albedo-divided irradiance
 * when the path finishes. Primary hits stay exact, and so does the next
 * vertex after a sharp, metal, or transmissive primary scatter.
 *
 * Licensed under the Apache License, Version 2.0 for the London Dynamics
 * additions. The upstream kernel is MIT, Copyright Garrett Johnson.
 */

import {Vector2, Vector3} from 'three';
import {StorageBufferAttribute, StorageTexture} from 'three/webgpu';
import {ComputeKernel} from 'three-gpu-pathtracer/src/webgpu/compute/ComputeKernel.js';
import {uniform, storage, textureStore, globalId} from 'three/tsl';
import {proxy, proxyFn, rayStruct, wgslTagFn} from 'three-mesh-bvh/webgpu';
import {rngInit, rand1, rand2, RNG_INDEX_RAY_JITTER, RNG_INDEX_ALPHA_TEST, RNG_INDEX_RUSSIAN_ROULETTE, RNG_INDEX_DISPERSION_WAVELENGTH} from 'three-gpu-pathtracer/src/webgpu/nodes/random.wgsl.js';
import {sampleHemisphereFn} from 'three-gpu-pathtracer/src/webgpu/nodes/sampling.wgsl.js';

import {rayDataStruct, rayQueueAtomicStruct, pixelQueueStruct} from 'three-gpu-pathtracer/src/webgpu/compute/wavefront/structs.js';
import {SAMPLE_ACTIVE_FLAG, SAMPLE_COUNT_MASK, SAMPLE_DISPATCHED_FLAG} from 'three-gpu-pathtracer/src/webgpu/constants.js';
import {applyDispersionFunc, dispersionColorWeightFunc, DISPERSION_MIN_WAVELENGTH, DISPERSION_MAX_WAVELENGTH, transmissionAttenuationFunc} from 'three-gpu-pathtracer/src/webgpu/nodes/material.wgsl.js';
import {isTerminatingScatterFunc, offsetRayOriginFunc} from 'three-gpu-pathtracer/src/webgpu/nodes/utils.wgsl.js';
import {ENVIRONMENT_LIGHT_TYPE, LIGHT_EPSILON, LIGHT_FAR_DISTANCE} from 'three-gpu-pathtracer/src/webgpu/nodes/lights.wgsl.js';

import {IRRADIANCE_PATH_RECORDS, IRRADIANCE_PATH_SLOTS, IRRADIANCE_SLOT_COUNT} from './path-tracer-irradiance-cache.js';

// Inlined into fn compute. A helper fn before it becomes the TSL entry point.
const irradianceHashSlot = (slot, cell, normal) => `
				let ${slot}Cell = ${cell};
				let ${slot}Normal = ${normal};
				let ${slot}Nqx = select( 0u, 1u, ${slot}Normal.x >= 0.0 );
				let ${slot}Nqy = select( 0u, 1u, ${slot}Normal.y >= 0.0 );
				let ${slot}Nqz = select( 0u, 1u, ${slot}Normal.z >= 0.0 );
				let ${slot}H = ( u32( ${slot}Cell.x ) * 73856093u ) ^ ( u32( ${slot}Cell.y ) * 19349663u ) ^ ( u32( ${slot}Cell.z ) * 83492791u );
				let ${slot}Nterm = ( ${slot}Nqx + ${slot}Nqy * 2u + ${slot}Nqz * 4u + 1u ) * 16777619u;
				let ${slot} = ( ${slot}H ^ ${slot}Nterm ) & 65535u;
`;

// Secondary hits reuse world-space irradiance. Everything else is the
// stock material kernel: terminated slots pull a recycled pixel and emit a
// camera ray; live slots sample the bsdf and enqueue the next bounce.
export class LDIrradianceCacheMaterialKernel extends ComputeKernel {

	constructor(cacheAttribute = new StorageBufferAttribute(IRRADIANCE_SLOT_COUNT * 2, 4), pathRecords = new StorageBufferAttribute(IRRADIANCE_PATH_SLOTS * IRRADIANCE_PATH_RECORDS, 4)) {
		const params = {
			bvhData: { value: null },
			material: { value: null },

			seed: uniform( 0, 'uint' ),
			targetDimensions: uniform( new Vector2() ),
			maxSamples: uniform( 0, 'uint' ),
			rayCount: uniform( 0, 'uint' ),
			filterGlossy: uniform( 1 ),
			maxTransparentBounces: uniform( 5, 'uint' ),
			maxBounces: uniform( 5, 'uint' ),

			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueAtomicStruct ),
			shadowRayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueAtomicStruct ),
			pixelQueue: storage( new StorageBufferAttribute( 1, 1 ), pixelQueueStruct ),

			// Two vec4 slots per hash: irradiance.rgb + weight, then normal.xyz.
			cacheBuffer: storage( cacheAttribute, 'vec4', IRRADIANCE_SLOT_COUNT * 2 ),
			cacheRead: uniform( 0, 'uint' ),
			cacheWrite: uniform( 0, 'uint' ),
			cacheOrigin: uniform( new Vector3() ),
			cacheCellSize: uniform( 1 ),
			cacheMinSamples: uniform( 4, 'uint' ),
			pathRecords: storage( pathRecords, 'vec4', IRRADIANCE_PATH_SLOTS * IRRADIANCE_PATH_RECORDS ),

			globalId: globalId,
		};

		const getCameraRayFn = proxyFn( 'bvhData.value.fns.getCameraRay', params );
		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const getSurfaceRecordFn = proxyFn( 'bvhData.value.fns.getSurfaceRecord', params );
		const bsdfSampleFn = proxyFn( 'material.value.bsdfSample', params );
		const bsdfEvalPdfFn = proxyFn( 'material.value.bsdfEvalPdf', params );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				seed: u32,
				targetDimensions: vec2u,
				maxSamples: u32,
				rayCount: u32,
				filterGlossy: f32,
				maxTransparentBounces: u32,
				maxBounces: u32,

				globalId: vec3u
			) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let rayQueue = &${ params.rayQueue };
				let shadowRayQueue = &${ params.shadowRayQueue };
				let pixelQueue = &${ params.pixelQueue };

				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };
				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };

				// bound by "rayCount" rather than the pool length. The dispatch rounds up to the
				// workgroup size and those extra slots hold a zeroed pixel index
				let index = globalId.x;
				if ( index >= rayCount ) {

					return;

				}

				let input = ( *rayDataStorage )[ index ];
				if ( input.objectIndex < 0 ) {

					// the slot's path has terminated: recycle the pixel through the overflow queue and
					// generate a fresh camera ray
					var pixelIndex = input.pixelIndex;
					let elementCount = atomicLoad( &pixelQueue.elementCount );
					if ( elementCount > 0u ) {

						// TODO: If we've pulled off a pixel that's already finished we currently just
						// write a no-op ray, wasting a frame. It may be better to iterate over a few
						// points in the queue to see if we can find one we can use.
						let queueIndex = atomicAdd( &pixelQueue.current, 1u ) % elementCount;
						pixelIndex = atomicExchange( &pixelQueue.elements[ queueIndex ], pixelIndex );

					}

					let indexUV = vec2u( pixelIndex >> 16, pixelIndex & 0xFFFF );

					// skip the pixel if it has hit the sample limit
					let combinedField = textureLoad( ${ params.sampleCountTarget }, indexUV ).r;
					let samples = ( ${ SAMPLE_COUNT_MASK }u & combinedField );
					let isComplete = maxSamples != 0u && samples >= maxSamples;

					if ( isComplete ) {

						rayDataStorage[ index ].pixelIndex = pixelIndex;
						rayDataStorage[ index ].rayIntersectionIndex = - 1;
						rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
						return;

					}

					${ rngInit }( indexUV, seed + samples, 0 );

					let uv = vec2f( indexUV ) / vec2f( targetDimensions );
					let jitteredUv = uv + ${ rand2 }( ${ RNG_INDEX_RAY_JITTER } ) / vec2f( targetDimensions );
					var ray: ${ rayStruct };
					if ( ! ${ getCameraRayFn }( jitteredUv, vec2f( targetDimensions ), &ray ) ) {

						// the camera declined the pixel, so leave the slot dormant for this round
						// TODO: same as above - this work is a bit wasteful and leaves slots empty for
						// a frame. Is it possible to quickly skip rays outside the mask or are finished?
						rayDataStorage[ index ].pixelIndex = pixelIndex;
						rayDataStorage[ index ].rayIntersectionIndex = - 1;
						rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
						return;

					}

					ray.direction = normalize( ray.direction );

					let rayIndex = atomicAdd( &rayQueue.length, 1u );
					rayQueue.elements[ rayIndex ].origin = ray.origin;
					rayQueue.elements[ rayIndex ].direction = ray.direction;
					rayQueue.elements[ rayIndex ].pixelIndex = pixelIndex;
					rayQueue.elements[ rayIndex ].currentBounce = 0u;
					rayQueue.elements[ rayIndex ].seed = seed + samples;
					rayQueue.elements[ rayIndex ].alphaDepth = 0u;
					rayQueue.elements[ rayIndex ].maxDist = ray.maxDist;

					rayDataStorage[ index ].origin = ray.origin;
					rayDataStorage[ index ].direction = ray.direction;
					rayDataStorage[ index ].pixelIndex = pixelIndex;
					rayDataStorage[ index ].seed = seed + samples;
					rayDataStorage[ index ].currentBounce = 0u;
					rayDataStorage[ index ].throughputColor = vec3f( 1.0 );
					rayDataStorage[ index ].resultColor = vec4f( 0.0, 0.0, 0.0, 1.0 );
					rayDataStorage[ index ].scatterColor = vec3f( 1.0 );
					rayDataStorage[ index ].scatterPdf = 1.0;
					rayDataStorage[ index ].minPdf = 1.0;
					rayDataStorage[ index ].isFullyTransmissive = 1u;
					rayDataStorage[ index ].emission = vec3f( 0.0 );
					rayDataStorage[ index ].lightPdf = 0.0;
					rayDataStorage[ index ].alphaDepth = 0u;
					rayDataStorage[ index ].maxDist = ray.maxDist;
					rayDataStorage[ index ].rayIntersectionIndex = i32( rayIndex );
					rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
					rayDataStorage[ index ].dispersionWavelength = - mix( ${ DISPERSION_MIN_WAVELENGTH }.0, ${ DISPERSION_MAX_WAVELENGTH }.0, ${ rand1 }( ${ RNG_INDEX_DISPERSION_WAVELENGTH } ) );
					if ( index < ${ IRRADIANCE_PATH_SLOTS }u ) {

						${ params.pathRecords }[ index * ${ IRRADIANCE_PATH_RECORDS }u ] = vec4f( 0.0 );

					}

					// write the active params & dispatched flag
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( ${ SAMPLE_ACTIVE_FLAG }u | ${ SAMPLE_DISPATCHED_FLAG }u | samples ) );

				} else {

					// evaluate the surface staged by LogicKernel

					// Catcher continuation. Logic asked for the next probe or
					// for the reflection ray. The floor albedo is never used.
					if ( input.resultColor.a < -2.5 ) {

						let origin = ${ offsetRayOriginFunc }( input.origin, input.direction, input.normal );
						let rayIndex = atomicAdd( &rayQueue.length, 1u );
						rayQueue.elements[ rayIndex ].origin = origin;
						rayQueue.elements[ rayIndex ].direction = input.direction;
						rayQueue.elements[ rayIndex ].pixelIndex = input.pixelIndex;
						rayQueue.elements[ rayIndex ].currentBounce = 1u;
						rayQueue.elements[ rayIndex ].seed = input.seed;
						rayQueue.elements[ rayIndex ].alphaDepth = 0u;
						rayQueue.elements[ rayIndex ].maxDist = 0.0;
						rayDataStorage[ index ].origin = origin;
						rayDataStorage[ index ].currentBounce = 1u;
						rayDataStorage[ index ].resultColor = vec4f( 0.0, 0.0, 0.0, -1.5 + input.maxDist );
						rayDataStorage[ index ].throughputColor = input.throughputColor;
						rayDataStorage[ index ].scatterColor = vec3f( 1.0 );
						rayDataStorage[ index ].scatterPdf = 1.0;
						rayDataStorage[ index ].emission = vec3f( 0.0 );
						rayDataStorage[ index ].lightPdf = 0.0;
						rayDataStorage[ index ].isFullyTransmissive = 0u;
						rayDataStorage[ index ].rayIntersectionIndex = i32( rayIndex );
						rayDataStorage[ index ].shadowRayIntersectionIndex = -1;
						rayDataStorage[ index ].alphaDepth = 0u;
						return;

					}

					if ( input.resultColor.a < -1.6 && input.resultColor.a > -2.5 ) {

						let origin = ${ offsetRayOriginFunc }( input.origin, input.lightDirection, input.normal );
						let shadowIndex = atomicAdd( &shadowRayQueue.length, 1u );
						shadowRayQueue.elements[ shadowIndex ].origin = origin;
						shadowRayQueue.elements[ shadowIndex ].direction = input.lightDirection;
						shadowRayQueue.elements[ shadowIndex ].pixelIndex = input.pixelIndex;
						shadowRayQueue.elements[ shadowIndex ].currentBounce = 0u;
						shadowRayQueue.elements[ shadowIndex ].seed = input.seed;
						shadowRayQueue.elements[ shadowIndex ].alphaDepth = input.alphaDepth;
						shadowRayQueue.elements[ shadowIndex ].maxDist = input.lightDist * ( 1.0 - ${ LIGHT_EPSILON } );
						rayDataStorage[ index ].shadowRayIntersectionIndex = i32( shadowIndex );
						rayDataStorage[ index ].rayIntersectionIndex = -1;
						return;

					}

					let indexUV = vec2u( input.pixelIndex >> 16, input.pixelIndex & 0xFFFF );
					${ rngInit }( indexUV, input.seed, input.currentBounce + input.alphaDepth );

					let objectInfo = transforms[ u32( input.objectIndex ) ];
					var materialInfo = ( *materials )[ objectInfo.materialIndex ];

					// A later hit on the floor is a holdout, not a shaded card.
					if ( materialInfo.matte != 0 && input.currentBounce > 0u ) {

						rayDataStorage[ index ].throughputColor = vec3f( 0.0 );
						rayDataStorage[ index ].scatterPdf = 0.0;
						rayDataStorage[ index ].lightPdf = 0.0;
						rayDataStorage[ index ].shadowRayIntersectionIndex = -1;
						return;

					}

					// apply per-object colors
					materialInfo.color *= objectInfo.color.rgb;
					materialInfo.opacity *= objectInfo.color.a;

					var vertexData = ${ sampleTrianglePointFn }( input.barycoord, input.indices );
					vertexData.normal = normalize( transpose( objectInfo.inverseMatrixWorld ) * vertexData.normal );
					vertexData.tangent = vec4f( ( objectInfo.matrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w );
					vertexData.position = objectInfo.matrixWorld * vertexData.position;


					let view = - input.direction;

					// Primary hit on the holdout. Accumulate nothing from the
					// floor's own colour. The first probe is the light Logic
					// already chose, unless that light is the environment, in
					// which case a cosine sample stands in so the HDR is not
					// counted twice.
					if ( materialInfo.matte != 0 && input.currentBounce == 0u && input.resultColor.a >= 0.0 ) {

						var nrm = normalize( vertexData.normal.xyz );
						if ( nrm.y < 0.0 ) {

							nrm = -nrm;

						}

						rayDataStorage[ index ].origin = vertexData.position.xyz;
						rayDataStorage[ index ].normal = nrm;
						rayDataStorage[ index ].emission = vec3f( 0.0 );
						rayDataStorage[ index ].scatterColor = vec3f( 0.0 );
						rayDataStorage[ index ].alphaDepth = 0u;
						rayDataStorage[ index ].resultColor = vec4f( 0.0, 0.0, 0.0, -2.0 );
						rayDataStorage[ index ].minPdf = 1.0;

						var dir = input.lightDirection;
						var emission = vec3f( 0.0 );
						var lightType = -1;
						var pdf = 1.0;
						var dist = ${ LIGHT_FAR_DISTANCE };
						let analytic = input.lightPdf > 0.0 && input.lightType != ${ ENVIRONMENT_LIGHT_TYPE };
						if ( analytic ) {

							let ndotl = max( dot( nrm, input.lightDirection ), 0.0 );
							if ( ndotl > 0.0 ) {

								dir = input.lightDirection;
								emission = input.lightEmission * ndotl / input.lightPdf;
								lightType = input.lightType;
								pdf = input.lightPdf;
								dist = input.lightDist;

							}

						}

						if ( lightType < 0 ) {

							dir = ${ sampleHemisphereFn }( nrm, ${ rand2 }( 13u ) );

						}

						rayDataStorage[ index ].lightDirection = dir;
						rayDataStorage[ index ].lightEmission = emission;
						rayDataStorage[ index ].lightType = lightType;
						rayDataStorage[ index ].lightPdf = pdf;
						rayDataStorage[ index ].lightDist = dist;

						let origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, dir, nrm );
						let shadowIndex = atomicAdd( &shadowRayQueue.length, 1u );
						shadowRayQueue.elements[ shadowIndex ].origin = origin;
						shadowRayQueue.elements[ shadowIndex ].direction = dir;
						shadowRayQueue.elements[ shadowIndex ].pixelIndex = input.pixelIndex;
						shadowRayQueue.elements[ shadowIndex ].currentBounce = 0u;
						shadowRayQueue.elements[ shadowIndex ].seed = input.seed;
						shadowRayQueue.elements[ shadowIndex ].alphaDepth = 0u;
						shadowRayQueue.elements[ shadowIndex ].maxDist = dist * ( 1.0 - ${ LIGHT_EPSILON } );
						rayDataStorage[ index ].shadowRayIntersectionIndex = i32( shadowIndex );
						rayDataStorage[ index ].rayIntersectionIndex = -1;
						return;

					}


					// blur glossy surfaces after low-probability bounces to suppress fireflies,
					// from the Cycles "filter glossy" approach in integrator/surface_shader.h
					let blurRoughness = sqrt( clamp( 1.0 - filterGlossy * select( input.minPdf, 1.0, input.resultColor.a < 0.0 ), 0.0, 1.0 ) ) * 0.5;

					var surface = ${ getSurfaceRecordFn }( materialInfo, vertexData, input.side, input.normal, view, blurRoughness );

					// Stochastically pass through partially transparent surfaces by re-enqueueing
					// the ray at the hit point, advancing the alpha depth but not the bounce count.
					let passesThrough = ${ rand1 }( ${ RNG_INDEX_ALPHA_TEST } ) > surface.opacity;
					if ( passesThrough ) {

						// out of transparent bounces, so stop rather than shading a surface that
						// should be invisible. A zeroed throughput terminates in LogicKernel.
						if ( input.alphaDepth >= maxTransparentBounces ) {

							rayDataStorage[ index ].throughputColor = vec3f( 0.0 );
							rayDataStorage[ index ].emission = vec3f( 0.0 );
							rayDataStorage[ index ].lightPdf = 0.0;
							rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
							return;

						}

						let alphaIndex = atomicAdd( &rayQueue.length, 1u );
						rayQueue.elements[ alphaIndex ].origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, input.direction, input.normal );
						rayQueue.elements[ alphaIndex ].direction = input.direction;
						rayQueue.elements[ alphaIndex ].pixelIndex = input.pixelIndex;
						rayQueue.elements[ alphaIndex ].currentBounce = input.currentBounce;
						rayQueue.elements[ alphaIndex ].seed = input.seed;
						rayQueue.elements[ alphaIndex ].alphaDepth = input.alphaDepth + 1u;
						// the origin advanced to the hit point, so the remaining budget shrinks by the
						// distance already traced
						rayQueue.elements[ alphaIndex ].maxDist = max( input.maxDist - input.dist, 0.0 );

						// the surface is skipped, so no scatter or emission is staged for LogicKernel.
						// "pdf" is left alone so the previous scatter still weights the forward MIS,
						// and "bsdf" matches it so applying the scatter leaves the throughput as is.
						rayDataStorage[ index ].alphaDepth = input.alphaDepth + 1u;
						rayDataStorage[ index ].emission = vec3f( 0.0 );
						rayDataStorage[ index ].scatterColor = vec3f( input.scatterPdf );
						rayDataStorage[ index ].lightPdf = 0.0;
						rayDataStorage[ index ].origin = rayQueue.elements[ alphaIndex ].origin;
						rayDataStorage[ index ].rayIntersectionIndex = i32( alphaIndex );
						rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
						return;

					}

					// apply the hero wavelength to dispersive surfaces, folding the spectral weight
					// into the throughput at the path's first dispersive interaction
					var throughputColor = input.throughputColor;
					let isDispersive = materialInfo.dispersion > 0.0 && surface.ior > 1.0 && surface.transmission > 0.0 && ! surface.thinWall;
					if ( isDispersive ) {

						let wavelength = abs( input.dispersionWavelength );
						${ applyDispersionFunc }( &surface, materialInfo.dispersion, wavelength );
						if ( input.dispersionWavelength < 0.0 ) {

							rayDataStorage[ index ].dispersionWavelength = wavelength;
							throughputColor *= ${ dispersionColorWeightFunc }( wavelength );
							rayDataStorage[ index ].throughputColor = throughputColor;

						}

					}

					// attenuate the light transmitted through the volume when exiting a backface so
					// the surface's emission and NEE resolve against the attenuated throughput
					if ( input.side < 0.0 && materialInfo.transmission > 0.0 ) {

						throughputColor *= ${ transmissionAttenuationFunc }( input.dist, materialInfo.attenuationColor, materialInfo.attenuationDistance );
						rayDataStorage[ index ].throughputColor = throughputColor;

					}

					// Secondary-hit radiance cache. Primary hits stay exact. A sharp,
					// metal, or glass primary scatter also keeps the next vertex
					// exact. A later rough hit, or a long path, reuses the grid
					// or marks this vertex so the finished path can fill it.
					// Tuning: rough at roughness >= 0.35 with metalness <= 0.5
					// and transmission <= 0.2. Spread is bounce >= 3 or a
					// segment longer than 8 cells, and still not a mirror.
					// Irradiance is clamped to 64 when it is written.
					if ( index < ${ IRRADIANCE_PATH_SLOTS }u && ( ${ params.cacheRead } != 0u || ${ params.cacheWrite } != 0u ) ) {

						let ldRec = index * ${ IRRADIANCE_PATH_RECORDS }u;
						let ldState = ${ params.pathRecords }[ ldRec ].w;
						let ldSpecular = surface.roughness < 0.25 || surface.metalness > 0.6 || surface.transmission > 0.2;
						if ( input.currentBounce == 0u ) {

							${ params.pathRecords }[ ldRec ] = vec4f( 0.0, 0.0, 0.0, select( 0.0, 1.0, ldSpecular ) );

						} else if ( ldState > 0.5 && ldState < 1.5 ) {

							${ params.pathRecords }[ ldRec ] = vec4f( 0.0 );

						} else if ( ldState < 1.5 ) {

							let ldRough = surface.roughness >= 0.35 && surface.metalness <= 0.5 && surface.transmission <= 0.2;
							let ldSpread = input.currentBounce >= 3u || input.dist > ${ params.cacheCellSize } * 8.0;
							let ldCanEnd = ldRough || ( ldSpread && surface.roughness >= 0.2 && surface.metalness <= 0.6 && surface.transmission <= 0.2 );
							if ( ldCanEnd ) {

								let ldAlbedo = max( surface.color, vec3f( 0.04 ) );
								let ldNormal = vertexData.normal.xyz;
								let ldCell = vec3i( floor( ( vertexData.position.xyz - ${ params.cacheOrigin } ) / ${ params.cacheCellSize } ) );
								${ irradianceHashSlot( 'ldSlot', 'ldCell', 'ldNormal' ) }
								let ldBase = ldSlot * 2u;
								let ldIrr = ${ params.cacheBuffer }[ ldBase ];
								let ldNrm = ${ params.cacheBuffer }[ ldBase + 1u ];
								let ldWarm = ldIrr.w >= f32( ${ params.cacheMinSamples } ) && dot( normalize( ldNrm.xyz ), ldNormal ) > 0.5;
								if ( ldWarm && ${ params.cacheRead } != 0u ) {

									let ldRad = ldAlbedo * clamp( ldIrr.xyz, vec3f( 0.0 ), vec3f( 64.0 ) );
									rayDataStorage[ index ].resultColor = vec4f( input.resultColor.rgb + throughputColor * ldRad, input.resultColor.a );
									rayDataStorage[ index ].throughputColor = vec3f( 0.0 );
									rayDataStorage[ index ].emission = vec3f( 0.0 );
									rayDataStorage[ index ].scatterPdf = 0.0;
									rayDataStorage[ index ].lightPdf = 0.0;
									rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;
									return;

								}

								if ( ${ params.cacheWrite } != 0u ) {

									${ params.pathRecords }[ ldRec ] = vec4f( ldAlbedo, 2.0 );
									${ params.pathRecords }[ ldRec + 1u ] = vec4f( throughputColor, f32( ldSlot ) );
									${ params.pathRecords }[ ldRec + 2u ] = vec4f( input.resultColor.rgb, 0.0 );
									${ params.pathRecords }[ ldRec + 3u ] = vec4f( ldNormal, 0.0 );

								}

							}

						}

					}

					// sample the next bounce direction and stage the scatter state for LogicKernel
					var scatterRec = ${ bsdfSampleFn }( view, surface );
					let newBounce = input.currentBounce + 1u;

					// decide termination now so finished paths skip the bounce trace entirely - a
					// zeroed pdf reads as a terminating scatter in LogicKernel, which still resolves
					// the surface's emission and NEE before freeing the slot
					var isTerminated = newBounce >= maxBounces || all( scatterRec.color == vec3f( 0.0 ) ) || ${ isTerminatingScatterFunc }( scatterRec );

					// russian roulette early out:
					// Matches Cycles path_state_continuation_probability in integrator/path_state.h
					if ( ! isTerminated && newBounce >= 3u ) {

						let rrThroughput = throughputColor * scatterRec.color / scatterRec.pdf;
						let rrProb = saturate( sqrt( max( max( rrThroughput.r, rrThroughput.g ), rrThroughput.b ) ) );
						isTerminated = rrProb <= 0.0 || ${ rand1 }( ${ RNG_INDEX_RUSSIAN_ROULETTE } ) > rrProb;
						if ( ! isTerminated ) {

							// fold the survival boost into the scatter color so LogicKernel's
							// throughput update applies it without a separate division
							scatterRec.color /= rrProb;

						}

					}

					// Write the ray storage content here since things like the emissive value is read
					// in the logic kernel on the subsequent frame.
					rayDataStorage[ index ].scatterColor = scatterRec.color;
					rayDataStorage[ index ].scatterPdf = select( scatterRec.pdf, 0.0, isTerminated );
					if ( input.resultColor.a >= 0.0 ) {

						rayDataStorage[ index ].minPdf = min( input.minPdf, scatterRec.pdf );

					}
					rayDataStorage[ index ].isFullyTransmissive = input.isFullyTransmissive & select( 0u, 1u, scatterRec.isTransmissive );
					rayDataStorage[ index ].emission = surface.emission;
					rayDataStorage[ index ].currentBounce = newBounce;

					// the NEE shadow ray below still resolves the surface's direct light, so only
					// the bounce segment is skipped for finished paths
					if ( ! isTerminated ) {

						let rayIndex = atomicAdd( &rayQueue.length, 1u );
						rayQueue.elements[ rayIndex ].origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, scatterRec.direction, input.normal );
						rayQueue.elements[ rayIndex ].direction = scatterRec.direction;
						rayQueue.elements[ rayIndex ].pixelIndex = input.pixelIndex;
						rayQueue.elements[ rayIndex ].currentBounce = newBounce;
						rayQueue.elements[ rayIndex ].seed = input.seed;
						rayQueue.elements[ rayIndex ].alphaDepth = input.alphaDepth;
						rayQueue.elements[ rayIndex ].maxDist = 0.0;
						rayDataStorage[ index ].rayIntersectionIndex = i32( rayIndex );

						rayDataStorage[ index ].origin = rayQueue.elements[ rayIndex ].origin;
						rayDataStorage[ index ].direction = scatterRec.direction;

					}

					// evaluate the bsdf toward the light LogicKernel selected and enqueue the shadow ray.
					// the light pdf will be 0 if NEE is disabled.
					var lightPdf = input.lightPdf;
					if ( lightPdf > 0.0 ) {

						let evalRec = ${ bsdfEvalPdfFn }( view, input.lightDirection, surface );
						if ( evalRec.pdf > 0.0 ) {

							rayDataStorage[ index ].lightBsdf = evalRec.color;
							rayDataStorage[ index ].lightBsdfPdf = evalRec.pdf;

							let shadowIndex = atomicAdd( &shadowRayQueue.length, 1u );
							shadowRayQueue.elements[ shadowIndex ].origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, input.lightDirection, input.normal );
							shadowRayQueue.elements[ shadowIndex ].direction = input.lightDirection;
							shadowRayQueue.elements[ shadowIndex ].pixelIndex = input.pixelIndex;
							shadowRayQueue.elements[ shadowIndex ].currentBounce = input.currentBounce;
							shadowRayQueue.elements[ shadowIndex ].seed = input.seed;
							shadowRayQueue.elements[ shadowIndex ].alphaDepth = input.alphaDepth;
							shadowRayQueue.elements[ shadowIndex ].maxDist = input.lightDist * ( 1.0 - ${ LIGHT_EPSILON } );
							rayDataStorage[ index ].shadowRayIntersectionIndex = i32( shadowIndex );

						} else {

							lightPdf = 0.0;

						}

					}

					if ( lightPdf <= 0.0 ) {

						rayDataStorage[ index ].lightPdf = 0.0;
						rayDataStorage[ index ].shadowRayIntersectionIndex = - 1;

					}

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );
		this.cacheAttribute = cacheAttribute;

	}

}
