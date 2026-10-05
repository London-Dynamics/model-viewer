// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

export interface SliderOptions {
  value?: number;
  object?: object;
  key?: string;
  min: number;
  max: number;
  step?: number;
  onChange?: (value: number) => void;
  binding?: () => number;
}

export class Slider {
  readonly element: HTMLElement;
  private slider: HTMLInputElement;
  private numberInput: HTMLInputElement;
  private _value: number;
  private _onChange?: (value: number) => void;
  private _silent = false;
  private _binding?: () => number;
  private _object?: Record<string, unknown>;
  private _key?: string;

  constructor(label: string, options: SliderOptions) {
    this._binding = options.binding;
    this._object = options.object as Record<string, unknown> | undefined;
    this._key = options.key;
    this._value =
      this._object && this._key
        ? (this._object[this._key] as number)
        : (options.value ?? this._binding?.() ?? options.min);
    this._onChange = options.onChange;

    const step = options.step ?? 0.01;

    this.element = document.createElement("div");
    this.element.className = "sui-control";

    const labelEl = document.createElement("span");
    labelEl.className = "sui-label";
    labelEl.textContent = label;
    labelEl.title = label;

    const wrapper = document.createElement("div");
    wrapper.className = "sui-input-wrapper";

    this.slider = document.createElement("input");
    this.slider.type = "range";
    this.slider.className = "sui-slider";
    this.slider.min = String(options.min);
    this.slider.max = String(options.max);
    this.slider.step = String(step);
    this.slider.value = String(this._value);
    this.updateTrackFill();

    this.numberInput = document.createElement("input");
    this.numberInput.type = "number";
    this.numberInput.className = "sui-number-input";
    this.numberInput.min = String(options.min);
    this.numberInput.max = String(options.max);
    this.numberInput.step = String(step);
    this.numberInput.value = this.formatValue(this._value, step);

    this.slider.addEventListener("input", () => {
      this.handleInput(this.slider.valueAsNumber);
    });

    this.numberInput.addEventListener("change", () => {
      let v = this.numberInput.valueAsNumber;
      if (isNaN(v)) v = options.min;
      v = Math.max(options.min, Math.min(options.max, v));
      this.handleInput(v);
    });

    wrapper.append(this.slider, this.numberInput);
    this.element.append(labelEl, wrapper);
  }

  private formatValue(value: number, step: number): string {
    const decimals = step < 1 ? Math.ceil(-Math.log10(step)) : 0;
    return value.toFixed(decimals);
  }

  private handleInput(v: number): void {
    this._value = v;
    this.slider.value = String(v);
    const step = parseFloat(this.slider.step);
    this.numberInput.value = this.formatValue(v, step);
    this.updateTrackFill();
    if (!this._silent) {
      if (this._object && this._key) {
        this._object[this._key] = v;
      }
      if (this._onChange) {
        this._onChange(v);
      }
    }
  }

  private updateTrackFill(): void {
    const min = parseFloat(this.slider.min);
    const max = parseFloat(this.slider.max);
    const percent = ((this._value - min) / (max - min)) * 100;
    this.slider.style.background = `linear-gradient(to right, #5a8ab8 ${percent}%, #3a3a3a ${percent}%)`;
  }

  get value(): number {
    return this._value;
  }

  set value(v: number) {
    this.handleInput(v);
  }

  setValueSilent(v: number): void {
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
      this.setValueSilent(this._object[this._key] as number);
    } else if (this._binding) {
      this.setValueSilent(this._binding());
    }
  }
}
