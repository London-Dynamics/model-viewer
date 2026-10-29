/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const FRAME_HISTORY_SIZE = 180;
const UPDATE_INTERVAL_MS = 250;
const MB = 1024 * 1024;
const formatNumber = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '-';
const formatMetricValue = (value) => {
    if (value == null) {
        return '-';
    }
    return typeof value === 'number' ? formatNumber(value) : value;
};
const percentile = (values, ratio) => {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index];
};
const average = (values) => {
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((total, value) => total + value, 0) / values.length;
};
const getMemoryInfo = () => performance.memory;
const getWebGLInfo = () => {
    var _a;
    const canvas = document.createElement('canvas');
    const gl = (_a = canvas.getContext('webgl2')) !== null && _a !== void 0 ? _a : canvas.getContext('webgl');
    if (gl == null) {
        return undefined;
    }
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo == null) {
        return {
            vendor: gl.getParameter(gl.VENDOR),
            renderer: gl.getParameter(gl.RENDERER),
        };
    }
    return {
        vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
        renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
    };
};
const addMetricRow = (list, label) => {
    const row = document.createElement('div');
    row.className = 'performance-analyser-row';
    const labelElement = document.createElement('span');
    labelElement.textContent = label;
    const valueElement = document.createElement('strong');
    valueElement.textContent = '-';
    row.append(labelElement, valueElement);
    list.append(row);
    return valueElement;
};
export const createPerformanceAnalyser = ({ target, mount, title = 'Performance', extraMetrics = [], }) => {
    let animationFrame = 0;
    let lastFrameTime = performance.now();
    let lastUpdateTime = 0;
    let frameDurations = [];
    let longTaskCount = 0;
    let worstLongTaskMs = 0;
    let renderScale;
    const metricRateState = new Map();
    const webgl = getWebGLInfo();
    const root = document.createElement('section');
    root.className = 'performance-analyser';
    root.setAttribute('aria-label', title);
    const header = document.createElement('div');
    header.className = 'performance-analyser-header';
    const heading = document.createElement('h3');
    heading.textContent = title;
    const actions = document.createElement('div');
    actions.className = 'performance-analyser-actions';
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.textContent = 'Reset';
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'Copy JSON';
    actions.append(resetButton, copyButton);
    header.append(heading, actions);
    root.append(header);
    const list = document.createElement('div');
    list.className = 'performance-analyser-grid';
    root.append(list);
    const extraValueElements = new Map();
    const values = {
        fps: addMetricRow(list, 'FPS'),
        onePercentLow: addMetricRow(list, '1% low'),
        frame: addMetricRow(list, 'Frame'),
        p95Frame: addMetricRow(list, 'p95 frame'),
        renderScale: addMetricRow(list, 'Render DPR'),
        renderSize: addMetricRow(list, 'Render size'),
        heap: addMetricRow(list, 'JS heap'),
        longTasks: addMetricRow(list, 'Long tasks'),
        gpu: addMetricRow(list, 'GPU'),
    };
    for (const metric of extraMetrics) {
        extraValueElements.set(metric.label, addMetricRow(list, metric.label));
    }
    mount.replaceChildren(root);
    const reset = () => {
        frameDurations = [];
        longTaskCount = 0;
        worstLongTaskMs = 0;
        metricRateState.clear();
        lastFrameTime = performance.now();
    };
    const snapshot = () => {
        var _a;
        const heap = getMemoryInfo();
        const averageFrameMs = average(frameDurations);
        const p99FrameMs = percentile(frameDurations, 0.99);
        const extraMetricSnapshot = {};
        for (const metric of extraMetrics) {
            const value = metric.read();
            if (metric.rate === true && typeof value === 'number') {
                const now = performance.now();
                const previous = metricRateState.get(metric.label);
                metricRateState.set(metric.label, { time: now, value });
                const rate = previous == null || now === previous.time ? 0 :
                    (value - previous.value) / ((now - previous.time) / 1000);
                extraMetricSnapshot[metric.label] =
                    `${formatNumber(value)} (${formatNumber(Math.max(0, rate))}/s)`;
            }
            else {
                extraMetricSnapshot[metric.label] = formatMetricValue(value);
            }
        }
        return {
            averageFps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
            onePercentLowFps: p99FrameMs > 0 ? 1000 / p99FrameMs : 0,
            averageFrameMs,
            p95FrameMs: percentile(frameDurations, 0.95),
            currentFrameMs: (_a = frameDurations[frameDurations.length - 1]) !== null && _a !== void 0 ? _a : 0,
            longTaskCount,
            worstLongTaskMs,
            heapUsedMb: heap != null ? heap.usedJSHeapSize / MB : undefined,
            heapTotalMb: heap != null ? heap.totalJSHeapSize / MB : undefined,
            renderScale,
            webgl,
            extraMetrics: extraMetricSnapshot,
        };
    };
    const update = () => {
        var _a;
        const stats = snapshot();
        const currentFps = 1000 / stats.currentFrameMs;
        values.fps.textContent =
            `${formatNumber(currentFps)} / avg ${formatNumber(stats.averageFps)}`;
        values.onePercentLow.textContent = formatNumber(stats.onePercentLowFps);
        values.frame.textContent =
            `${formatNumber(stats.currentFrameMs)} ms / avg ${formatNumber(stats.averageFrameMs)} ms`;
        values.p95Frame.textContent = `${formatNumber(stats.p95FrameMs)} ms`;
        if (stats.renderScale != null) {
            values.renderScale.textContent =
                `${formatNumber(stats.renderScale.renderedDpr, 2)} / reported ${formatNumber(stats.renderScale.reportedDpr, 2)}`;
            values.renderSize.textContent =
                `${stats.renderScale.pixelWidth} x ${stats.renderScale.pixelHeight}${stats.renderScale.reason ? ` (${stats.renderScale.reason})` : ''}`;
        }
        else {
            const rect = target.getBoundingClientRect();
            values.renderScale.textContent = formatNumber(window.devicePixelRatio, 2);
            values.renderSize.textContent =
                `${Math.round(rect.width)} x ${Math.round(rect.height)} CSS px`;
        }
        values.heap.textContent = stats.heapUsedMb == null ?
            'unavailable' :
            `${formatNumber(stats.heapUsedMb)} / ${formatNumber((_a = stats.heapTotalMb) !== null && _a !== void 0 ? _a : 0)} MB`;
        values.longTasks.textContent =
            `${stats.longTaskCount} / worst ${formatNumber(stats.worstLongTaskMs)} ms`;
        values.gpu.textContent = stats.webgl == null ? 'unavailable' :
            `${stats.webgl.renderer}`;
        for (const metric of extraMetrics) {
            extraValueElements.get(metric.label).textContent =
                String(stats.extraMetrics[metric.label]);
        }
    };
    const tick = (time) => {
        const delta = time - lastFrameTime;
        lastFrameTime = time;
        if (delta > 0 && delta < 1000) {
            frameDurations.push(delta);
            if (frameDurations.length > FRAME_HISTORY_SIZE) {
                frameDurations.shift();
            }
        }
        if (time - lastUpdateTime > UPDATE_INTERVAL_MS) {
            update();
            lastUpdateTime = time;
        }
        animationFrame = requestAnimationFrame(tick);
    };
    const observer = 'PerformanceObserver' in window ?
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                longTaskCount++;
                worstLongTaskMs = Math.max(worstLongTaskMs, entry.duration);
            }
        }) :
        null;
    try {
        observer === null || observer === void 0 ? void 0 : observer.observe({ type: 'longtask', buffered: true });
    }
    catch (_error) {
        observer === null || observer === void 0 ? void 0 : observer.disconnect();
    }
    const onRenderScale = (event) => {
        renderScale = event.detail;
    };
    target.addEventListener('render-scale', onRenderScale);
    resetButton.addEventListener('click', reset);
    copyButton.addEventListener('click', async () => {
        const json = JSON.stringify(snapshot(), null, 2);
        try {
            await navigator.clipboard.writeText(json);
            copyButton.textContent = 'Copied';
            setTimeout(() => {
                copyButton.textContent = 'Copy JSON';
            }, 1000);
        }
        catch (_error) {
            console.log(json);
        }
    });
    animationFrame = requestAnimationFrame(tick);
    return {
        reset,
        snapshot,
        destroy() {
            cancelAnimationFrame(animationFrame);
            observer === null || observer === void 0 ? void 0 : observer.disconnect();
            target.removeEventListener('render-scale', onRenderScale);
            root.remove();
        },
    };
};
//# sourceMappingURL=performance-analyser.js.map