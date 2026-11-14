// @ts-nocheck
// clang-format off
import {Vector2} from 'three';
import { StorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from 'three-gpu-pathtracer/src/webgpu/compute/ComputeKernel.js';
import { uniform, storage, textureStore, globalId } from 'three/tsl';
import { proxy, proxyFn, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { misHeuristicFn, sampleHemisphereFn, weightedAlphaBlendFn } from 'three-gpu-pathtracer/src/webgpu/nodes/sampling.wgsl.js';
import { clampPathContributionFunc, isTerminatingScatterFunc } from 'three-gpu-pathtracer/src/webgpu/nodes/utils.wgsl.js';
import { TRANSMISSIVE_BACKGROUND_ENVIRONMENT, TRANSMISSIVE_BACKGROUND_OVERLAY, TRANSMISSIVE_BACKGROUND_TRANSPARENT } from 'three-gpu-pathtracer/src/webgpu/constants.js';
import {
	rngInit, rand2, rand3,
	RNG_INDEX_BACKGROUND_SAMPLE,
	RNG_INDEX_DIRECT_LIGHT_SAMPLE,
} from 'three-gpu-pathtracer/src/webgpu/nodes/random.wgsl.js';
import { ENVIRONMENT_LIGHT_TYPE, LIGHT_FAR_DISTANCE, isMISWeightLightFn } from 'three-gpu-pathtracer/src/webgpu/nodes/lights.wgsl.js';
import { lightRecordStruct, scatterRecordStruct } from 'three-gpu-pathtracer/src/webgpu/nodes/structs.wgsl.js';
import { rayDataStruct, intersectionResultStruct } from 'three-gpu-pathtracer/src/webgpu/compute/wavefront/structs.js';
import { SAMPLE_COUNT_MASK, SAMPLE_DISPATCHED_FLAG } from 'three-gpu-pathtracer/src/webgpu/constants.js';

// Path logic over the persistent slot pool: resolves the previous frame's shadow and bounce trace
// results, accumulates emission and NEE / forward MIS contributions, terminates finished paths into
// the output, and samples the next NEE light for MaterialKernel. Touches no BVH data.
export class LogicKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			envInfo: { value: null },
			backgroundInfo: { value: null },
			lightsInfo: { value: null },

			// targets
			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// settings
			misEnabled: uniform( 1, 'uint' ),
			rayCount: uniform( 0, 'uint' ),
			maxBounces: uniform( 5, 'uint' ),
			clampDirect: uniform( 0 ),
			clampIndirect: uniform( 10 ),
			transmissiveBackground: uniform( TRANSMISSIVE_BACKGROUND_OVERLAY ),

			rayDataStorage: storage( new StorageBufferAttribute( 1, 1 ), rayDataStruct ),
			rayIntersectionsStorage: storage( new StorageBufferAttribute( 1, 1 ), intersectionResultStruct ),
			shadowRayIntersectionsStorage: storage( new StorageBufferAttribute( 1, 1 ), intersectionResultStruct ),

			catcherSamples: uniform( 8, 'uint' ),
			catcherMode: uniform( 1, 'uint' ),
			catcherStrength: uniform( 0.45 ),
			catcherRoughness: uniform( 0.2 ),
			catcherCenter: uniform( new Vector2() ),
			catcherHalf: uniform( new Vector2( 1, 1 ) ),
			catcherRadius: uniform( 1 ),

			globalId: globalId,
		};

		// environment + background resources pulled off their providers (embedded functions)
		const envTotalSumNode = proxy( 'envInfo.value.totalSumNode', params );
		const envIntensityNode = proxy( 'envInfo.value.intensityNode', params );
		const sampleEnvColor = proxy( 'envInfo.value.sampleColor', params );
		const sampleEnvDir = proxy( 'envInfo.value.sampleDir', params );
		const getEnvDirPdf = proxy( 'envInfo.value.getDirPdf', params );
		const getEnvWeight = proxy( 'envInfo.value.getWeight', params );
		const sampleBackground = proxy( 'backgroundInfo.value.sampleColor', params );

		// analytic scene lights pulled off the lightsInfo provider (LightsInfoNode)
		const lightsCountNode = proxy( 'lightsInfo.value.countNode', params );
		const randomLightSampleFn = proxyFn( 'lightsInfo.value.randomLightSample', params );
		const intersectLightAtIndexFn = proxyFn( 'lightsInfo.value.intersectLightAtIndex', params );
		const getLightWeightFn = proxyFn( 'lightsInfo.value.getLightWeight', params );
		const getLightsWeightFn = proxyFn( 'lightsInfo.value.getLightsWeight', params );
		const selectLightFn = proxyFn( 'lightsInfo.value.selectLight', params );
		const isLightVisibleToCameraFn = proxyFn( 'lightsInfo.value.isLightVisibleToCamera', params );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				// settings
				misEnabled: u32,
				rayCount: u32,
				maxBounces: u32,
				clampDirect: f32,
				clampIndirect: f32,
				transmissiveBackground: u32,

				globalId: vec3u
			) -> void {

				let rayDataStorage = &${ params.rayDataStorage };
				let rayIntersectionsStorage = &${ params.rayIntersectionsStorage };
				let shadowRayIntersectionsStorage = &${ params.shadowRayIntersectionsStorage };

				// bound by "rayCount" rather than the pool length. See MaterialKernel
				let index = globalId.x;
				if ( index >= rayCount ) {

					return;

				}

				// skip slots that have never spawned a ray
				let input = ( *rayDataStorage )[ index ];

				if ( input.rayIntersectionIndex < 0 && input.resultColor.a > -1.6 ) {

					return;

				}

				// Holdout floor. Negative alpha marks a catcher path. Eight
				// probes estimate environment plus direct light with the
				// subject and without it. The ratio is coverage, so an HDR
				// cannot tint the page. A reflection ray is spawned only
				// after those probes, and only in shadow-reflection mode.
				if ( input.resultColor.a < -1.6 ) {

					let indexUV = vec2u( input.pixelIndex >> 16, input.pixelIndex & 0xFFFF );
					${ rngInit }( indexUV, input.seed, input.alphaDepth + 40u );

					var withLight = input.emission;
					var withoutLight = input.scatterColor;
					var probes = input.alphaDepth;

					if ( input.shadowRayIntersectionIndex >= 0 ) {

						var contribution = input.lightEmission;
						if ( input.lightType < 0 ) {

							contribution = ${ sampleEnvColor }( input.lightDirection ).rgb;

						}

						let shadowHit = ( *shadowRayIntersectionsStorage )[ u32( input.shadowRayIntersectionIndex ) ];
						withoutLight += contribution;
						if ( shadowHit.objectIndex < 0 ) {

							withLight += contribution;

						}

						probes = probes + 1u;

					}

					let sampleTarget = max( ${ params.catcherSamples }, 1u );
					if ( probes < sampleTarget ) {

						var nextDir = input.lightDirection;
						var nextEmission = vec3f( 0.0 );
						var nextType = -1;
						var nextPdf = 1.0;
						var nextDist = ${ LIGHT_FAR_DISTANCE };
						let useLight = ( probes % 2u ) == 0u && ${ lightsCountNode } > 0u;
						if ( useLight ) {

							let ruv = ${ rand3 }( 12u );
							var selectionPdf = 0.0;
							let lightIndex = ${ selectLightFn }( input.origin, 0.0, ruv.x, &selectionPdf );
							if ( selectionPdf > 0.0 && lightIndex < ${ lightsCountNode } ) {

								var lightRec: ${ lightRecordStruct };
								lightRec = ${ randomLightSampleFn }( lightIndex, input.origin, ruv.yz );
								let ndotl = max( dot( normalize( input.normal ), lightRec.direction ), 0.0 );
								let pdf = lightRec.pdf * selectionPdf;
								if ( pdf > 1e-6 && ndotl > 0.0 && lightRec.lightType != ${ ENVIRONMENT_LIGHT_TYPE } ) {

									nextDir = lightRec.direction;
									nextEmission = lightRec.emission * ndotl / pdf;
									nextType = lightRec.lightType;
									nextPdf = pdf;
									nextDist = lightRec.dist;

								}

							}

						}

						if ( nextType < 0 ) {

							let uv = ${ rand2 }( 20u + probes );
							nextDir = ${ sampleHemisphereFn }( normalize( input.normal ), uv );
							nextType = -1;
							nextPdf = 1.0;
							nextDist = ${ LIGHT_FAR_DISTANCE };
							nextEmission = vec3f( 0.0 );

						}

						rayDataStorage[ index ].emission = withLight;
						rayDataStorage[ index ].scatterColor = withoutLight;
						rayDataStorage[ index ].alphaDepth = probes;
						rayDataStorage[ index ].lightDirection = nextDir;
						rayDataStorage[ index ].lightEmission = nextEmission;
						rayDataStorage[ index ].lightType = nextType;
						rayDataStorage[ index ].lightPdf = nextPdf;
						rayDataStorage[ index ].lightDist = nextDist;
						rayDataStorage[ index ].shadowRayIntersectionIndex = -1;
						rayDataStorage[ index ].resultColor = vec4f( 0.0, 0.0, 0.0, -2.0 );
						return;

					}

					let openLum = dot( withoutLight, vec3f( 0.2126, 0.7152, 0.0722 ) );
					let gotLum = dot( withLight, vec3f( 0.2126, 0.7152, 0.0722 ) );
					var catcherShadow = 0.0;
					if ( openLum > 1e-4 ) {

						catcherShadow = saturate( 1.0 - gotLum / openLum );

					}

					let halfExt = max( ${ params.catcherHalf }, vec2f( 1e-4 ) );
					let outside = max( vec2f( 0.0 ), abs( input.origin.xz - ${ params.catcherCenter } ) - halfExt );
					let dist = length( outside );
					let radius = max( ${ params.catcherRadius }, 1e-4 );
					let falloff = exp( -3.0 * ( dist / radius ) * ( dist / radius ) );
					catcherShadow = catcherShadow * falloff;

					let wantReflection = ${ params.catcherMode } >= 2u && ${ params.catcherStrength } > 0.0 && falloff > 1e-3;
					if ( ! wantReflection ) {

						let colorIndex = vec2u( indexUV.x, textureDimensions( ${ params.outputTarget } ).y - 1u - indexUV.y );
						let storedSamples = textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ${ SAMPLE_COUNT_MASK }u;
						let sampleCount = storedSamples + 1u;
						let prevColor = textureLoad( ${ params.prevOutputTarget }, colorIndex );
						let sampleColor = vec4f( 0.0, 0.0, 0.0, catcherShadow );
						let blendedColor = ${ weightedAlphaBlendFn }( prevColor, sampleColor, 1.0 / f32( sampleCount ) );
						textureStore( ${ params.sampleCountTarget }, indexUV, vec4( ${ SAMPLE_DISPATCHED_FLAG }u | sampleCount ) );
						textureStore( ${ params.outputTarget }, colorIndex, blendedColor );
						rayDataStorage[ index ].objectIndex = -1;
						rayDataStorage[ index ].rayIntersectionIndex = -1;
						rayDataStorage[ index ].shadowRayIntersectionIndex = -1;
						rayDataStorage[ index ].resultColor = vec4f( 0.0 );
						return;

					}

					let incident = normalize( input.direction );
					let nrm = normalize( input.normal );
					var reflected = reflect( incident, nrm );
					let jitterUv = ${ rand2 }( 14u );
					let jitter = ( jitterUv - vec2f( 0.5 ) ) * ${ params.catcherRoughness };
					let helper = select( vec3f( 0.0, 1.0, 0.0 ), vec3f( 1.0, 0.0, 0.0 ), abs( nrm.y ) > 0.9 );
					let tangent = normalize( cross( helper, nrm ) );
					let bitangent = cross( nrm, tangent );
					reflected = normalize( reflected + tangent * jitter.x + bitangent * jitter.y );
					if ( dot( reflected, nrm ) < 0.02 ) {

						reflected = normalize( reflected + nrm * 0.02 );

					}

					let cosTheta = saturate( dot( nrm, -incident ) );
					let fresnel = 0.04 + 0.96 * pow( 1.0 - cosTheta, 5.0 );
					let weight = fresnel * ${ params.catcherStrength } * falloff;
					rayDataStorage[ index ].maxDist = catcherShadow;
					rayDataStorage[ index ].minPdf = weight;
					rayDataStorage[ index ].direction = reflected;
					rayDataStorage[ index ].throughputColor = vec3f( weight );
					rayDataStorage[ index ].resultColor = vec4f( 0.0, 0.0, 0.0, -3.0 );
					rayDataStorage[ index ].lightPdf = 0.0;
					rayDataStorage[ index ].shadowRayIntersectionIndex = -1;
					rayDataStorage[ index ].emission = vec3f( 0.0 );
					rayDataStorage[ index ].scatterColor = vec3f( 1.0 );
					rayDataStorage[ index ].scatterPdf = 1.0;
					rayDataStorage[ index ].alphaDepth = 0u;
					rayDataStorage[ index ].currentBounce = 0u;
					rayDataStorage[ index ].isFullyTransmissive = 0u;
					return;

				}


				let indexUV = vec2u( input.pixelIndex >> 16, input.pixelIndex & 0xFFFF );
				${ rngInit }( indexUV, input.seed, input.currentBounce + input.alphaDepth );

				// one-sample NEE chooses between the analytic lights and the environment, matched with
				// the megakernel
				let envActive = ${ envTotalSumNode } > 0.0 && ${ envIntensityNode } > 0.0;
				let lightsCount = ${ lightsCountNode };
				var envWeight = 0.0;
				if ( envActive ) {

					envWeight = ${ getEnvWeight }();

				}

				var resultColor = input.resultColor;
				var throughputColor = input.throughputColor;
				var floorWeight = input.minPdf;

				// added last, since a camera ray miss overwrites the pixel with the background
				var lightHits = vec3f( 0.0 );
				var cameraHitLight = false;
				var blockedLight = vec3f( 0.0 );

				// resolve the previous surface's NEE shadow ray (pre-scatter throughput). The index
				// is negative when no shadow ray was enqueued last frame
				if ( input.shadowRayIntersectionIndex >= 0 && input.lightPdf > 0.0 ) {

					let shadowHit = ( *shadowRayIntersectionsStorage )[ u32( input.shadowRayIntersectionIndex ) ];
					let occluded = shadowHit.objectIndex >= 0;
					let isMISWeighted = ${ isMISWeightLightFn }( input.lightType ) && shadowHit.forwardBlocked == 0u;
					let misWeight = select( 1.0, ${ misHeuristicFn }( input.lightPdf, input.lightBsdfPdf ), isMISWeighted );
					let directLight = throughputColor * input.lightEmission * input.lightBsdf * misWeight / input.lightPdf;
					let contribution = ${ clampPathContributionFunc }( directLight, input.currentBounce, clampDirect, clampIndirect );
					if ( occluded ) {

						blockedLight += contribution;

					} else {

						resultColor += vec4f( contribution, 0.0 );

					}

				}

				// emission gathered at the previous surface (pre-scatter throughput). Found light clamps
				// at the depth of the segment that found it, as in Cycles, so one less than the current
				let emission = ${ clampPathContributionFunc }( throughputColor * input.emission, max( input.currentBounce, 1u ) - 1u, clampDirect, clampIndirect );
				resultColor += vec4f( emission, 0.0 );

				// reconstruct the scatter record staged by MaterialKernel
				var scatterRec: ${ scatterRecordStruct };
				scatterRec.color = input.scatterColor;
				scatterRec.pdf = input.scatterPdf;

				// the bounce limit, russian roulette, and terminating scatter checks all ran in
				// MaterialKernel, which stages a zeroed pdf and skips the bounce trace when they fire
				var isTerminated = all( throughputColor == vec3f( 0.0 ) ) || input.currentBounce >= maxBounces || ${ isTerminatingScatterFunc }( scatterRec );

				if ( ! isTerminated ) {

					// apply the scatter across the traced segment
					throughputColor *= scatterRec.color / scatterRec.pdf;

					let hitResult = ( *rayIntersectionsStorage )[ u32( input.rayIntersectionIndex ) ];
					let didHit = hitResult.objectIndex >= 0;
					let surfaceDist = select( ${ LIGHT_FAR_DISTANCE }, hitResult.dist, didHit );

					// NEE's total weight at the vertex this segment left, for MIS. Camera segments have none
					let isMISWeighted = misEnabled != 0u && input.currentBounce > 0u;
					var lightTotalWeight = 0.0;
					if ( isMISWeighted ) {

						lightTotalWeight = ${ getLightsWeightFn }( input.origin ) + envWeight;

					}

					// forward hits on area lights. Camera rays only see visibleToCameraRays lights, at full weight
					for ( var li = 0u; li < lightsCount; li ++ ) {

						if ( input.currentBounce == 0u && ! ${ isLightVisibleToCameraFn }( li ) ) {

							continue;

						}

						var lightRec: ${ lightRecordStruct };
						if ( ${ intersectLightAtIndexFn }( input.origin, input.direction, li, &lightRec ) && lightRec.dist < surfaceDist ) {

							var misWeight = 1.0;
							if ( isMISWeighted ) {

								let selectionPdf = ${ getLightWeightFn }( li, input.origin ) / lightTotalWeight;
								misWeight = ${ misHeuristicFn }( input.scatterPdf, lightRec.pdf * selectionPdf );

							}

							lightHits += ${ clampPathContributionFunc }( lightRec.emission * throughputColor * misWeight, input.currentBounce, clampDirect, clampIndirect );
							cameraHitLight = cameraHitLight || input.currentBounce == 0u;

						}

					}

					if ( didHit ) {

						// stage the hit for MaterialKernel
						rayDataStorage[ index ].barycoord = hitResult.barycoord;
						rayDataStorage[ index ].normal = hitResult.normal;
						rayDataStorage[ index ].side = hitResult.side;
						rayDataStorage[ index ].indices = hitResult.indices;
						rayDataStorage[ index ].objectIndex = hitResult.objectIndex;
						rayDataStorage[ index ].dist = hitResult.dist;

						// next event estimation: choose one light or the environment by its estimated
						// contribution. MaterialKernel evaluates the bsdf and enqueues the shadow ray.
						var lightPdf = 0.0;
						if ( misEnabled != 0u ) {

							let ruv = ${ rand3 }( ${ RNG_INDEX_DIRECT_LIGHT_SAMPLE } );
							var selectionPdf = 0.0;
							let lightIndex = ${ selectLightFn }( hitResult.position, envWeight, ruv.x, &selectionPdf );
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

									lightRec = ${ randomLightSampleFn }( lightIndex, hitResult.position, ruv.yz );

								}

								lightPdf = lightRec.pdf * selectionPdf;
								rayDataStorage[ index ].lightDirection = lightRec.direction;
								rayDataStorage[ index ].lightEmission = lightRec.emission;
								rayDataStorage[ index ].lightDist = lightRec.dist;
								rayDataStorage[ index ].lightType = lightRec.lightType;

							}

						}

						rayDataStorage[ index ].lightPdf = lightPdf;

					} else {

						// the segment escaped the scene: gather the environment for opaque paths, or
						// the background for camera segments and fully transmissive paths
						if ( resultColor.a > -1.6 && resultColor.a < -0.4 && input.currentBounce == 1u ) {

							floorWeight = 0.0;
							isTerminated = true;

						} else if ( input.currentBounce > 0u && input.isFullyTransmissive == 0u ) {

							var misWeight = 1.0;
							if ( isMISWeighted && envActive ) {

								// match the env pdf scaling used by the NEE selection so the two estimators balance
								let envPdf = ${ getEnvDirPdf }( input.direction ) * envWeight / lightTotalWeight;
								misWeight = ${ misHeuristicFn }( input.scatterPdf, envPdf );

							}

							let environment = ${ sampleEnvColor }( input.direction ).rgb * throughputColor * misWeight;
							let contribution = ${ clampPathContributionFunc }( environment, input.currentBounce, clampDirect, clampIndirect );
							resultColor += vec4f( contribution, 0.0 );

						} else {

							// hit the background
							// support multiple transparent background blending techniques
							let rng = ${ rand2 }( ${ RNG_INDEX_BACKGROUND_SAMPLE } );
							let bg = ${ sampleBackground }( input.direction, rng );
							if ( input.currentBounce == 0u ) {

								// sample the background directly if this is the primary ray
								let background = ${ clampPathContributionFunc }( bg.a * bg.rgb, input.currentBounce, clampDirect, clampIndirect );
								resultColor = vec4f( background, bg.a );

							} else {

								// transmissive ray handling
								let env = ${ sampleEnvColor }( input.direction );
								let avg = saturate( dot( throughputColor, vec3f( 1.0 / 3.0 ) ) );
								let transparency = ( 1.0 - bg.a ) * avg;

								var misWeight = 1.0;
								if ( misEnabled != 0u && envActive ) {

									let envPdf = ${ getEnvDirPdf }( input.direction );
									misWeight = ${ misHeuristicFn }( input.scatterPdf, envPdf );

								}

								if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_ENVIRONMENT }u ) {

									// display the env map through transmissive surfaces
									let background = ${ clampPathContributionFunc }( env.rgb * throughputColor * misWeight, input.currentBounce, clampDirect, clampIndirect );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0,
									);

								} else if ( transmissiveBackground == ${ TRANSMISSIVE_BACKGROUND_TRANSPARENT }u ) {

									// fade the background by the throughput color average
									let background = ${ clampPathContributionFunc }( bg.a * bg.rgb * throughputColor * misWeight, input.currentBounce, clampDirect, clampIndirect );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0 - transparency,
									);

								} else {

									// fade the background by the throughput color average, mixing in env lighting
									var light = mix( env.rgb, bg.rgb, bg.a ) * misWeight;
									let background = ${ clampPathContributionFunc }( light * throughputColor, input.currentBounce, clampDirect, clampIndirect );
									resultColor = vec4f(
										resultColor.rgb + background,
										1.0 - transparency,
									);

								}

							}

						}

						isTerminated = true;

					}

				}

				// visible lights are opaque against a transparent background
				resultColor += vec4f( lightHits, 0.0 );
				if ( cameraHitLight && resultColor.a >= 0.0 ) {

					resultColor.a = 1.0;

				}

				// the color rows are stored top down to match a rasterized render target
				let colorIndex = vec2u( indexUV.x, textureDimensions( ${ params.outputTarget } ).y - 1u - indexUV.y );
				let storedSamples = textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ${ SAMPLE_COUNT_MASK }u;

				if ( isTerminated ) {

					var outputColor = resultColor;
					if ( resultColor.a > -1.6 && resultColor.a < -0.4 ) {

						let shadow = saturate( resultColor.a + 1.5 );
						let weight = saturate( floorWeight );
						let alpha = 1.0 - ( 1.0 - shadow ) * ( 1.0 - weight );
						var straight = vec3f( 0.0 );
						if ( alpha > 1e-4 ) {

							straight = resultColor.rgb / alpha;

						}

						outputColor = vec4f( straight, alpha );

					} else if ( resultColor.a < 0.0 ) {

						outputColor = vec4f( 0.0 );

					}

					// blend the finished sample into the output and free the slot for a new camera ray
					let sampleCount = storedSamples + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, colorIndex );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor, outputColor, 1.0 / f32( sampleCount ) );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( ${ SAMPLE_DISPATCHED_FLAG }u | sampleCount ) );
					textureStore( ${ params.outputTarget }, colorIndex, blendedColor );

					rayDataStorage[ index ].objectIndex = - 1;

				} else {

					// show the path so far, which the first sample overwrites
					if ( storedSamples == 0u && resultColor.a >= 0.0 ) {

						textureStore( ${ params.outputTarget }, colorIndex, resultColor );

					}

					rayDataStorage[ index ].resultColor = resultColor;
					rayDataStorage[ index ].throughputColor = throughputColor;

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
