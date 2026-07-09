/**
 * Show/hide the `#loading-overlay` DOM element. Looks up the element
 * lazily so the overlay can be constructed before the DOM is ready.
 */
export class LoadingOverlay {
  private _element: HTMLElement | null = null;

  show(): void {
    this._resolveElement()?.classList.add("visible");
  }

  hide(): void {
    this._resolveElement()?.classList.remove("visible");
  }

  private _resolveElement(): HTMLElement | null {
    if (!this._element) {
      this._element = document.getElementById("loading-overlay");
    }
    return this._element;
  }
}
