# Ambient Particles

Underwater ambient particles representing sediment or plankton. Only visible when the camera is submerged.

Access via `water.particles`.

## Properties

| Property  | Type      | Default     | Description                      |
| --------- | --------- | ----------- | -------------------------------- |
| `enabled` | `boolean` | from preset | Enable/disable ambient particles |

## Methods

### `updateParams`

```typescript
updateParams(params: Partial<ParticleParams>): void
```

Update particle parameters at runtime. Omitted fields keep their current values.

| Parameter | Type | Description |
| --- | --- | --- |
| `params` | `Partial<ParticleParams>` | Particle settings to apply. See [ParticleParams](#particleparams) below. |

### `ParticleParams`

| Option         | Type      | Default     | Description                                           |
| -------------- | --------- | ----------- | ----------------------------------------------------- |
| `color`        | `string`  | `"#ffffff"` | Particle tint (hex string)                            |
| `count`        | `number`  | `1000`      | Number of active particles. Can be lowered and restored at runtime, but cannot exceed the allocation set by the preset at creation |
| `enabled`      | `boolean` | `true`      | Enable/disable ambient particles                      |
| `farDistance`  | `number`  | `209`       | Distance from camera where particles fully fade out   |
| `maxSize`      | `number`  | `0.5`       | Maximum world-space particle size                     |
| `minSize`      | `number`  | `0.1`       | Minimum world-space particle size                     |
| `nearDistance` | `number`  | `9`         | Inner radius where particles start to appear; particles are fully opaque here and fade out toward `farDistance` |
| `opacity`      | `number`  | `0.5`       | Master opacity (0–1)                                  |

## Example

```typescript
water.particles.updateParams({
  count: 200,
  minSize: 0.1,
  maxSize: 0.3,
  opacity: 0.4,
  color: "#a0c8d0",
  nearDistance: 2,
  farDistance: 50,
});
```
