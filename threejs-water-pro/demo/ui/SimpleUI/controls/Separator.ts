export class Separator {
  readonly element: HTMLElement;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "sui-separator";
  }

  get hidden(): boolean {
    return this.element.classList.contains("hidden");
  }

  set hidden(v: boolean) {
    this.element.classList.toggle("hidden", v);
  }
}
