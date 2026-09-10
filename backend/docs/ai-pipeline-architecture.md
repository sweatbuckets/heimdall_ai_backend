# Heimdall AI 파이프라인 아키텍처

이 문서는 현재 `heimdall_ai/backend` 코드 기준으로 Analyzer → FactCheck(Grounding → Synthesis) → Judge 파이프라인의 호출 방식, 입출력 스키마, 큐 재시도, timeout/stale recovery, 상태 전이를 정리한다.

## 1. 전체 흐름

```text
토론 턴 2개 확정
  ↓
Analyzer round job (BullMQ)
  ├─ accumulatedGraph + 현재 라운드의 두 turn → Gemini JSON
  ├─ argument component/relation 저장
  └─ fact-check 대상이 있으면 FactCheckBatch + Grounding task 생성
       ↓
Grounding job (BullMQ)
  ├─ 대상 최대 10개, Google Search grounding
  └─ FactCheckGroundingSnapshot 저장 → Synthesis task/job 생성
       ↓
Synthesis job (BullMQ)
  ├─ snapshot + target 입력 → Gemini JSON
  └─ fact_check_result/source 저장, batch COMPLETED
       ↓
모든 turn 분석·fact-check 완료
  ↓
Judge task/job (BullMQ)
  ├─ 전체 argument graph + fact-check 결과 → Gemini JSON
  └─ 점수 합산·승자 계산·judgment_result 저장
```

Analyzer는 라운드당 두 turn을 하나의 job으로 처리한다. 이전 sequence의 turn 분석이 끝나야 다음 라운드가 실행된다. FactCheck는 라운드별 batch이며 Grounding과 Synthesis는 서로 다른 stage task/job이다. Judge는 토론 전체에 하나의 task만 생성된다.

## 2. 공통 Gemini 호출 규칙

AI 서비스는 `@google/genai`의 `GoogleGenAI.models.generateContent()`를 사용한다.

- `systemInstruction`: 단계별 고정 규칙
- `contents`: 단계별 JSON 직렬화 입력
- 구조화 출력 단계는 `responseMimeType: "application/json"`과 `responseSchema` 사용
- `withAbortableTimeout()`으로 단계별 timeout을 적용하고 `AbortSignal`을 전달한다.
- Gemini 내부 재시도 로직은 두지 않는다. 실패는 BullMQ job 재시도로 처리한다.
- 응답 usage를 로그로 남긴다: `inputTokens`, `cachedTokens`, `outputTokens`, `thinkingTokens`, `totalTokens`, `durationMs`

### 기본 환경 설정

값은 `.env`에서 override할 수 있으며, 아래는 `.env.example` 및 코드 기본값이다.

| 항목 | 기본값 |
|---|---:|
| `GEMINI_ANALYZER_MODEL` | `gemini-3.6-flash` |
| `GEMINI_FACT_CHECKER_MODEL` | `gemini-3.6-flash` |
| `GEMINI_JUDGE_MODEL` | `gemini-3.6-flash` |
| `GEMINI_ANALYZER_THINKING_LEVEL` | `MEDIUM` |
| `GEMINI_FACT_CHECK_GROUNDING_THINKING_LEVEL` | `LOW` |
| `GEMINI_FACT_CHECK_SYNTHESIS_THINKING_LEVEL` | `LOW` |
| `GEMINI_JUDGE_THINKING_LEVEL` | `MEDIUM` |
| `GEMINI_ANALYZER_TIMEOUT_MS` | `70000` |
| `GEMINI_FACT_CHECK_GROUNDING_TIMEOUT_MS` | `90000` |
| `GEMINI_FACT_CHECK_SYNTHESIS_TIMEOUT_MS` | `70000` |
| `GEMINI_JUDGE_TIMEOUT_MS` | `40000` |
| `GEMINI_REQUEST_TIMEOUT_MS` | `90000` (legacy fallback) |

애플리케이션 시작 시 실제 timeout과 stale threshold를 `RuntimeConfig` 로그로 출력한다.

## 2.1 단계별 프롬프트 계약

아래 내용은 각 AI service의 `systemInstruction`과 user prompt builder를 문서화한 것이다. 정확한 운영 원문은 다음 파일을 canonical source로 삼는다.

- Analyzer: `src/analyzer/analyzer-ai.service.ts`
- Grounding/Synthesis: `src/fact-check/fact-checker-ai.service.ts`
- Judge: `src/judge/judge-ai.service.ts`

