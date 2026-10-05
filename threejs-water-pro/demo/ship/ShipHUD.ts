// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { AudioManager } from "../audio/AudioManager";
import type { ShipController } from "./ShipController";
import type { CameraController, CameraMode } from "./CameraController";

interface ControlItem {
  key: string;
  action: string;
}

const CONTROLS: Record<CameraMode, ControlItem[]> = {
  freeCamera: [
    { action: "Orbit", key: "LMB" },
    { action: "Pan", key: "RMB" },
    { action: "Zoom", key: "Scroll" },
  ],
  flightCamera: [
    { action: "Move", key: "WASD" },
    { action: "Down / Up", key: "Q / E" },
    { action: "Sprint", key: "Shift" },
    { action: "Look", key: "Mouse" },
    { action: "Release", key: "Esc" },
  ],
  thirdPerson: [
    { action: "Throttle", key: "W / S" },
    { action: "Rudder", key: "A / D" },
  ],
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
const MONO = "'SF Mono', 'Cascadia Code', 'Consolas', monospace";

/**
 * Unified HUD overlay for the upper-left corner.
 *
 * Desktop: performance stats, camera controls, audio toggle.
 * Mobile: horizontal performance bar at top with audio toggle.
 */
export class ShipHUD {
  private container: HTMLDivElement;
  private perfGrid!: HTMLDivElement;
  private controlsSection: HTMLDivElement;
  private modeLabel: HTMLDivElement;
  private telemetry: HTMLDivElement;
  private controlsContainer: HTMLDivElement;
  private audioBtn: HTMLButtonElement;
  private audioOn = false;

  private fadeTick = 0;
  private lastModeName = "";
  private lastMode: CameraMode | null = null;
  private isMobile: boolean;

  constructor(audioManager: AudioManager) {
    this.isMobile = window.matchMedia("(max-width: 768px)").matches;
    window.matchMedia("(max-width: 768px)").addEventListener("change", (e) => {
      this.isMobile = e.matches;
      this.applyLayout();
    });

    this.container = document.createElement("div");
    this.container.id = "hud-overlay";

    // Performance stats
    this.container.appendChild(this.createPerfSection());

    // Controls section (desktop only)
    this.controlsSection = document.createElement("div");

    this.modeLabel = document.createElement("div");
    Object.assign(this.modeLabel.style, {
      fontSize: "10px",
      fontFamily: FONT,
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: "1px",
      color: "rgba(255, 255, 255, 0.3)",
      marginBottom: "8px",
      transition: "opacity 0.4s",
    });
    this.controlsSection.appendChild(this.modeLabel);

    this.telemetry = document.createElement("div");
    this.telemetry.style.display = "none";
    this.controlsSection.appendChild(this.telemetry);

    this.controlsContainer = document.createElement("div");
    Object.assign(this.controlsContainer.style, {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
    });
    this.controlsSection.appendChild(this.controlsContainer);

    this.container.appendChild(this.controlsSection);

    // Audio toggle
    this.audioBtn = this.createAudioButton(audioManager);
    this.container.appendChild(this.audioBtn);

    // Hide old HTML #performance div
    const oldPerf = document.getElementById("performance");
    if (oldPerf) oldPerf.style.display = "none";

    document.body.appendChild(this.container);
    this.applyLayout();
  }

  private applyLayout(): void {
    const divider = this.container.querySelector<HTMLElement>(".hud-divider");

    if (this.isMobile) {
      Object.assign(this.container.style, {
        position: "fixed",
        top: "0", left: "0", right: "0", bottom: "",
        width: "100%",
        minWidth: "unset",
        borderRadius: "0",
        padding: "8px 12px",
        background: "rgba(0, 0, 0, 0.75)",
        zIndex: "1000",
        fontFamily: MONO,
        fontSize: "11px",
        color: "rgba(255, 255, 255, 0.85)",
        userSelect: "none",
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "0",
        borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
        border: "",
      });

      // Horizontal inline stats
      Object.assign(this.perfGrid.style, {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "12px",
        flex: "1",
        gridTemplateColumns: "",
      });
      this.perfGrid.querySelectorAll<HTMLElement>(".hud-stat").forEach((item) => {
        Object.assign(item.style, {
          display: "flex",
          alignItems: "baseline",
          gap: "4px",
        });
      });
      // Use short labels on mobile
      this.perfGrid.querySelectorAll<HTMLElement>(".hud-label").forEach((el) => {
        el.textContent = el.dataset.short ?? el.textContent;
        el.style.fontSize = "12px";
      });
      this.perfGrid.querySelectorAll<HTMLElement>(".hud-value").forEach((el) => {
        el.style.fontSize = "12px";
        el.style.textAlign = "";
      });

      if (divider) divider.style.display = "none";
      this.controlsSection.style.display = "none";
      Object.assign(this.audioBtn.style, {
        position: "static",
        marginTop: "0",
        marginLeft: "auto",
        flexShrink: "0",
      });
    } else {
      Object.assign(this.container.style, {
        position: "fixed",
        top: "12px", left: "12px", right: "", bottom: "",
        width: "150px", minWidth: "",
        borderRadius: "10px",
        padding: "12px 14px",
        background: "rgba(10, 12, 16, 0.65)",
        zIndex: "1000",
        fontFamily: MONO,
        fontSize: "11px",
        color: "rgba(255, 255, 255, 0.85)",
        userSelect: "none",
        pointerEvents: "none",
        display: "block",
        flexDirection: "", alignItems: "", gap: "",
        borderBottom: "",
        border: "1px solid rgba(255, 255, 255, 0.06)",
      });

      // Two-column grid for desktop
      Object.assign(this.perfGrid.style, {
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: "2px 14px",
        alignItems: "baseline",
        flex: "",
        flexDirection: "",
      });
      this.perfGrid.querySelectorAll<HTMLElement>(".hud-stat").forEach((item) => {
        Object.assign(item.style, {
          display: "contents",
          alignItems: "",
          gap: "",
        });
      });
      // Use full labels on desktop
      this.perfGrid.querySelectorAll<HTMLElement>(".hud-label").forEach((el) => {
        const stats: Record<string, string> = {
          "": "GPU", "FPS": "FPS", "\u23F1": "Frame",
          "\u270E": "Draws", "\u25B3": "Tris", "\u25A0": "DPR",
        };
        const short = el.dataset.short ?? "";
        el.textContent = stats[short] ?? el.textContent;
        el.style.fontSize = "11px";
      });
      this.perfGrid.querySelectorAll<HTMLElement>(".hud-value").forEach((el) => {
        el.style.fontSize = "12px";
        el.style.textAlign = "right";
      });

      if (divider) divider.style.display = "";
      this.controlsSection.style.display = "block";
      Object.assign(this.audioBtn.style, {
        position: "static",
        marginTop: "10px",
        marginLeft: "0",
        flexShrink: "",
      });
    }
  }

  private createPerfSection(): HTMLDivElement {
    const section = document.createElement("div");
    section.style.marginBottom = "0";

    const stats: Array<{ label: string; shortLabel: string; id: string }> = [
      { label: "GPU", shortLabel: "", id: "hud-renderer" },
      { label: "FPS", shortLabel: "FPS", id: "hud-fps" },
      { label: "Frame", shortLabel: "\u23F1", id: "hud-frame-time" },
      { label: "Draws", shortLabel: "\u270E", id: "hud-draw-calls" },
      { label: "Tris", shortLabel: "\u25B3", id: "hud-triangles" },
      { label: "DPR", shortLabel: "\u25A0", id: "hud-pixel-ratio" },
    ];

    this.perfGrid = document.createElement("div");

    for (const { label, shortLabel, id } of stats) {
      const item = document.createElement("div");
      item.className = "hud-stat";

      const labelEl = document.createElement("span");
      labelEl.className = "hud-label";
      labelEl.dataset.short = shortLabel;
      Object.assign(labelEl.style, {
        fontFamily: FONT,
        fontSize: "11px",
        fontWeight: "500",
        color: "rgba(255, 255, 255, 0.35)",
        lineHeight: "20px",
      });
      labelEl.textContent = label;

      const valueEl = document.createElement("span");
      valueEl.id = id;
      valueEl.className = "hud-value";
      Object.assign(valueEl.style, {
        fontFamily: MONO,
        fontSize: "12px",
        fontWeight: "600",
        color: "rgba(255, 255, 255, 0.8)",
        textAlign: "right",
        lineHeight: "20px",
      });
      valueEl.textContent = "--";

      item.appendChild(labelEl);
      item.appendChild(valueEl);
      this.perfGrid.appendChild(item);
    }

    section.appendChild(this.perfGrid);

    // Divider before controls (desktop only, hidden on mobile via applyLayout)
    const divider = document.createElement("div");
    divider.className = "hud-divider";
    Object.assign(divider.style, {
      height: "1px",
      background: "rgba(255, 255, 255, 0.06)",
      margin: "10px -14px",
    });
    section.appendChild(divider);

    return section;
  }

  private createAudioButton(audioManager: AudioManager): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.title = "Toggle audio";
    Object.assign(btn.style, {
      width: "28px",
      height: "28px",
      borderRadius: "6px",
      border: "1px solid rgba(255, 255, 255, 0.08)",
      background: "rgba(255, 255, 255, 0.04)",
      color: "rgba(255, 255, 255, 0.35)",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0",
      pointerEvents: "auto",
      transition: "all 0.15s ease",
    });

    btn.appendChild(this.createSpeakerIcon(false));
    audioManager.setMuted(true);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.audioOn = !this.audioOn;
      audioManager.setMuted(!this.audioOn);
      btn.replaceChildren(this.createSpeakerIcon(this.audioOn));
      btn.style.color = this.audioOn
        ? "rgba(79, 195, 247, 0.9)"
        : "rgba(255, 255, 255, 0.35)";
      btn.style.borderColor = this.audioOn
        ? "rgba(79, 195, 247, 0.3)"
        : "rgba(255, 255, 255, 0.08)";
      btn.style.background = this.audioOn
        ? "rgba(79, 195, 247, 0.08)"
        : "rgba(255, 255, 255, 0.04)";
    });

    return btn;
  }

  private createSpeakerIcon(on: boolean): SVGSVGElement {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "13");
    svg.setAttribute("height", "13");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");

    const speaker = document.createElementNS(svgNS, "polygon");
    speaker.setAttribute("points", "11 5 6 9 2 9 2 15 6 15 11 19 11 5");
    svg.appendChild(speaker);

    if (on) {
      const wave1 = document.createElementNS(svgNS, "path");
      wave1.setAttribute("d", "M15.54 8.46a5 5 0 0 1 0 7.07");
      svg.appendChild(wave1);
      const wave2 = document.createElementNS(svgNS, "path");
      wave2.setAttribute("d", "M19.07 4.93a10 10 0 0 1 0 14.14");
      svg.appendChild(wave2);
    } else {
      const x1 = document.createElementNS(svgNS, "line");
      x1.setAttribute("x1", "23"); x1.setAttribute("y1", "9");
      x1.setAttribute("x2", "17"); x1.setAttribute("y2", "15");
      svg.appendChild(x1);
      const x2 = document.createElementNS(svgNS, "line");
      x2.setAttribute("x1", "17"); x2.setAttribute("y1", "9");
      x2.setAttribute("x2", "23"); x2.setAttribute("y2", "15");
      svg.appendChild(x2);
    }

    return svg;
  }

  private createControlRow(action: string, key: string): HTMLDivElement {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      justifyContent: "space-between",
      gap: "16px",
      lineHeight: "20px",
    });

    const actionEl = document.createElement("span");
    Object.assign(actionEl.style, {
      fontFamily: FONT,
      fontSize: "12px",
      color: "rgba(255, 255, 255, 0.65)",
    });
    actionEl.textContent = action;

    const keyEl = document.createElement("span");
    Object.assign(keyEl.style, {
      fontFamily: MONO,
      fontSize: "11px",
      color: "rgba(255, 255, 255, 0.25)",
    });
    keyEl.textContent = key;

    row.appendChild(actionEl);
    row.appendChild(keyEl);
    return row;
  }

  private createCameraModeRows(currentMode: CameraMode): HTMLDivElement {
    const container = document.createElement("div");
    Object.assign(container.style, {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      marginBottom: "4px",
      paddingBottom: "4px",
      borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
    });

    const modes: Array<{ key: string; label: string; mode: CameraMode }> = [
      { key: "1", label: "Orbit", mode: "freeCamera" },
      { key: "2", label: "Fly", mode: "flightCamera" },
      { key: "3", label: "Boat", mode: "thirdPerson" },
    ];

    for (const { key, label, mode } of modes) {
      const active = mode === currentMode;
      const row = this.createControlRow(label, key);
      if (active) {
        (row.firstChild as HTMLElement).style.color = "rgba(79, 195, 247, 0.9)";
        (row.firstChild as HTMLElement).style.fontWeight = "600";
        (row.lastChild as HTMLElement).style.color = "rgba(79, 195, 247, 0.5)";
      } else {
        (row.firstChild as HTMLElement).style.color = "rgba(255, 255, 255, 0.25)";
        (row.lastChild as HTMLElement).style.color = "rgba(255, 255, 255, 0.12)";
      }
      container.appendChild(row);
    }

    return container;
  }

  setVisible(visible: boolean): void {
    this.container.style.display = visible ? "" : "none";
    if (visible) this.applyLayout();
  }

  update(ship: ShipController, cam: CameraController): void {
    if (this.isMobile) return;

    const currentMode = cam.mode;

    const modeName = currentMode === "freeCamera"
      ? "Free Camera"
      : currentMode === "flightCamera"
        ? "Flight Camera"
        : "Third Person";

    if (modeName !== this.lastModeName) {
      this.lastModeName = modeName;
      this.modeLabel.textContent = modeName;
      this.modeLabel.style.opacity = "1";
      this.fadeTick = 120;
    }
    if (this.fadeTick > 0) {
      this.fadeTick--;
      if (this.fadeTick === 0) {
        this.modeLabel.style.opacity = "0.4";
      }
    }

    if (currentMode !== this.lastMode) {
      this.lastMode = currentMode;
      this.controlsContainer.replaceChildren();
      this.controlsContainer.appendChild(this.createCameraModeRows(currentMode));

      const controls = CONTROLS[currentMode];
      for (const { action, key } of controls) {
        this.controlsContainer.appendChild(this.createControlRow(action, key));
      }
    }

    if (cam.isBoatControlMode()) {
      const speed = Math.abs(ship.speed).toFixed(1);
      const throttle = (ship.throttle * 100).toFixed(0);

      this.telemetry.replaceChildren();
      this.telemetry.appendChild(this.createControlRow("Speed", `${speed} m/s`));
      this.telemetry.appendChild(this.createControlRow("Throttle", `${throttle}%`));
      this.telemetry.style.display = "flex";
      Object.assign(this.telemetry.style, {
        flexDirection: "column",
        gap: "2px",
        marginBottom: "6px",
        paddingBottom: "6px",
        borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
      });
    } else {
      this.telemetry.style.display = "none";
    }
  }

  dispose(): void {
    this.container.remove();
  }
}
