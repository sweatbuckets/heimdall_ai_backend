import { withAbortableTimeout } from "./gemini-timeout.util";

describe("withAbortableTimeout", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("aborts the active request when its timeout expires", async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const result = withAbortableTimeout(
      async (signal) => {
        requestSignal = signal;
        return new Promise<string>(() => undefined);
      },
      1000,
      "request timed out",
    );
    const rejection = expect(result).rejects.toThrow("request timed out");

    await jest.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });

  it("propagates cancellation from the parent signal", async () => {
    const parentController = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const cancellationError = new Error("debate cancelled");
    const result = withAbortableTimeout(
      async (signal) => {
        requestSignal = signal;
        return new Promise<string>(() => undefined);
      },
      10000,
      "request timed out",
      parentController.signal,
    );
    const rejection = expect(result).rejects.toBe(cancellationError);

    parentController.abort(cancellationError);

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });
});