### Analyzer prompt

고정 system instruction의 핵심은 다음과 같다.

```text
You are a debate argument graph analyzer.
Analyze only dynamicRequest.currentTurns[].content as the source of NEW components.
dynamicRequest.currentTurns contains both speakers' turns for one debate round in sequence order.
accumulatedGraph.graphItems is an append-only list of prior graph items.
Interpret graphItems by kind: COMPONENT is a graph node, ARGUMENTAL_RELATION is a support/attack edge, and INTERACTIONAL_RELATION is a question/answer edge.
graphItems are read-only existing graph context. Create only NEW components and relations from currentTurns.
Return JSON only. Do not include markdown, commentary, or code fences.
```

추가 규칙으로 current turn당 component 최대 10개, fact-check target 최대 5개, `NEW_n` localKey, NEW → NEW/EXISTING relation만 허용한다. 빈 발언 sentinel은 component/relation/target을 만들지 않는다. user prompt는 다음과 같이 공통 context를 앞에, 동적 요청을 뒤에 둔다.

```json
{
  "debate": { "id": "...", "topic": "...", "sideASpeakerId": "...", "sideBSpeakerId": "...", "rebuttalQuestionRounds": 3 },
  "accumulatedGraph": { "graphItems": [] },
  "dynamicRequest": {
    "phase": "REBUTTAL_QUESTION",
    "round": 1,
    "currentTurns": [{ "id": "...", "speakerId": "...", "speakerSide": "SIDE_A", "phase": "REBUTTAL_QUESTION", "round": 1, "sequence": 3, "content": "..." }]
  }
}
```

### Grounding prompt

```text
You are a fact checker for debate argument components.
Use Google Search grounding to collect evidence for each target independently.
Keep the final grounded source set to at most five distinct sources.
Prefer official statistics, public institutions, academic sources, primary documents, and reputable original reporting.
For time-sensitive claims, verify them against the debate's reference time.
Do not force a definitive verdict when evidence is insufficient or the claim is not verifiable.
Include each componentId in the evidence discussion.
```

실제 user prompt에는 `debate`, `round`, `targets`와 함께 다음 제한을 넣는다.

```json
{
  "task": "Collect grounded evidence for each fact-check target.",
  "searchRules": {
    "maxDistinctSources": 5,
    "stopSearchingAfterLimit": true,
    "instruction": "Once 5 distinct usable sources have been found, stop searching and do not collect additional sources."
  },
  "debate": { "id": "...", "topic": "..." },
  "round": { "phase": "OPENING", "number": 1 },
  "targets": [{ "componentId": "...", "statement": "...", "turnId": "...", "sequence": 1, "speakerSide": "SIDE_A" }]
}
```

Grounding은 verdict JSON을 생성하지 않고 검색 결과를 evidence text/query/source bundle로 반환한다.

### Synthesis prompt

```text
You convert grounded evidence into a strict JSON fact-check batch result.
Return JSON only. Return exactly one result for every input target.
Use only the provided sourceIndexes. Never invent URLs or cite sources outside the provided source list.
Choose exactly one mutually exclusive status for each target.
Use SUPPORTED only for the full material claim; CONTRADICTED for a refuted material claim.
Use PARTIALLY_SUPPORTED only when one material part is supported and another is refuted.
Use INSUFFICIENT_EVIDENCE when a verifiable claim cannot be determined from available evidence.
Use NOT_VERIFIABLE when the claim cannot be empirically checked.
Use OUTDATED when a time-specific claim is no longer valid at the debate reference time.
```

user prompt는 Grounding snapshot을 재검색하지 않고 그대로 전달한다.

```json
{
  "task": "Synthesize the grounded evidence into FactCheckBatchOutput.",
  "input": { "debate": { "id": "...", "topic": "..." }, "round": { "phase": "OPENING", "number": 1 }, "targets": [] },
  "evidenceText": "...",
  "webSearchQueries": ["..."],
  "sources": [{ "sourceIndex": 0, "title": "...", "publisher": "...", "url": "..." }],
  "outputRules": { "oneResultPerTarget": true, "useSourceIndexesOnly": true, "maxSourceIndexesPerResult": 5, "doNotReturnUrls": true }
}
```

### Judge prompt

