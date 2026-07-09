import { Slider, type SliderOptions } from "./controls/Slider";
import { Checkbox, type CheckboxOptions } from "./controls/Checkbox";
import { ColorPicker, type ColorPickerOptions } from "./controls/ColorPicker";
import { Select, type SelectOptions } from "./controls/Select";
import { Button, type ButtonOptions } from "./controls/Button";
import { Display, type DisplayOptions } from "./controls/Display";
import { Separator } from "./controls/Separator";

export type Refreshable = Slider | Checkbox | ColorPicker | Select | Folder;

export interface FolderOptions {
  expanded?: boolean;
  onControlChange?: () => void;
}

export class Folder {
  readonly element: HTMLElement;
  private content: HTMLElement;
  private chevron: HTMLSpanElement;
  private _expanded: boolean;
  private children: Refreshable[] = [];
  private _onControlChange?: () => void;

  constructor(title: string, options: FolderOptions = {}) {
    this._expanded = options.expanded ?? true;
    this._onControlChange = options.onControlChange;

    this.element = document.createElement("div");
    this.element.className = "sui-folder";
    if (!this._expanded) {
      this.element.classList.add("collapsed");
    }

    const header = document.createElement("div");
    header.className = "sui-folder-header";

    const titleEl = document.createElement("span");
    titleEl.className = "sui-folder-title";
    titleEl.textContent = title;

    this.chevron = document.createElement("span");
    this.chevron.className = "sui-chevron";
    this.chevron.textContent = "▼";

    header.append(titleEl, this.chevron);
    header.addEventListener("click", () => this.toggle());

    this.content = document.createElement("div");
    this.content.className = "sui-folder-content";

    this.element.append(header, this.content);
  }

  toggle(): void {
    this._expanded = !this._expanded;
    this.element.classList.toggle("collapsed", !this._expanded);
  }

  get expanded(): boolean {
    return this._expanded;
  }

  set expanded(v: boolean) {
    this._expanded = v;
    this.element.classList.toggle("collapsed", !v);
  }

  get hidden(): boolean {
    return this.element.classList.contains("hidden");
  }

  set hidden(v: boolean) {
    this.element.classList.toggle("hidden", v);
  }

  get disabled(): boolean {
    return this.element.classList.contains("disabled");
  }

  set disabled(v: boolean) {
    this.element.classList.toggle("disabled", v);
  }

  addFolder(title: string, options?: FolderOptions): Folder {
    const folder = new Folder(title, {
      ...options,
      onControlChange: options?.onControlChange ?? this._onControlChange,
    });
    this.content.appendChild(folder.element);
    this.children.push(folder);
    return folder;
  }

  addSlider(label: string, options: SliderOptions): Slider {
    const origOnChange = options.onChange;
    const notify = this._onControlChange;
    const slider = new Slider(label, {
      ...options,
      onChange: origOnChange
        ? (v: number) => {
            origOnChange(v);
            notify?.();
          }
        : notify
          ? () => notify()
          : undefined,
    });
    this.content.appendChild(slider.element);
    this.children.push(slider);
    return slider;
  }

  addCheckbox(label: string, options: CheckboxOptions): Checkbox {
    const origOnChange = options.onChange;
    const notify = this._onControlChange;
    const checkbox = new Checkbox(label, {
      ...options,
      onChange: origOnChange
        ? (v: boolean) => {
            origOnChange(v);
            notify?.();
          }
        : notify
          ? () => notify()
          : undefined,
    });
    this.content.appendChild(checkbox.element);
    this.children.push(checkbox);
    return checkbox;
  }

  addColor(label: string, options: ColorPickerOptions): ColorPicker {
    const origOnChange = options.onChange;
    const notify = this._onControlChange;
    const colorPicker = new ColorPicker(label, {
      ...options,
      onChange: origOnChange
        ? (v: string) => {
            origOnChange(v);
            notify?.();
          }
        : notify
          ? () => notify()
          : undefined,
    });
    this.content.appendChild(colorPicker.element);
    this.children.push(colorPicker);
    return colorPicker;
  }

  addSelect(label: string, options: SelectOptions): Select {
    const origOnChange = options.onChange;
    const notify = this._onControlChange;
    const select = new Select(label, {
      ...options,
      onChange: origOnChange
        ? (v: string | number) => {
            origOnChange(v);
            notify?.();
          }
        : notify
          ? () => notify()
          : undefined,
    });
    this.content.appendChild(select.element);
    this.children.push(select);
    return select;
  }

  addButton(label: string, options?: ButtonOptions): Button {
    const button = new Button(label, options);
    this.content.appendChild(button.element);
    return button;
  }

  addDisplay(label: string, options: DisplayOptions): Display {
    const display = new Display(label, options);
    this.content.appendChild(display.element);
    return display;
  }

  addSeparator(): Separator {
    const separator = new Separator();
    this.content.appendChild(separator.element);
    return separator;
  }

  refresh(): void {
    for (const child of this.children) {
      child.refresh();
    }
  }
}
