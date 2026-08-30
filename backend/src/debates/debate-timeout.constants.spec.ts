import {
  getDebateExpiresAt,
  getDebateTotalDurationMs,
  isDebateLiveExpired,
} from "./debate-timeout.constants";

describe("debate timeout constants", () => {
  it.each([
    [1, 15],
    [3, 27],
    [4, 33],
    [9, 63],
  ])("allows %i rebuttal rounds for %i minutes", (rounds, minutes) => {
    expect(getDebateTotalDurationMs(rounds)).toBe(minutes * 60 * 1000);
  });

  it("calculates the live debate expiration from its round count", () => {
    const startedAt = new Date("2026-08-24T00:00:00.000Z");

    expect(getDebateExpiresAt(startedAt, 4)?.toISOString()).toBe(
      "2026-08-24T00:33:00.000Z",
    );
  });

  it("expires only after the calculated live debate deadline", () => {
    const debate = {
      startedAt: new Date("2026-08-24T00:00:00.000Z"),
      rebuttalQuestionRounds: 4,
    };

    expect(
      isDebateLiveExpired(
        debate,
        new Date("2026-08-24T00:32:59.999Z").getTime(),
      ),
    ).toBe(false);
    expect(
      isDebateLiveExpired(
        debate,
        new Date("2026-08-24T00:33:00.000Z").getTime(),
      ),
    ).toBe(true);
  });
});