```text
You evaluate a completed debate using its argument graph and fact-check results.
Return JSON only. Score argumentation from 0 to 40, interaction from 0 to 30, and factual reliability from 0 to 30 for each side.
Apply fact-check statuses consistently. Do not penalize opinions, value judgments, or purely logical claims merely because they have no fact-check result.
Do not return totalScore, winner, or fields outside the schema.
Refer to speakers by their exact display names; never call a speaker SIDE_A, SIDE_B, Side A, Side B, 측면 A, or 측면 B in prose.
```

Judge user prompt는 `JSON.stringify(JudgeInput)` 그대로 전송하며, 서버가 total score와 winner를 계산한다.

## 3. Analyzer

### 호출 트리거와 큐

- 큐: `analyzer`
- job: `analyze-round`
- job data: `anchorTurnId`, `debateId`, `phase`, `round`
- job ID: `analyze-round-{debateId}-{phase}-{round}`
- `AnalyzerQueueService.findCompleteRound()`가 같은 phase/round의 turn 2개, 양쪽 speaker, 선행 turn 분석 완료를 확인한 뒤 enqueue한다.
- 워커는 anchor turn을 받지만 실제 입력은 해당 라운드의 두 turn이다.

관련 코드: `src/analyzer/analyzer-input.assembler.ts`, `src/analyzer/analyzer-ai.service.ts`, `src/analyzer/queues/analyzer-queue.service.ts`, `src/analyzer/queues/analyzer.processor.ts`.

### 입력 스키마

```ts
interface AnalyzeTurnInput {
  debate: {
    id: string; topic: string;
    sideASpeakerId: string; sideBSpeakerId: string;
    rebuttalQuestionRounds: number;
  };
  accumulatedGraph: { graphItems: ExistingGraphItem[] };
  currentTurns: Array<{
    id: string; speakerId: string; speakerSide: 'SIDE_A'|'SIDE_B';
    phase: 'OPENING'|'REBUTTAL_QUESTION'|'CLOSING';
    round: number; sequence: number; content: string;
  }>;
}
```

`graphItems`는 기존 `COMPONENT`, `ARGUMENTAL_RELATION`, `INTERACTIONAL_RELATION`을 하나의 append-only 목록으로 만들고 `createdAt`, `id` 기준으로 결정적으로 정렬한 값이다. 실제 Gemini user prompt는 다음 JSON 구조다.

```ts
JSON.stringify({
  debate,
  accumulatedGraph,
  dynamicRequest: { phase, round, currentTurns },
});
```

### 출력 스키마

```ts
interface AnalyzeTurnOutput {
  newComponents: Array<{
    localKey: `NEW_${number}`; turnId: string; statement: string;
    isMajorClaim: boolean; requiresFactCheck: boolean;
  }>;
  newArgumentalRelations: Array<{
    from: { source: 'NEW'; localKey: string };
    to: { source: 'NEW'; localKey: string } | { source: 'EXISTING'; componentId: string };
    type: 'SUPPORTS'|'ATTACKS';
  }>;
  newInteractionalRelations: Array<{
    from: { source: 'NEW'; localKey: string };
    to: { source: 'NEW'; localKey: string } | { source: 'EXISTING'; componentId: string };
    type: 'QUESTIONS'|'ANSWERS';
  }>;
}
```

검증 규칙은 localKey 중복, 현재 turn 외 turnId, 잘못된 relation reference/self-reference/중복 relation, component statement 길이, turn당 component 최대 10개와 fact-check target 최대 5개를 검사한다. 출력은 transaction으로 component/relation을 저장한다. 대상이 하나도 없으면 FactCheckBatch와 task를 생성하지 않는다.

### 호출 코드 형태

```ts
const output = await withAbortableTimeout(
  signal => gemini.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: serializeAnalyzerPrompt(input) }] }],
    config: {
      abortSignal: signal,
      systemInstruction: ANALYZER_SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: ANALYZE_TURN_RESPONSE_SCHEMA,
      thinkingConfig: { thinkingLevel: getGeminiThinkingLevel(config, 'GEMINI_ANALYZER_THINKING_LEVEL') },
    },
  }),
  timeoutMs,
  'Gemini analyzer request timed out.',
  abortSignal,
);
const result = parseRequiredJson<AnalyzeTurnOutput>(output.text);
validateAnalyzeTurnOutput(input, result, limits);
```

