# Debate HTTP API

WebSocket is the primary realtime contract. These HTTP APIs provide the minimum
backend contract needed to create debates, inspect debate state, and test the
same Redis draft/finalize flow without a WebSocket client.

## Create Debate

Create two members first and use their `id` values as `sideASpeakerId` and
`sideBSpeakerId`.

```http
POST /debates
Content-Type: application/json
```

```json
{
  "topic": "AI regulation should be mandatory",
  "sideASpeakerId": "uuid",
  "sideBSpeakerId": "uuid",
  "rebuttalQuestionRounds": 2
}
```

Creates a debate in `READY` status.

## Start Debate

```http
POST /debates/{debateId}/start
```

Request body is not required.

This transitions `READY -> IN_PROGRESS` and opens the first turn:

```json
{
  "status": "IN_PROGRESS",
  "currentPhase": "OPENING",
  "currentRound": 1,
  "currentTurnSide": "SIDE_A",
  "currentTurnStartedAt": "2026-07-12T10:00:00.000Z"
}
```

## Member CRUD

```http
POST /members
Content-Type: application/json
```

```json
{
  "displayName": "Alice",
  "profileImageUrl": null
}
```

```http
GET /members
GET /members/{memberId}
PATCH /members/{memberId}
DELETE /members/{memberId}
```

`DELETE /members/{memberId}` returns `409 Conflict` if the member is already
used by a debate.

## List Debates

```http
GET /debates
GET /debates?status=IN_PROGRESS
```

Returns up to 50 debates ordered by `createdAt DESC`.

## Get Debate Detail

```http
GET /debates/{debateId}
```

Returns debate metadata and finalized `DebateTurn` rows.

## Get Chat Snapshot

```http
GET /debates/{debateId}/chat
```

Returns the same snapshot used by WebSocket `connection.restored`.

```json
{
  "currentTurn": {
    "phase": "OPENING",
    "round": 1,
    "turnSide": "SIDE_A",
    "startedAt": "2026-07-12T10:00:00.000Z",
    "maxDurationSeconds": 120,
    "maxTotalCharacters": 1000
  },
  "turns": [],
  "draftMessages": []
}
```

## Append Draft Message

```http
POST /debates/{debateId}/chat/messages
Content-Type: application/json
```

```json
{
  "clientMessageId": "client-message-1",
  "speakerId": "uuid",
  "speakerSide": "SIDE_A",
  "phase": "OPENING",
  "round": 1,
  "content": "first draft message"
}
```

This appends to Redis only. It does not create a `DebateTurn` and does not call
Analyzer.

The backend validates the command against `debate.currentPhase`,
`debate.currentRound`, `debate.currentTurnSide`, and
`debate.currentTurnStartedAt`. A turn can contain multiple draft messages, but
the Redis draft content total must not exceed 1000 characters.

## Finalize Turn

```http
POST /debates/{debateId}/chat/finalize
Content-Type: application/json
```

```json
{
  "speakerId": "uuid",
  "speakerSide": "SIDE_A",
  "phase": "OPENING",
  "round": 1
}
```

This reads Redis draft messages, inserts one finalized `DebateTurn`, clears the
draft, enqueues Analyzer, and advances the debate current turn. After final
`CLOSING` is finalized, the debate moves to `FINAL_FACT_CHECKING` and current
turn fields are cleared.

If `FACT_CHECK_ENABLED=false`, Analyzer still creates `FactCheckBatchTask` and
`FactCheckBatchTarget` rows when needed, but it does not enqueue the Fact Checker
BullMQ job. This is useful for local testing when Gemini Grounding quota is
limited.

## Transition Debate To Judging

```http
POST /debates/{debateId}/judging
```

Request body is not required.

This transitions a debate to `JUDGING` so the Judge API can run. The current
implementation allows only `FINAL_FACT_CHECKING` to enter `JUDGING`.

Calling this API while the debate is already `JUDGING` returns the current
debate. `COMPLETED` and `FAILED` debates return `409 Conflict`.

## Judge Debate

```http
POST /debates/{debateId}/judge
```

Request body is not required.

This runs the normal Judge flow:

- validates the debate is `JUDGING`
- validates every turn analysis is `COMPLETED`
- validates every fact-check batch task is `COMPLETED`
- validates required fact-check results exist exactly once
- calls Gemini Judge
- saves one `JudgmentResult`
- transitions the debate from `JUDGING` to `COMPLETED`

Response:

```json
{
  "id": "uuid",
  "debateId": "uuid",
  "winner": "SIDE_A",
  "sideAArgumentationScore": 33,
  "sideAInteractionScore": 24,
  "sideAFactualReliabilityScore": 21,
  "sideATotalScore": 78,
  "sideBArgumentationScore": 29,
  "sideBInteractionScore": 22,
  "sideBFactualReliabilityScore": 18,
  "sideBTotalScore": 69,
  "overallReason": "SIDE_A was stronger overall.",
  "sideAFeedback": "Good argument structure.",
  "sideBFeedback": "Needs stronger evidence.",
  "judgedAt": "2026-07-12T10:00:00.000Z"
}
```

If the debate is not ready to judge, the API returns `409 Conflict`.

## Get Debate Result

```http
GET /debates/{debateId}/result
```

Returns the debate metadata and saved judgment result. This API does not call
Gemini and does not change debate state.

Response:

```json
{
  "debate": {
    "id": "uuid",
    "topic": "AI regulation should be mandatory",
    "sideASpeakerId": "uuid",
    "sideBSpeakerId": "uuid",
    "rebuttalQuestionRounds": 2,
    "status": "COMPLETED",
    "createdAt": "2026-07-12T10:00:00.000Z",
    "startedAt": null,
    "endedAt": "2026-07-12T10:10:00.000Z"
  },
  "judgmentResult": {
    "id": "uuid",
    "debateId": "uuid",
    "winner": "SIDE_A",
    "sideAArgumentationScore": 33,
    "sideAInteractionScore": 24,
    "sideAFactualReliabilityScore": 21,
    "sideATotalScore": 78,
    "sideBArgumentationScore": 29,
    "sideBInteractionScore": 22,
    "sideBFactualReliabilityScore": 18,
    "sideBTotalScore": 69,
    "overallReason": "SIDE_A was stronger overall.",
    "sideAFeedback": "Good argument structure.",
    "sideBFeedback": "Needs stronger evidence.",
    "judgedAt": "2026-07-12T10:10:00.000Z"
  }
}
```

If judgment has not been created yet, this API returns `404 Not Found`.
