import { Color } from "three/webgpu";

export interface ColorPickerOptions {
  value?: string; // hex color like "#307c8c"
  object?: object;
  key?: string;
  onChange?: (value: string) => void;
  binding?: () => string;
}

/** Convert a value to hex string. Handles THREE.Color or string. */
function toHexString(value: unknown): string {
  if (value instanceof Color) {
    return "#" + value.getHexString();
  }
  return String(value);
}

export class ColorPicker {
  readonly element: HTMLElement;
  private colorInput: HTMLInputElement;
  private hexInput: HTMLInputElement;
  private _value: string;
  private _onChange?: (value: string) => void;
  private _silent = false;
  private _binding?: () => string;
  private _object?: Record<string, unknown>;
  private _key?: string;

  constructor(label: string, options: ColorPickerOptions) {
    this._binding = options.binding;
    this._object = options.object as Record<string, unknown> | undefined;
    this._key = options.key;
    this._value =
      this._object && this._key
        ? toHexString(this._object[this._key])
        : (options.value ?? this._binding?.() ?? "#000000");
    this._onChange = options.onChange;

    this.element = document.createElement("div");
    this.element.className = "sui-control";

    const labelEl = document.createElement("span");
    labelEl.className = "sui-label";
    labelEl.textContent = label;
    labelEl.title = label;

    const wrapper = document.createElement("div");
    wrapper.className = "sui-color-wrapper";

    this.colorInput = document.createElement("input");
    this.colorInput.type = "color";
    this.colorInput.className = "sui-color-input";
    this.colorInput.value = this._value;

    this.hexInput = document.createElement("input");
    this.hexInput.type = "text";
    this.hexInput.className = "sui-color-hex";
    this.hexInput.value = this._value;
    this.hexInput.maxLength = 7;

    this.colorInput.addEventListener("input", () => {
      this.handleInput(this.colorInput.value);
    });

    this.hexInput.addEventListener("change", () => {
      let hex = this.hexInput.value.trim();
      if (!hex.startsWith("#")) hex = "#" + hex;
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        this.handleInput(hex.toLowerCase());
      } else {
        // Revert to current value on invalid input
        this.hexInput.value = this._value;
      }
    });

    wrapper.append(this.colorInput, this.hexInput);
    this.element.append(labelEl, wrapper);
  }

  private handleInput(v: string): void {
    this._value = v;
    this.colorInput.value = v;
    this.hexInput.value = v;
    if (!this._silent) {
      if (this._object && this._key) {
        this._object[this._key] = v;
      }
      if (this._onChange) {
        this._onChange(v);
      }
    }
  }

  get value(): string {
    return this._value;
  }

  set value(v: string) {
    this.handleInput(v);
  }

  setValueSilent(v: string): void {
    this._silent = true;
    this.value = v;
    this._silent = false;
  }

  get hidden(): boolean {
    return this.element.classList.contains("hidden");
  }

  set hidden(v: boolean) {
    this.element.classList.toggle("hidden", v);
  }

  refresh(): void {
    if (this._object && this._key) {
      this.setValueSilent(toHexString(this._object[this._key]));
    } else if (this._binding) {
      this.setValueSilent(this._binding());
    }
  }
}