### Analyzer validator / mapper

- `validateAnalyzeTurnOutput()`는 응답 shape, current turn 귀속, 빈 turn 금지, turn당 component/target 상한, `NEW_n` localKey, relation 참조·source·self-reference·중복·충돌, statement 길이와 Major Claim 개수를 검사한다.
- `mapAnalyzeTurnOutputToEntities()`는 각 `localKey`에 UUID v4(`randomUUID()`)를 할당하고 NEW relation 참조를 실제 component ID로 치환한다.
- mapper는 `ArgumentComponentEntity`, `ArgumentalRelationEntity`, `InteractionalRelationEntity` partial entity와 fact-check 대상 component ID를 만든다.
- 저장은 `AnalyzeTurnService` transaction에서 수행한다. target이 있으면 같은 transaction에서 `FactCheckBatchEntity`, `FactCheckBatchTargetEntity`, Grounding `FactCheckStageTaskEntity`를 생성한다.
- 기준 코드: `src/analyzer/validators/analyze-turn-output.validator.ts`, `src/analyzer/mappers/analyze-turn-entity.mapper.ts`.

## 4. FactCheck: Grounding

### 호출 트리거와 입력

Analyzer가 `requiresFactCheck=true`인 component를 생성하면 라운드별 `fact_check_batch`와 `GROUNDING` stage task를 만들고 `fact-check-grounding` 큐에 넣는다. batch당 target 최대값은 `FACT_CHECK_MAX_TARGETS_PER_BATCH`(기본 10)이다. 각 target에는 component ID뿐 아니라 원래 turn ID, sequence, speaker side가 포함된다.

```ts
interface FactCheckBatchInput {
  debate: { id: string; topic: string };
  round: { phase: 'OPENING'|'REBUTTAL_QUESTION'|'CLOSING'; number: number };
  targets: Array<{
    componentId: string; statement: string; turnId: string;
    sequence: number; speakerSide: 'SIDE_A'|'SIDE_B';
  }>;
}
```

### Grounding 출력(내부 snapshot)

```ts
interface GroundedEvidenceBundle {
  evidenceText: string;
  webSearchQueries: string[];
  sources: Array<{
    sourceIndex: number; title: string; publisher: string; url: string;
  }>;
}
```

Google Search grounding으로 수집한 source는 기본 5개(`FACT_CHECK_MAX_SOURCES_PER_GROUNDING`)까지 보존한다. Grounding 완료 시 `fact_check_grounding_snapshot`에 evidence/query/source를 저장하고 Synthesis task를 생성한다.

### 호출 코드 형태

```ts
const response = await withAbortableTimeout(
  signal => gemini.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: buildGroundingPrompt(input, maxSources) }] }],
    config: {
      abortSignal: signal,
      systemInstruction: FACT_CHECK_GROUNDING_SYSTEM_INSTRUCTION,
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingLevel: getGeminiThinkingLevel(config, 'GEMINI_FACT_CHECK_GROUNDING_THINKING_LEVEL') },
    },
  }),
  groundingTimeoutMs,
  'Gemini fact checker grounding request timed out.',
  abortSignal,
);
return extractGroundedEvidence(response, maxSources);
```

Grounding은 일반 JSON schema를 사용하지 않고 검색 grounding metadata를 `extractGroundedEvidence()`로 정규화한다. usable source가 없거나 upstream 오류이면 task가 재시도된다.

## 5. FactCheck: Synthesis

### 입력과 출력

Synthesis는 새 검색을 하지 않는다. `fact_check_grounding_snapshot`의 `evidenceText`, `webSearchQueries`, `sources`와 동일 batch의 targets를 읽는다.

```ts
interface FactCheckBatchOutput {
  results: Array<{
    componentId: string;
    status: 'SUPPORTED'|'CONTRADICTED'|'PARTIALLY_SUPPORTED'|
      'INSUFFICIENT_EVIDENCE'|'NOT_VERIFIABLE'|'OUTDATED';
    reason: string;
    sourceIndexes: number[];
  }>;
}
```

검증기는 입력 target마다 정확히 하나의 result, 중복/미지 componentId, 허용되지 않은 status, 빈/과도한 reason, 존재하지 않는 sourceIndex, result당 source 최대 5개를 검사한다. 응답이 5개를 초과해도 `trimFactCheckSources()`로 먼저 잘라 validator에 전달한다.

