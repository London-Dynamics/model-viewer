export interface PerformanceMetric {
    label: string;
    read: () => string | number | null | undefined;
    rate?: boolean;
}
export interface PerformanceAnalyserOptions {
    target: HTMLElement;
    mount: HTMLElement;
    title?: string;
    extraMetrics?: PerformanceMetric[];
}
export interface PerformanceSnapshot {
    averageFps: number;
    onePercentLowFps: number;
    averageFrameMs: number;
    p95FrameMs: number;
    currentFrameMs: number;
    longTaskCount: number;
    worstLongTaskMs: number;
    heapUsedMb?: number;
    heapTotalMb?: number;
    renderScale?: RenderScaleDetail;
    webgl?: WebGLInfo;
    extraMetrics: Record<string, string | number>;
}
interface RenderScaleDetail {
    reportedDpr: number;
    renderedDpr: number;
    minimumDpr: number;
    pixelWidth: number;
    pixelHeight: number;
    reason: string;
}
interface WebGLInfo {
    vendor: string;
    renderer: string;
}
export declare const createPerformanceAnalyser: ({ target, mount, title, extraMetrics, }: PerformanceAnalyserOptions) => {
    reset: () => void;
    snapshot: () => PerformanceSnapshot;
    destroy(): void;
};
export {};
