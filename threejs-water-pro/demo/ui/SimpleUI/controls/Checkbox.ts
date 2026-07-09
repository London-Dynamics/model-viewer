export interface CheckboxOptions {
  value?: boolean;
  object?: object;
  key?: string;
  onChange?: (value: boolean) => void;
  binding?: () => boolean;
}

export class Checkbox {
  readonly element: HTMLElement;
  private checkbox: HTMLInputElement;
  private _value: boolean;
  private _onChange?: (value: boolean) => void;
  private _silent = false;
  private _binding?: () => boolean;
  private _object?: Record<string, unknown>;
  private _key?: string;

  constructor(label: string, options: CheckboxOptions) {
    this._binding = options.binding;
    this._object = options.object as Record<string, unknown> | undefined;
    this._key = options.key;
    this._value =
      this._object && this._key
        ? (this._object[this._key] as boolean)
        : (options.value ?? this._binding?.() ?? false);
    this._onChange = options.onChange;

    this.element = document.createElement("div");
    this.element.className = "sui-control";

    const labelEl = document.createElement("span");
    labelEl.className = "sui-label";
    labelEl.textContent = label;
    labelEl.title = label;

    const wrapper = document.createElement("div");
    wrapper.className = "sui-checkbox-wrapper";

    this.checkbox = document.createElement("input");
    this.checkbox.type = "checkbox";
    this.checkbox.className = "sui-checkbox";
    this.checkbox.checked = this._value;

    this.checkbox.addEventListener("change", () => {
      this.handleInput(this.checkbox.checked);
    });

    wrapper.append(this.checkbox);
    this.element.append(labelEl, wrapper);
  }

  private handleInput(v: boolean): void {
    this._value = v;
    this.checkbox.checked = v;
    if (!this._silent) {
      if (this._object && this._key) {
        this._object[this._key] = v;
      }
      if (this._onChange) {
        this._onChange(v);
      }
    }
  }

  get value(): boolean {
    return this._value;
  }

  set value(v: boolean) {
    this.handleInput(v);
  }

  setValueSilent(v: boolean): void {
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
      this.setValueSilent(this._object[this._key] as boolean);
    } else if (this._binding) {
      this.setValueSilent(this._binding());
    }
  }
}