### 호출 코드 형태

```ts
const response = await withAbortableTimeout(
  signal => gemini.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{
      text: buildStructuredSynthesisPrompt(input, groundedEvidence, maxSourcesPerResult),
    }] }],
    config: {
      abortSignal: signal,
      systemInstruction: FACT_CHECK_SYNTHESIS_SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: FACT_CHECK_BATCH_RESPONSE_SCHEMA,
      thinkingConfig: { thinkingLevel: getGeminiThinkingLevel(config, 'GEMINI_FACT_CHECK_SYNTHESIS_THINKING_LEVEL') },
    },
  }),
  synthesisTimeoutMs,
  'Gemini fact checker synthesis request timed out.',
  abortSignal,
);
const output = parseRequiredJson<FactCheckBatchOutput>(response.text);
```

### FactCheck validator / mapper

- `validateFactCheckBatchInput()`는 target 존재, batch 최대 10개, componentId 중복, statement/turn metadata를 검사한다.
- `trimFactCheckSources()`가 result별 sourceIndexes를 설정된 최대 5개로 자른 뒤 `validateFactCheckBatchOutput()`을 호출한다.
- output validator는 입력 target과 result 개수가 정확히 일치하는지, componentId 누락/중복/미지 값, 허용된 6개 status, reason 비어 있음/길이, sourceIndex 유효성·중복·개수 상한을 검사한다.
- `mapFactCheckBatchOutputToEntities()`는 result마다 UUID를 만들고 sourceIndex를 snapshot의 실제 title/publisher/url로 치환해 `FactCheckResultEntity`와 `FactCheckSourceEntity`를 만든다.
- Grounding snapshot은 mapper 대상이 아니라 `FactCheckGroundingTaskService.completeGrounding()` transaction에서 저장한다.
- 기준 코드: `src/fact-check/validators/fact-check-batch-input.validator.ts`, `src/fact-check/validators/fact-check-batch-output.validator.ts`, `src/fact-check/mappers/fact-check-result.mapper.ts`.

Synthesis 성공 시 result/source를 저장하고 stage task와 batch를 `COMPLETED`로 바꾼다. 마지막에는 `fact-check.completed` pipeline event를 발행해 Judge readiness가 다시 평가되도록 한다.

## 6. Judge

### readiness와 호출 트리거

`JudgeReadinessService.tryStartJudge(debateId)`가 transaction에서 다음을 모두 확인한다.

- debate 상태가 `DEBATE_FINALIZED`
- 전체 turn 수가 `4 + rebuttalQuestionRounds * 2`
- 모든 turn `analysisStatus = COMPLETED`
- 모든 FactCheck batch `COMPLETED`
- `requiresFactCheck=true` component마다 result 존재
- 기존 judgment result 없음
- 기존 Judge task가 없음

조건을 만족하면 `judge_task`를 하나 만들고 debate를 `JUDGING`으로 바꾼 다음 `judge` 큐에 enqueue한다. readiness 호출은 Analyzer/FactCheck 완료 event와 recovery scheduler에서 수행할 수 있지만 DB 조건부 update와 unique 제약으로 중복 task를 막는다.

### 입력 스키마

```ts
interface JudgeInput {
  debate: {
    id: string; topic: string;
    sideASpeakerId: string; sideASpeakerDisplayName: string;
    sideBSpeakerId: string; sideBSpeakerDisplayName: string;
    rebuttalQuestionRounds: number;
  };
  argumentGraph: {
    components: Array<{
      id: string; speakerId: string; speakerSide: 'SIDE_A'|'SIDE_B';
      phase: DebatePhase; round: number; turnSequence: number;
      statement: string; isMajorClaim: boolean; requiresFactCheck: boolean;
    }>;
    argumentalRelations: Array<{ fromComponentId: string; toComponentId: string; type: 'SUPPORTS'|'ATTACKS' }>;
    interactionalRelations: Array<{ fromComponentId: string; toComponentId: string; type: 'QUESTIONS'|'ANSWERS' }>;
  };
  factCheckResults: Array<{ componentId: string; status: VerificationStatus; reason: string }>;
}
```

### 출력과 점수

