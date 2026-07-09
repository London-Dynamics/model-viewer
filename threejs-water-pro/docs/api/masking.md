# Water Masking

Hides water inside objects (boat hulls, submarines, swimming pools). Registered meshes are written to a stencil pass that excludes water rendering inside them.

For a guided walkthrough, see [Water Masking](/guide/water-masking).

Access via `water.masking`.

## Properties

| Property  | Type      | Default | Description                  |
| --------- | --------- | ------- | ---------------------------- |
| `enabled` | `boolean` | `false` | Enable/disable water masking |

## Methods

### `add`

```typescript
add(object: THREE.Object3D): void
```

Register an object as a water-mask volume — water rendered inside it is hidden.

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
water.masking.enabled = true;
```
