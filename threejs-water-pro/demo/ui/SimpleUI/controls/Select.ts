// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

export interface SelectOption {
  disabled?: boolean;
  label: string;
  value: string | number;
}

export interface SelectOptions {
  value?: string | number;
  object?: object;
  key?: string;
  options: SelectOption[];
  onChange?: (value: string | number) => void;
  binding?: () => string | number;
}

export class Select {
  readonly element: HTMLElement;
  private select: HTMLSelectElement;
  private _value: string | number;
  private _onChange?: (value: string | number) => void;
  private _silent = false;
  private _dirty = false;
  private _options: SelectOption[];
  private _binding?: () => string | number;
  private _object?: Record<string, unknown>;
  private _key?: string;

  constructor(label: string, options: SelectOptions) {
    this._binding = options.binding;
    this._object = options.object as Record<string, unknown> | undefined;
    this._key = options.key;
    this._options = options.options;
    this._value =
      this._object && this._key
        ? (this._object[this._key] as string | number)
        : (options.value ?? this._binding?.() ?? this._options[0]?.value ?? "");
    this._onChange = options.onChange;

    this.element = document.createElement("div");
    this.element.className = "sui-control";

    const labelEl = document.createElement("span");
    labelEl.className = "sui-label";
    labelEl.textContent = label;
    labelEl.title = label;

    const wrapper = document.createElement("div");
    wrapper.className = "sui-input-wrapper";

    this.select = document.createElement("select");
    this.select.className = "sui-select";

    for (const opt of options.options) {
      const optEl = document.createElement("option");
      optEl.value = String(opt.value);
      optEl.textContent = opt.label;
      optEl.disabled = opt.disabled ?? false;
      if (opt.value === this._value) {
        optEl.selected = true;
      }
      this.select.appendChild(optEl);
    }

    this.select.addEventListener("change", () => {
      const selectedOpt = this._options.find(
        (o) => String(o.value) === this.select.value,
      );
      if (selectedOpt) {
        this.handleInput(selectedOpt.value);
      }
    });

    wrapper.append(this.select);
    this.element.append(labelEl, wrapper);
  }

  private handleInput(v: string | number): void {
    this._value = v;
    this.select.value = String(v);
    if (!this._silent) {
      if (this._object && this._key) {
        this._object[this._key] = v;
      }
      if (this._onChange) {
        this._onChange(v);
      }
    }
  }

  get value(): string | number {
    return this._value;
  }

  set value(v: string | number) {
    this.handleInput(v);
  }

  setValueSilent(v: string | number): void {
    this._silent = true;
    this.value = v;
    this._silent = false;
  }

  /** Append an asterisk to the currently selected option's label. */
  markDirty(): void {
    if (this._dirty) return;
    this._dirty = true;
    const optEl = this.select.options[this.select.selectedIndex];
    if (optEl) {
      optEl.textContent = optEl.textContent + " *";
    }
  }

  /** Remove the asterisk from all option labels. */
  clearDirty(): void {
    if (!this._dirty) return;
    this._dirty = false;
    for (const optEl of this.select.options) {
      if (optEl.textContent?.endsWith(" *")) {
        optEl.textContent = optEl.textContent.slice(0, -2);
      }
    }
  }

  get hidden(): boolean {
    return this.element.classList.contains("hidden");
  }

  set hidden(v: boolean) {
    this.element.classList.toggle("hidden", v);
  }

  refresh(): void {
    if (this._object && this._key) {
      this.setValueSilent(this._object[this._key] as string | number);
    } else if (this._binding) {
      this.setValueSilent(this._binding());
    }
  }
}