```ts
interface JudgeOutput {
  sideAArgumentationScore: number; sideAInteractionScore: number;
  sideAFactualReliabilityScore: number;
  sideBArgumentationScore: number; sideBInteractionScore: number;
  sideBFactualReliabilityScore: number;
  overallReason: string; sideAFeedback: string; sideBFeedback: string;
}
```

각 side의 논증 점수는 0–40, 상호작용 점수는 0–30, 사실 신뢰도 점수는 0–30이다. `judgment.calculator.ts`가 세 항목을 합산하고 총점이 높은 side를 승자로, 같으면 `DRAW`로 결정한다. Judge AI 응답에는 totalScore/winner를 넣지 않고 서버가 계산한다. 성공 transaction에서 `judgment_result` 저장, debate `COMPLETED`, Judge task `COMPLETED`, 승자 score 보상, community 결과 알림을 함께 처리한다.

### 호출 코드 형태

```ts
const response = await withAbortableTimeout(
  signal => gemini.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
    config: {
      abortSignal: signal,
      systemInstruction: JUDGE_SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: JUDGE_RESPONSE_SCHEMA,
      thinkingConfig: { thinkingLevel: getGeminiThinkingLevel(config, 'GEMINI_JUDGE_THINKING_LEVEL') },
    },
  }),
  judgeTimeoutMs,
  'Gemini judge request timed out.',
  abortSignal,
);
const output = parseRequiredJson<JudgeOutput>(response.text);
validateJudgeOutput(output, limits);
```

### Judge validator / mapper

- `validateJudgeInput()`는 debate가 `JUDGING`인지, 기존 judgment가 없는지, 모든 turn 분석과 batch가 완료됐는지, speaker ID/side 일치, component·relation 참조, required fact-check result, Major Claim 최대 1개를 검사한다.
- `validateJudgeOutput()`는 6개 점수의 정수·범위를 검사한다: argumentation 0–40, interaction 0–30, factual reliability 0–30. overall reason/feedback의 non-empty 및 길이도 검사한다.
- `mapJudgeOutputToJudgmentResult()`는 세 점수를 합산하고 `determineJudgmentWinner()`로 `SIDE_A`/`SIDE_B`/`DRAW`를 계산한다. AI 응답의 totalScore/winner는 신뢰하지 않고 서버가 생성한다.
- 최종 저장은 `JudgeService` transaction에서 `judgment_result` 삽입, debate `COMPLETED`, Judge task `COMPLETED`, 승자 score 보상과 커뮤니티 결과 알림을 함께 처리한다.
- 기준 코드: `src/judge/validators/judge-input.validator.ts`, `src/judge/validators/judge-output.validator.ts`, `src/judge/mappers/judgment-result.mapper.ts`, `src/judge/calculators/judgment.calculator.ts`.

## 7. 재시도·timeout·recovery 정책

### BullMQ 재시도

모든 AI job은 기본 2회 시도한다. 첫 시도 실패 시 같은 job ID로 BullMQ가 재실행한다.

| 단계 | attempts | backoff | jitter |
|---|---:|---:|---:|
| Analyzer | 2 | exponential, 5초 | 0.5 |
| Grounding | 2 | exponential, 5초 | 0.5 |
| Synthesis | 2 | exponential, 5초 | 0.5 |
| Judge | 2 | exponential, 5초 | 0.5 |

Analyzer가 라운드의 두 turn을 기다리는 dependency 재시도는 BullMQ AI 재시도와 별개로 2초 delay의 delayed job으로 처리한다. 이 대기에서는 AI 호출을 시작하지 않는다.

현재 시도에서 timeout, 502/503, 응답 schema/validator 오류가 발생하면 task 상태를 다음과 같이 둔다.

- 남은 시도가 있으면 `PROCESSING → PENDING`, `RETRYING` stage event 발행
- 마지막 시도면 `PROCESSING → FAILED`, `FAILED` stage event 발행
- Gemini timeout은 `AbortController`를 통해 해당 로컬 호출을 중단한다. 서버의 이미 처리 중인 요청을 취소한다는 보장은 없다.
- retry 전에는 grounding/synthesis/judge 내부에서 별도의 Gemini 재호출을 하지 않는다.

### stale recovery

recovery scheduler는 30초 주기로 실행된다. `processingStartedAt`이 stale 기준보다 오래된 task를 `PENDING`으로 되돌리고 pending task를 큐에 다시 등록한다.

