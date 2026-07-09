/**
 * Persists demo params to `localStorage` so user edits survive a page
 * refresh. The store does not know about preset shape — it just deep-merges
 * a snapshot blob back into the live params object on load, and snapshots
 * the params object (plus an optional live-extract overlay) on a 1s timer.
 */
export class ParamsStore<T extends object> {
  constructor(
    private readonly _storageKey: string,
    private readonly _params: T,
    /** Called once per autosave tick to fold live shader values back into params. */
    private readonly _onBeforeSave?: () => void,
  ) {}

  /**
   * Read the persisted blob from localStorage and merge it into `params`.
   * Silently swallows corrupt data — there's no useful recovery here.
   */
  load(): void {
    try {
      const saved = localStorage.getItem(this._storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        deepMerge(this._params, parsed);
      }
    } catch {
      // Ignore corrupt localStorage data
    }
  }

  /**
   * Start a 1s timer that calls `onBeforeSave` (if provided) and then
   * writes `params` to localStorage. Quota errors are ignored.
   */
  startAutoSave(): void {
    setInterval(() => {
      try {
        this._onBeforeSave?.();
        localStorage.setItem(this._storageKey, JSON.stringify(this._params));
      } catch {
        // Ignore quota errors / transient race conditions
      }
    }, 1000);
  }
}

/**
 * Recursively merges plain-object source values into target. Arrays and
 * primitives at the source override the target value. Keys present on
 * source but absent on target are skipped — the schema is owned by target.
 */
export function deepMerge(target: unknown, source: unknown): void {
  const t = target as Record<string, unknown>;
  const s = source as Record<string, unknown>;
  for (const key in s) {
    const sourceVal = s[key];
    const targetVal = t[key];
    if (
      typeof sourceVal === "object" &&
      sourceVal !== null &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === "object" &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      deepMerge(targetVal, sourceVal);
    } else if (key in t) {
      t[key] = sourceVal;
    }
  }
}
