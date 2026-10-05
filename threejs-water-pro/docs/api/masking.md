# Water Masking

Hides water inside objects (boat hulls, submarines, swimming pools). Registered meshes are rendered into a screen-space mask texture that excludes water rendering inside them.

For a guided walkthrough, see [Water Masking](/guide/water-masking).

Access via `water.masking`.

## Properties

| Property  | Type      | Default | Description                  |
| --------- | --------- | ------- | ---------------------------- |
| `enabled` | `boolean` | `false` | Whether masking is active. `add` enables it automatically and `remove` disables it when the last object is removed, so set this only to turn masking off temporarily |

## Methods

### `add`

```typescript
add(object: THREE.Object3D): void
```

Register an object as a water-mask volume. Water rendered inside it is hidden.

| Parameter | Type | Description |
| --- | --- | --- |
| `object` | `THREE.Object3D` | The mesh (or group) to use as a mask volume. |

### `has`

```typescript
has(object: THREE.Object3D): boolean
```

Check whether an object is currently registered as a mask.

| Parameter | Type | Description |
| --- | --- | --- |
| `object` | `THREE.Object3D` | The object to check. |

### `remove`

```typescript
remove(object: THREE.Object3D): void
```

Unregister a previously added mask volume.

| Parameter | Type | Description |
| --- | --- | --- |
| `object` | `THREE.Object3D` | An object previously passed to `add`. |

## Example

```typescript
water.masking.add(hullMesh);
water.masking.has(hullMesh);
water.masking.remove(hullMesh);

// Turn masking off temporarily without unregistering objects.
water.masking.enabled = false;
```
