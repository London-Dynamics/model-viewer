// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

const CSS = `
.sui-panel,
.sui-panel * {
  box-sizing: border-box;
}

.sui-panel {
  position: fixed;
  background: rgba(26, 26, 26, 0.95);
  border-radius: 6px;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 11px;
  color: #e0e0e0;
  width: 280px;
  max-height: 90vh;
  overflow-y: auto;
  overflow-x: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  z-index: 1000;
}

.sui-panel-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid #333;
  background: rgba(40, 40, 40, 0.5);
  border-radius: 6px 6px 0 0;
}

.sui-panel-title-text {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.sui-panel-version {
  font-size: 10px;
  font-weight: 400;
  color: #888;
}

.sui-panel-collapse {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 2px 6px;
  font-size: 10px;
  border-radius: 3px;
  transition: background 0.15s, color 0.15s;
}

.sui-panel-collapse:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ccc;
}

.sui-panel.collapsed .sui-panel-content {
  display: none;
}

.sui-panel.collapsed {
  border-radius: 6px;
}

.sui-folder {
  border-bottom: 1px solid #2a2a2a;
}

.sui-folder:last-child {
  border-bottom: none;
}

.sui-folder-header {
  width: 100%;
  border: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  user-select: none;
  transition: background 0.15s;
}

.sui-folder-header:hover {
  background: rgba(255, 255, 255, 0.05);
}

.sui-folder-header:focus-visible {
  outline: 2px solid #4a9eff;
  outline-offset: -2px;
}

.sui-folder-title {
  font-weight: 500;
}

.sui-chevron {
  font-size: 8px;
  color: #888;
  transition: transform 0.2s;
}

.sui-folder.collapsed .sui-chevron {
  transform: rotate(-90deg);
}

.sui-folder.collapsed .sui-folder-content {
  display: none;
}

.sui-folder.hidden {
  display: none;
}

.sui-folder.disabled {
  opacity: 0.4;
  pointer-events: none;
}

.sui-folder.disabled .sui-folder-header {
  cursor: not-allowed;
}

.sui-folder-content {
  margin-left: 4px;
}

/* Nested folders - level 1 */
.sui-folder .sui-folder {
  border-bottom: none;
  border-left: 2px solid rgba(74, 158, 255, 0.3);
}

.sui-folder .sui-folder > .sui-folder-header {
  background: rgba(255, 255, 255, 0.03);
}

.sui-folder .sui-folder > .sui-folder-header:hover {
  background: rgba(255, 255, 255, 0.08);
}

.sui-folder .sui-folder .sui-folder-title {
  color: #bbb;
}

/* Nested folders - level 2 */
.sui-folder .sui-folder .sui-folder > .sui-folder-header {
  background: rgba(255, 255, 255, 0.05);
}

.sui-folder .sui-folder .sui-folder > .sui-folder-header:hover {
  background: rgba(255, 255, 255, 0.10);
}

.sui-folder .sui-folder .sui-folder .sui-folder-title {
  color: #aaa;
}

@media (prefers-reduced-motion: reduce) {
  .sui-folder-header,
  .sui-chevron {
    transition: none;
  }
}

.sui-control {
  display: flex;
  align-items: center;
  padding: 4px 8px 4px 12px;
  gap: 8px;
  min-height: 26px;
  border-left: 2px solid rgba(74, 158, 255, 0.3);
}

.sui-control.hidden {
  display: none;
}

.sui-label {
  flex: 0 0 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #bbb;
}

.sui-input-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

/* Slider */
.sui-slider {
  flex: 1;
  min-width: 0;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: #444;
  border-radius: 2px;
  cursor: pointer;
}

.sui-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  background: #4a9eff;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s;
}

.sui-slider::-webkit-slider-thumb:hover {
  background: #6ab0ff;
}

.sui-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  background: #4a9eff;
  border: none;
  border-radius: 50%;
  cursor: pointer;
}

.sui-number-input {
  width: 44px;
  flex-shrink: 0;
  padding: 3px 4px;
  background: #333;
  border: 1px solid #444;
  border-radius: 3px;
  color: #e0e0e0;
  font-size: 10px;
  text-align: right;
  -moz-appearance: textfield;
}

.sui-number-input::-webkit-outer-spin-button,
.sui-number-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.sui-number-input:focus {
  outline: none;
  border-color: #4a9eff;
}

/* Checkbox */
.sui-checkbox-wrapper {
  flex: 1;
  display: flex;
  justify-content: flex-start;
}

.sui-checkbox {
  width: 14px;
  height: 14px;
  accent-color: #4a9eff;
  cursor: pointer;
}

/* Color picker */
.sui-color-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}

.sui-color-input {
  width: 32px;
  height: 20px;
  padding: 0;
  border: 1px solid #444;
  border-radius: 3px;
  cursor: pointer;
  background: none;
}

.sui-color-input::-webkit-color-swatch-wrapper {
  padding: 0;
}

.sui-color-input::-webkit-color-swatch {
  border: none;
  border-radius: 2px;
}

.sui-color-hex {
  width: 60px;
  padding: 3px 5px;
  background: #333;
  border: 1px solid #444;
  border-radius: 3px;
  color: #e0e0e0;
  font-size: 10px;
  font-family: monospace;
}

.sui-color-hex:focus {
  outline: none;
  border-color: #4a9eff;
}

/* Select */
.sui-select {
  flex: 1;
  padding: 4px 6px;
  background: #333;
  border: 1px solid #444;
  border-radius: 3px;
  color: #e0e0e0;
  font-size: 11px;
  cursor: pointer;
}

.sui-select:focus {
  outline: none;
  border-color: #4a9eff;
}

/* Button */
.sui-button {
  flex: 1;
  padding: 6px 12px;
  background: #3a3a3a;
  border: 1px solid #444;
  border-radius: 3px;
  color: #e0e0e0;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s;
}

.sui-button:hover {
  background: #4a4a4a;
}

.sui-button:active {
  background: #333;
}

/* Display (read-only) */
.sui-display {
  flex: 1;
  padding: 3px 5px;
  background: #2a2a2a;
  border: 1px solid #333;
  border-radius: 3px;
  color: #999;
  font-size: 10px;
}

/* Separator */
.sui-separator {
  height: 1px;
  background: #333;
  margin: 6px 12px;
}

/* Scrollbar styling */
.sui-panel::-webkit-scrollbar {
  width: 6px;
}

.sui-panel::-webkit-scrollbar-track {
  background: transparent;
}

.sui-panel::-webkit-scrollbar-thumb {
  background: #444;
  border-radius: 3px;
}

.sui-panel::-webkit-scrollbar-thumb:hover {
  background: #555;
}

/* ── Mobile: bottom-sheet panel ── */
@media (max-width: 768px) {
  .sui-panel {
    top: auto !important;
    right: 0 !important;
    bottom: 0;
    left: 0;
    width: 100%;
    max-height: 50vh;
    border-radius: 12px 12px 0 0;
    transform: translateY(0);
    transition: transform 0.3s ease-out, max-height 0.3s ease-out;
    -webkit-overflow-scrolling: touch;
  }

  .sui-panel.collapsed {
    max-height: none;
    transform: translateY(calc(100% - 44px));
    border-radius: 12px 12px 0 0;
    overflow: hidden;
  }

  .sui-panel-title {
    padding: 12px 16px;
    font-size: 13px;
    border-radius: 12px 12px 0 0;
    position: sticky;
    top: 0;
    z-index: 1;
    background: rgba(40, 40, 40, 0.98);
    touch-action: manipulation;
  }

  .sui-panel-title::before {
    content: "";
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 32px;
    height: 4px;
    background: #555;
    border-radius: 2px;
  }

  .sui-panel-collapse {
    font-size: 12px;
    padding: 4px 10px;
  }

  .sui-folder-header {
    padding: 10px 14px;
    min-height: 44px;
  }

  .sui-control {
    padding: 6px 10px 6px 14px;
    min-height: 44px;
    gap: 10px;
  }

  .sui-slider {
    height: 6px;
  }

  .sui-slider::-webkit-slider-thumb {
    width: 20px;
    height: 20px;
  }

  .sui-slider::-moz-range-thumb {
    width: 20px;
    height: 20px;
  }

  .sui-number-input {
    width: 50px;
    padding: 6px;
    font-size: 13px;
  }

  .sui-checkbox {
    width: 20px;
    height: 20px;
  }

  .sui-select {
    padding: 8px 8px;
    font-size: 13px;
  }

  .sui-button {
    padding: 10px 14px;
    font-size: 13px;
  }

  .sui-label {
    font-size: 12px;
  }

  .sui-color-input {
    width: 36px;
    height: 28px;
  }

  .sui-color-hex {
    padding: 6px;
    font-size: 12px;
  }
}
`;

let injected = false;

export function injectStyles(): void {
  if (injected) return;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  injected = true;
}
