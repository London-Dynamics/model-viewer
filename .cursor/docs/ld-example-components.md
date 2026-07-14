# LD example component reference

Source of truth for shared styles: [`packages/modelviewer.dev/styles/ld-ui.css`](../../packages/modelviewer.dev/styles/ld-ui.css).

## Class reference

| Class | Purpose |
|---|---|
| `.ld-panel` | Bottom overlay wrapper |
| `.ld-card` / `.ld-card-body` / `.ld-card-toolbar` | White card shell and padding variants |
| `.ld-sections` / `.ld-section-title` | Divided sections inside a card |
| `.ld-axis-grid` / `.ld-field-row` / `.ld-field` | Grid and row layout for controls |
| `.ld-hud` + `.ld-hud-top-left` etc. | Viewport status readout overlays |
| `.ld-hud-passive` / `.ld-hud-narrow` | HUD modifiers |
| `.ld-panel-title` / `.ld-label` / `.ld-label-muted` / `.ld-helper-text` | Typography |
| `.ld-button` / `.ld-button-primary` / `.ld-button-danger` / `.ld-button-ghost` | Buttons |
| `.ld-button-sm` / `.ld-button-pill` | Compact and pill-shaped buttons |
| `.ld-switch` + `.ld-switch-thumb` | `role="switch"` toggle buttons |
| `.ld-switch-row` | Horizontal switch + label row |
| `.ld-sections-loose` / `.ld-field-row-between` | Spacious sections / spaced control rows |
| `.ld-button-group` + `.ld-button-group-btn-*` | Segmented button groups |
| `.ld-input` / `.ld-input-number` / `.ld-textarea` | Text inputs |
| `.ld-select-wrap` + `.ld-select` + `.ld-select-chevron` | Select with chevron |
| `.ld-toggle` + `.ld-toggle-thumb` + `.ld-toggle-input` | Toggle switch (checkbox) |
| `.ld-range` | Range slider track |
| `.ld-color-input` | Color picker |
| `.ld-badge` / `.ld-divider` | Status pill / horizontal rule |

## Snippets

**Select with chevron:**

```html
<div class="ld-select-wrap">
  <select class="ld-select" id="my-select">…</select>
  <span class="ld-select-chevron" aria-hidden="true">▾</span>
</div>
```

**Switch button (`role="switch"`):**

```html
<button type="button" class="ld-switch" role="switch" aria-checked="false">
  <span class="ld-switch-thumb" aria-hidden="true"></span>
</button>
```

**Toggle switch:**

```html
<div class="ld-toggle">
  <span class="ld-toggle-thumb"></span>
  <input type="checkbox" class="ld-toggle-input" aria-label="Use setting" />
</div>
```

**Segmented button group:**

```html
<div class="ld-button-group">
  <button type="button" class="ld-button-group-btn-first">First</button>
  <button type="button" class="ld-button-group-btn">Middle</button>
  <button type="button" class="ld-button-group-btn-last">Last</button>
</div>
```
