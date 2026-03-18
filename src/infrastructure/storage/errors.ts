export class LedgerCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerCorruptionError';
    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LedgerCorruptionError);
    }
  }
}

export class ResourceLockedError extends Error {
  constructor(resourceId: string) {
    super(`Resource ${resourceId} is currently locked.`);
    this.name = 'ResourceLockedError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ResourceLockedError);
    }
  }
}
