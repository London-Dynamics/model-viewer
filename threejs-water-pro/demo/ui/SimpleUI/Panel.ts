// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import { injectStyles } from "./styles";
import { Folder, type FolderOptions, type Refreshable } from "./Folder";
import { Slider, type SliderOptions } from "./controls/Slider";
import { Checkbox, type CheckboxOptions } from "./controls/Checkbox";
import { ColorPicker, type ColorPickerOptions } from "./controls/ColorPicker";
import { Select, type SelectOptions } from "./controls/Select";
import { Button, type ButtonOptions } from "./controls/Button";
import { Display, type DisplayOptions } from "./controls/Display";
import { Separator } from "./controls/Separator";

export interface PanelOptions {
  title?: string;
  version?: string;
  container?: HTMLElement;
  position?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
}

export class Panel {
  readonly element: HTMLElement;
  private content: HTMLElement;
  private children: Refreshable[] = [];

  constructor(options: PanelOptions = {}) {
    injectStyles();

    this.element = document.createElement("div");
    this.element.className = "sui-panel";

    // Position
    const pos = options.position ?? { top: 10, right: 10 };
    if (pos.top !== undefined) this.element.style.top = `${pos.top}px`;
    if (pos.right !== undefined) this.element.style.right = `${pos.right}px`;
    if (pos.bottom !== undefined) this.element.style.bottom = `${pos.bottom}px`;
    if (pos.left !== undefined) this.element.style.left = `${pos.left}px`;

    // Title bar with collapse button
    if (options.title) {
      const titleBar = document.createElement("div");
      titleBar.className = "sui-panel-title";

      const titleText = document.createElement("div");
      titleText.className = "sui-panel-title-text";

      const titleName = document.createElement("span");
      titleName.textContent = options.title;
      titleText.appendChild(titleName);

      if (options.version) {
        const versionEl = document.createElement("span");
        versionEl.className = "sui-panel-version";
        versionEl.textContent = `v${options.version}`;
        titleText.appendChild(versionEl);
      }

      titleBar.appendChild(titleText);

      const collapseBtn = document.createElement("button");
      collapseBtn.className = "sui-panel-collapse";
      collapseBtn.textContent = "▼";

      const toggleCollapse = () => {
        const isCollapsed = this.element.classList.toggle("collapsed");
        collapseBtn.textContent = isCollapsed ? "▶" : "▼";
      };

      // Entire title bar is clickable to collapse/expand
      titleBar.style.cursor = "pointer";
      titleBar.addEventListener("click", toggleCollapse);

      this.element.appendChild(titleBar);
    }

    this.content = document.createElement("div");
    this.content.className = "sui-panel-content";
    this.element.appendChild(this.content);

    // Attach to container
    const container = options.container ?? document.body;
    container.appendChild(this.element);
  }

  addFolder(title: string, options?: FolderOptions): Folder {
    const folder = new Folder(title, options);
    this.content.appendChild(folder.element);
    this.children.push(folder);
    return folder;
  }

  addSlider(label: string, options: SliderOptions): Slider {
    const slider = new Slider(label, options);
    this.content.appendChild(slider.element);
    this.children.push(slider);
    return slider;
  }

  addCheckbox(label: string, options: CheckboxOptions): Checkbox {
    const checkbox = new Checkbox(label, options);
    this.content.appendChild(checkbox.element);
    this.children.push(checkbox);
    return checkbox;
  }

  addColor(label: string, options: ColorPickerOptions): ColorPicker {
    const colorPicker = new ColorPicker(label, options);
    this.content.appendChild(colorPicker.element);
    this.children.push(colorPicker);
    return colorPicker;
  }

  addSelect(label: string, options: SelectOptions): Select {
    const select = new Select(label, options);
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

  dispose(): void {
    this.element.remove();
  }
}