| 대상 | stale 기본값 | scheduler |
|---|---:|---:|
| Analyzer turn | 80초 | `ANALYZER_RECOVERY_INTERVAL_MS=30000` |
| FactCheck stage task | 200초 | `FACT_CHECK_RECOVERY_INTERVAL_MS=30000` |
| Judge task | 75초 | `JUDGE_RECOVERY_INTERVAL_MS=30000` |

FactCheck stale은 Grounding과 Synthesis를 합친 시간이 아니라 각 `fact_check_stage_task`의 processing 시작 시각을 기준으로 한다. Grounding이 완료되면 Grounding task는 완료되고 Synthesis task가 새로 시작하므로 stage별 stale을 독립적으로 판단한다.

## 8. 상태 전이 정책

### Debate / turn

```text
Debate: READY → IN_PROGRESS → DEBATE_FINALIZED → JUDGING → COMPLETED
                                                   └────────→ FAILED
Turn analysis: PENDING → PROCESSING → COMPLETED
                         └──────────→ FAILED
```

분석이 끝나지 않은 turn은 다음 라운드 readiness를 막는다. debate가 `FAILED`가 되면 실행 중인 AI invocation에는 cancellation signal이 전달되고 결과 저장을 거부한다.

### FactCheck

```text
Batch: PENDING → PROCESSING → COMPLETED
                    └────────→ FAILED

Grounding task: PENDING → PROCESSING → COMPLETED
                         └────────────→ PENDING (retry) / FAILED
Synthesis task: PENDING → PROCESSING → COMPLETED
                         └────────────→ PENDING (retry) / FAILED
```

Batch는 첫 Grounding task claim 시 `PROCESSING`이 된다. Synthesis 완료 transaction에서 결과를 저장하고 batch를 `COMPLETED`로 전환한다. fact-check 대상이 없는 라운드는 batch/task 자체가 없다.

### Judge

```text
Judge task: PENDING → PROCESSING → COMPLETED
                         └────────→ PENDING (retry) / FAILED
Debate: DEBATE_FINALIZED → JUDGING → COMPLETED
                                   └→ FAILED
```

Judge completion은 task, judgment result, debate 상태를 조건부 transaction으로 함께 변경한다. 이미 완료된 결과가 있거나 task 상태가 바뀐 경우 `ConflictError`로 중복 완료를 거부한다.

## 9. 파이프라인 저장 모델

| 테이블 | 핵심 역할 | 주요 제약/키 |
|---|---|---|
| `debate` | 토론 전체 상태와 speaker/topic | `status`, `currentPhase`, `currentRound` |
| `debate_turn` | 확정된 발언과 분석 상태 | `sequence`, `analysisStatus`, `analysisProcessingStartedAt` |
| `argument_component` | Analyzer가 생성한 논증 그래프 노드 | `turnId`, `requiresFactCheck` |
| `argumental_relation` / `interactional_relation` | 그래프 edge | component 간 from/to 참조 |
| `fact_check_batch` | 라운드 단위 fact-check 묶음 | `(debateId, phase, round)` unique |
| `fact_check_batch_target` | batch에 포함된 component target | batch/component 연결 |
| `fact_check_grounding_snapshot` | Grounding 원문 evidence/query/source | batch당 snapshot |
| `fact_check_stage_task` | Grounding/Synthesis 독립 작업 상태 | `(batchId, stage)` unique |
| `fact_check_result` / `fact_check_source` | 최종 검증 결과와 출처 | result는 component/batch 기준 |
| `judge_task` | 토론당 Judge 작업 상태 | `debateId` unique |
| `judgment_result` | 최종 점수·승자·피드백 | debate당 결과 1건 |

모든 task의 `bullMqJobId`, `attemptCount`, `lastErrorCode`, `failureReason`, `processingStartedAt`, `completedAt`가 재시도와 recovery의 기준이다.

## 10. 동시성 제어·재시도·유실 방지

각 task worker는 먼저 현재 상태를 조건부로 선점(claim)한다. 애플리케이션에서 읽은 뒤 무조건 저장하지 않고, 기대한 이전 상태를 `WHERE` 조건에 포함한 compare-and-set(CAS) 형태의 update를 사용한다.

