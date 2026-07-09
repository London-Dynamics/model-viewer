export interface ButtonOptions {
  onClick?: () => void;
}

export class Button {
  readonly element: HTMLElement;
  private button: HTMLButtonElement;

  constructor(label: string, options: ButtonOptions = {}) {
    this.element = document.createElement("div");
    this.element.className = "sui-control";

    this.button = document.createElement("button");
    this.button.className = "sui-button";
    this.button.textContent = label;

    if (options.onClick) {
      this.button.addEventListener("click", options.onClick);
    }

    this.element.append(this.button);
  }

  get hidden(): boolean {
    return this.element.classList.contains("hidden");
  }

  set hidden(v: boolean) {
    this.element.classList.toggle("hidden", v);
  }
}
