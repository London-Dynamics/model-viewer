export function getErrorMessage(err: unknown): string {
  if (err === undefined || err === null) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (typeof err === 'number' || typeof err === 'boolean') return String(err);
  // Error instance (most common)
  if (err instanceof Error) return err.message;
  // Some error-like objects carry a `message` field
  if (typeof err === 'object') {
    try {
      const anyErr = err as { message?: unknown; error?: unknown };
      if (typeof anyErr.message === 'string') return anyErr.message;
      if (typeof anyErr.error === 'string') return anyErr.error;
      // If the object has an `error` that is itself an Error, unwrap it
      if (anyErr.error instanceof Error) return anyErr.error.message;
    } catch {
      // fall through to stringify
    }
  }
  // Fallback: try JSON, else string conversion
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