| 단계 | claim 조건 | 완료 조건 | 중복/유실 방지 |
|---|---|---|---|
| Analyzer | 해당 라운드 두 turn 모두 `analysisStatus=PENDING` | 두 turn 모두 `PROCESSING`인 상태에서 `COMPLETED` update affected 수가 2 | round job ID + predecessor readiness + transaction |
| Grounding | stage=`GROUNDING`, task=`PENDING` | task가 `PROCESSING`일 때만 완료, snapshot·Synthesis task를 같은 transaction에서 생성 | `(batchId, stage)` unique, deterministic task job ID |
| Synthesis | stage=`SYNTHESIS`, task=`PENDING` | task와 batch가 각각 기대 상태일 때만 결과 저장·완료 | batch pessimistic lock, 결과 저장과 상태 전환 transaction |
| Judge | debate가 `DEBATE_FINALIZED`, Judge task 없음 | task=`PROCESSING`, debate=`JUDGING`일 때만 judgment/result 완료 | `judge_task.debateId` unique, debate row lock, judgment 중복 확인 |

경합으로 claim에 실패한 worker는 이미 처리된 결과를 확인해 후속 job을 보완하거나 종료한다. 완료 단계의 `affected !== 1`, 예상 상태 불일치, 실패한 unique insert는 conflict로 처리해 부분 결과를 성공으로 보고하지 않는다.

### 큐 유실 방지

- DB task row를 먼저 만들고 BullMQ job을 enqueue한다. enqueue 후 `bullMqJobId`를 조건부로 기록한다.
- 모든 job은 task ID 또는 debate/phase/round 조합을 deterministic `jobId`로 사용하므로 recovery scheduler가 같은 작업을 중복 생성하지 않는다.
- `ensureJob()`는 기존 job이 active/delayed/waiting이면 재사용하고, failed job만 retry하며, completed job은 정리 후 새 job을 만든다.
- worker가 task를 선점한 뒤 프로세스가 중단되면 `processingStartedAt` 기반 stale recovery가 task를 `PENDING`으로 되돌리고 다시 enqueue한다.
- 최종 시도 실패는 `FAILED`로 남겨 무한 재시도를 막고, 수동 retry가 가능한 Judge는 stale 조건을 다시 확인한다.
- debate가 `FAILED`이거나 invocation이 취소된 경우 AI 응답을 저장하지 않고 task를 실패/종료 상태로 정리한다.

따라서 이 파이프라인의 동시성 안정성은 단일 CAS만이 아니라 `조건부 상태 전이 + row lock + unique 제약 + deterministic job ID + recovery polling + transaction`의 조합으로 보장한다.

## 11. 관측·이벤트

각 worker는 시작/완료/재시도/영구 실패 로그를 남긴다. 주요 로그 필드는 `jobId`, `taskId`, `debateId`, `phase`, `round`, `attempt`, `durationMs`다. AI 호출 완료 로그에는 token usage도 포함된다.

Closing 단계에서는 `DebateProcessingEventBus`가 다음 WebSocket event를 debate room에 broadcast한다.

```ts
interface DebateProcessingEvent {
  type: 'debate.processing.stage';
  id: string; debateId: string;
  stage: 'ANALYZER'|'FACT_CHECK'|'JUDGE';
  status: 'STARTED'|'RETRYING'|'COMPLETED'|'FAILED';
  attempt: number; message: string; occurredAt: string;
}
```

이 event는 현재 영속 저장하지 않는다. 재접속 후 stage 이력까지 복원하려면 별도 stage history 테이블 또는 snapshot API가 필요하다.

## 12. 기준 코드

- Analyzer: `src/analyzer/analyzer-ai.service.ts`, `src/analyzer/analyzer-input.assembler.ts`, `src/analyzer/analyze-turn.service.ts`
- FactCheck: `src/fact-check/fact-checker-ai.service.ts`, `src/fact-check/fact-check-input.assembler.ts`, `src/fact-check/fact-check-grounding-task.service.ts`, `src/fact-check/fact-check-synthesis-task.service.ts`
- Judge: `src/judge/judge-ai.service.ts`, `src/judge/judge-input.assembler.ts`, `src/judge/judge-readiness.service.ts`, `src/judge/judge.service.ts`
- 공통 timeout/취소: `src/ai/gemini/gemini-timeout.util.ts`, `src/ai/ai-invocation-cancellation.service.ts`
- 상태/큐 recovery: 각 단계의 `*-queue.service.ts`, `*-recovery.scheduler.ts`, `*-task-state.util.ts`
