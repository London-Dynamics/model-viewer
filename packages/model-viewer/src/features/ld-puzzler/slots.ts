import { Camera, Vector3 } from 'three';

export interface SlotUpdateItem {
  name: string;
  worldPosition: Vector3;
  data?: { [key: string]: any };
  occlusionFactor?: number;
  isFacingCamera?: boolean;
}

export interface SlotManagerOptions {
  slotMap: Map<string, HTMLElement>;
  owner: HTMLElement;
  container: HTMLElement | null;
  scene: any; // Should be Scene from three-components/scene.js but avoiding circular deps
  camera: Camera;
  onUpdate: (element: HTMLElement, options: SlotUpdateItem) => void;
  onCreate: (options: SlotUpdateItem) => HTMLElement;
}

export function updateSlots(
  slotItems: SlotUpdateItem[],
  options: SlotManagerOptions
) {
  const { slotMap, owner, container, scene, camera, onUpdate, onCreate } =
    options;

  const visibleSlots = new Set<string>();

  slotItems.forEach((item) => {
    const { name, worldPosition } = item;
    const vector = worldPosition.clone();
    vector.project(camera);

    const widthHalf = scene.width / 2;
    const heightHalf = scene.height / 2;

    const screenX = vector.x * widthHalf + widthHalf;
    const screenY = -(vector.y * heightHalf) + heightHalf;

    // Check if point is visible (in front of camera and within screen bounds with some margin)
    const visible =
      vector.z < 1 &&
      screenX >= -50 &&
      screenX <= scene.width + 50 &&
      screenY >= -50 &&
      screenY <= scene.height + 50;

    if (visible) {
      visibleSlots.add(name);
      let element = slotMap.get(name);

      if (!element) {
        element = onCreate(item);
        if (container) {
          container.appendChild(element);
        } else {
          owner.appendChild(element);
        }
        slotMap.set(name, element);
      }

      element.style.display = 'block';
      element.style.position = 'absolute';
      // Center the element. Assumes element size is known.
      // The onUpdate can override this.
      element.style.left = `${screenX - element.offsetWidth / 2}px`;
      element.style.top = `${screenY - element.offsetHeight / 2}px`;
      element.style.zIndex = '10';

      onUpdate(element, item);
    }
  });

  // Hide slots that are no longer visible
  slotMap.forEach((element, name) => {
    if (!visibleSlots.has(name)) {
      element.style.display = 'none';
    }
  });
}

export function createSlotElement(
  className: string,
  defaultStyle: string,
  customSlotName: string | null,
  shadowRoot: ShadowRoot | null,
  innerHTML: string | null = null
): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.setAttribute('aria-hidden', 'true');

  let useCustomStyling = false;
  if (shadowRoot && customSlotName) {
    const slot = shadowRoot.querySelector(
      `slot[name="${customSlotName}"]`
    ) as HTMLSlotElement;
    if (slot) {
      const assignedNodes = slot.assignedNodes({ flatten: true });
      const customElement = assignedNodes.find(
        (node) => node.nodeType === Node.ELEMENT_NODE
      ) as HTMLElement;

      if (customElement) {
        // Copy classes but filter out any conflicting ones
        const customClasses = customElement.className
          .split(' ')
          .filter(
            (cls) => !cls.includes('hotspot') && !cls.includes('annotation')
          )
          .join(' ');
        element.className = `${className} ${customClasses}`;
        element.innerHTML = customElement.innerHTML;
        useCustomStyling = true;
      }
    }
  }

  if (!useCustomStyling) {
    element.style.cssText = defaultStyle;
    if (innerHTML) {
      element.innerHTML = innerHTML;
    }
  }

  return element;
}
