export interface ConflictRetryResult<T> {
  ok: boolean;
  result: T | null;
  attempts: number;
}

export async function runWithConflictRetry<T>(options: {
  operate: () => Promise<T>;
  persist: (result: T) => Promise<boolean>;
  maxAttempts?: number;
}): Promise<ConflictRetryResult<T>> {
  const maxAttempts = Math.max(1, Math.round(options.maxAttempts ?? 2));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await options.operate();
    if (await options.persist(result)) {
      return {
        ok: true,
        result,
        attempts: attempt,
      };
    }
  }

  return {
    ok: false,
    result: null,
    attempts: maxAttempts,
  };
}
