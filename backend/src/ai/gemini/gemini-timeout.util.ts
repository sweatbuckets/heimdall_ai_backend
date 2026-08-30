export async function withAbortableTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const propagateParentAbort = () => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal?.aborted) {
    propagateParentAbort();
  } else {
    parentSignal?.addEventListener("abort", propagateParentAbort, {
      once: true,
    });
  }

  const timeoutError = new Error(timeoutMessage);
  const timeout = setTimeout(() => {
    controller.abort(timeoutError);
  }, timeoutMs);
  const aborted = new Promise<never>((_, reject) => {
    const rejectWithAbortReason = () => {
      reject(
        controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new Error("Gemini request was aborted."),
      );
    };

    if (controller.signal.aborted) {
      rejectWithAbortReason();
      return;
    }
    controller.signal.addEventListener("abort", rejectWithAbortReason, {
      once: true,
    });
  });

  try {
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", propagateParentAbort);
  }
}
