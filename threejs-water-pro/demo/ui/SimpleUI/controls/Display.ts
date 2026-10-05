// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

export interface DisplayOptions {
  value: string;
}

export class Display {
  readonly element: HTMLElement;
  private display: HTMLSpanElement;
  private _value: string;

  constructor(label: string, options: DisplayOptions) {
    this._value = options.value;

    this.element = document.createElement("div");
    this.element.className = "sui-control";

    const labelEl = document.createElement("span");
    labelEl.className = "sui-label";
    labelEl.textContent = label;
    labelEl.title = label;

    const wrapper = document.createElement("div");
    wrapper.className = "sui-input-wrapper";

    this.display = document.createElement("span");
    this.display.className = "sui-display";
    this.display.textContent = this._value;

    wrapper.append(this.display);
    this.element.append(labelEl, wrapper);
  }

  get value(): string {
    return this._value;
  }

  set value(v: string) {
    this._value = v;
    this.display.textContent = v;
  }

  get hidden(): boolean {
    return this.element.classList.contains("hidden");
  }

  set hidden(v: boolean) {
    this.element.classList.toggle("hidden", v);
  }
}
