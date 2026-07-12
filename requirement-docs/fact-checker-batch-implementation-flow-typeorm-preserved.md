# Fact Checker 구현 흐름 — TypeORM

## 1. 목적

Analyzer가 하나의 `DebateTurn`에서 추출한 `ArgumentComponent` 중  
`requiresFactCheck = true`인 모든 컴포넌트를 하나의 배치로 묶어 비동기 팩트체크한다.

팩트체크 처리 단위는 개별 컴포넌트가 아니라 **Turn 단위의 FactCheckBatchTask**다.

```text
Turn 1개
  ↓
팩트체크 대상 Component 여러 개
  ↓
FactCheckBatchTask 1개
  ↓
FactChecker AI 1회 호출
```

한 Turn에 팩트체크 대상이 없으면 `FactCheckBatchTask`를 생성하지 않는다.

---

## 2. 전체 처리 흐름

```text
Analyzer가 Turn 분석
  ↓
Analyzer Output 검증
  ↓
ArgumentComponent / Relation 저장
  ↓
requiresFactCheck = true인 Component 수집
  ↓
대상이 1개 이상이면 FactCheckBatchTask 생성
  ↓
FactCheckBatchTarget으로 Task와 Component 연결
  ↓
DB 트랜잭션 커밋
  ↓
BullMQ에 Batch Job 등록
  data: { factCheckBatchTaskId }
  ↓
FactCheckBatchTask QUEUED 처리
  ↓
FactCheckProcessor가 Job 수신
  ↓
FactCheckBatchTaskService.process(taskId)
  ↓
Task 조회 및 PROCESSING 선점
  ↓
Task에 연결된 Component / Turn / Debate 조회
  ↓
FactCheckBatchInput 조립
  ↓
FactCheckerAiService 호출
  ↓
FactCheckBatchOutput 수신
  ↓
AI Output 스키마 및 componentId 집합 검증
  ↓
FactCheckResult / FactCheckSource 매핑
  ↓
DB 트랜잭션
  ├─ FactCheckResult 일괄 저장
  ├─ FactCheckSource 일괄 저장
  └─ FactCheckBatchTask COMPLETED 처리
```

---

## 3. 주요 데이터 모델

### 3.1 FactCheckBatchTask

하나의 Turn에 대한 팩트체크 배치 작업을 나타낸다.

```ts
export enum FactCheckBatchTaskStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface FactCheckBatchTask {
  id: string;
  turnId: string;

  status: FactCheckBatchTaskStatus;

  bullMqJobId: string | null;
  failureReason: string | null;

  createdAt: Date;
  processingStartedAt: Date | null;
  completedAt: Date | null;
}
```

한 Turn에 최종 팩트체크 배치가 하나만 존재한다면 다음 제약을 둔다.

```text
UNIQUE(turn_id)
```

재검증 이력을 남겨야 한다면 `version`을 추가한다.

```text
UNIQUE(turn_id, version)
```

---

### 3.2 FactCheckBatchTarget

배치 작업과 팩트체크 대상 컴포넌트를 연결한다.

```ts
export interface FactCheckBatchTarget {
  id: string;

  factCheckBatchTaskId: string;
  componentId: string;
}
```

추천 제약:

```text
UNIQUE(fact_check_batch_task_id, component_id)
```

하나의 BatchTask에 같은 Component가 중복 연결되는 것을 방지한다.

---

### 3.3 FactCheckResult

각 팩트체크 대상 Component의 검증 결과다.

```ts
export interface FactCheckResult {
  id: string;

  factCheckBatchTaskId: string;
  componentId: string;

  status: VerificationStatus;
  reason: string;

  checkedAt: Date;
}
```

추천 제약:

```text
UNIQUE(fact_check_batch_task_id, component_id)
```

BullMQ 재시도나 중복 실행으로 같은 BatchTask의 결과가 중복 저장되는 것을 방지한다.

---

### 3.4 FactCheckSource

팩트체크 결과에 사용된 출처다.

```ts
export interface FactCheckSource {
  id: string;
  factCheckResultId: string;

  title: string;
  publisher: string;
  url: string;
}
```

추천 제약:

```text
UNIQUE(fact_check_result_id, url)
```

---

## 4. Analyzer 결과 저장과 BatchTask 생성

Analyzer Output 검증이 완료되면 다음 데이터를 하나의 DB 트랜잭션에서 저장한다.

```text
Transaction 시작
  ↓
ArgumentComponent 저장
  ↓
ArgumentalRelation 저장
  ↓
InteractionalRelation 저장
  ↓
requiresFactCheck = true인 Component 수집
  ↓
대상이 존재하면 FactCheckBatchTask(PENDING) 생성
  ↓
FactCheckBatchTarget 생성
  ↓
Transaction 커밋
```

예시:

```ts
const factCheckTargets = newComponents.filter(
  (component) => component.requiresFactCheck,
);

let batchTaskId: string | null = null;

await this.dataSource.transaction(async (manager) => {
  await manager.insert(
    ArgumentComponentEntity,
    componentEntities,
  );

  await manager.insert(
    ArgumentalRelationEntity,
    argumentalRelationEntities,
  );

  await manager.insert(
    InteractionalRelationEntity,
    interactionalRelationEntities,
  );

  if (factCheckTargets.length === 0) {
    return;
  }

  batchTaskId = crypto.randomUUID();

  await manager.insert(FactCheckBatchTaskEntity, {
    id: batchTaskId,
    turnId,
    status: FactCheckBatchTaskStatus.PENDING,
  });

  await manager.insert(
    FactCheckBatchTargetEntity,
    factCheckTargets.map((component) => ({
      id: crypto.randomUUID(),
      factCheckBatchTaskId: batchTaskId as string,
      componentId: component.id,
    })),
  );
});
```

Component, Relation, BatchTask, BatchTarget을 같은 트랜잭션으로 저장하여 다음 불일치를 방지한다.

```text
Component 저장 성공
  ↓
BatchTask 또는 Target 저장 실패
  ↓
팩트체크 대상이 처리되지 않음
```

---

## 5. BullMQ Job 등록

DB 트랜잭션이 커밋된 뒤 BullMQ에 Job을 등록한다.

### Job Data

```ts
export interface FactCheckJobData {
  factCheckBatchTaskId: string;
}
```

Job에는 Component 목록이나 전체 AI Input을 넣지 않고 BatchTask ID만 전달한다.

```ts
await this.factCheckQueue.add(
  'fact-check-batch',
  {
    factCheckBatchTaskId: batchTaskId as string,
  },
  {
    jobId: batchTaskId as string,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
);
```

### ID만 전달하는 이유

- Job payload를 작게 유지할 수 있다.
- Worker가 최신 DB 데이터를 기준으로 Input을 조립할 수 있다.
- 토론 내용이 Redis에 중복 저장되는 것을 줄일 수 있다.
- 재시도 시 동일한 BatchTask를 기준으로 처리할 수 있다.
- 중복 Job 등록을 줄일 수 있다.

### 등록 성공

BullMQ 등록 성공 후 Task를 `QUEUED`로 변경한다.

```text
PENDING → QUEUED
```

```ts
const queued = await this.factCheckBatchTaskRepository
  .createQueryBuilder()
  .update(FactCheckBatchTaskEntity)
  .set({
    status: FactCheckBatchTaskStatus.QUEUED,
    bullMqJobId: String(job.id),
  })
  .where('id = :taskId', { taskId: batchTaskId as string })
  .andWhere('status = :status', {
    status: FactCheckBatchTaskStatus.PENDING,
  })
  .execute();

if (queued.affected !== 1) {
  throw new Error(
    `FactCheckBatchTask could not be queued: ${batchTaskId}`,
  );
}
```

### 등록 실패

Job 등록에 실패하면 Task는 `PENDING` 상태로 유지한다.

```text
FactCheckBatchTask 생성 성공
  ↓
BullMQ 등록 실패
  ↓
Task PENDING 유지
  ↓
복구 작업이 PENDING Task 재등록
```

DB 트랜잭션 내부에서 BullMQ에 Job을 등록하지 않는다.

---

## 6. FactCheckProcessor

Processor는 BullMQ Job을 수신하고 Application Service를 호출하는 얇은 진입점으로 구성한다.

```ts
@Processor('fact-check')
export class FactCheckProcessor {
  constructor(
    private readonly factCheckBatchTaskService: FactCheckBatchTaskService,
  ) {}

  @Process('fact-check-batch')
  async process(job: Job<FactCheckJobData>): Promise<void> {
    await this.factCheckBatchTaskService.process(
      job.data.factCheckBatchTaskId,
      job,
    );
  }
}
```

Processor 안에는 다음 로직을 직접 넣지 않는다.

- DB 조회
- Input DTO 조립
- AI 호출
- Output 검증
- Result 저장

이 로직은 `FactCheckBatchTaskService`가 조율한다.

---

## 7. FactCheckBatchTaskService

`FactCheckBatchTaskService`는 전체 팩트체크 유스케이스를 조율한다.

```text
Task 조회 및 선점
  ↓
FactCheckBatchInput 조립
  ↓
FactCheckerAiService 호출
  ↓
FactCheckBatchOutput 검증
  ↓
Entity 매핑
  ↓
결과 저장 및 Task 완료
```

예시:

```ts
async process(
  factCheckBatchTaskId: string,
  job: Job<FactCheckJobData>,
): Promise<void> {
  const claimed = await this.claimTask(factCheckBatchTaskId);

  if (!claimed) {
    return;
  }

  try {
    const input = await this.buildFactCheckBatchInput(
      factCheckBatchTaskId,
    );

    const output = await this.factCheckerAiService.check(input);

    validateFactCheckBatchOutput(input, output);

    const entities = mapFactCheckBatchOutputToEntities(
      factCheckBatchTaskId,
      output,
    );

    await this.saveResultsAndCompleteTask(
      factCheckBatchTaskId,
      entities,
    );
  } catch (error) {
    await this.handleProcessingFailure(
      factCheckBatchTaskId,
      job,
      error,
    );

    throw error;
  }
}
```

---

## 8. Task 조회 및 원자적 선점

Worker가 Task를 조회한 뒤 단순히 `PROCESSING`으로 변경하면 여러 Worker가 동시에 같은 Task를 처리할 수 있다.

조건부 UPDATE를 사용해 처리 권한을 원자적으로 선점한다.

```ts
private async claimTask(
  factCheckBatchTaskId: string,
): Promise<boolean> {
  const result = await this.dataSource
    .createQueryBuilder()
    .update(FactCheckBatchTaskEntity)
    .set({
      status: FactCheckBatchTaskStatus.PROCESSING,
      processingStartedAt: new Date(),
      failureReason: null,
    })
    .where('id = :taskId', {
      taskId: factCheckBatchTaskId,
    })
    .andWhere('status IN (:...statuses)', {
      statuses: [
        FactCheckBatchTaskStatus.PENDING,
        FactCheckBatchTaskStatus.QUEUED,
      ],
    })
    .execute();

  return result.affected === 1;
}
```

### 상태별 처리

| 현재 상태 | 처리 |
|---|---|
| `PENDING` | `PROCESSING` 선점 가능 |
| `QUEUED` | `PROCESSING` 선점 가능 |
| `PROCESSING` | 다른 Worker 처리 가능성이 있으므로 중복 실행하지 않음 |
| `COMPLETED` | 이미 완료된 Task이므로 성공 종료 |
| `FAILED` | 명시적인 재처리 요청이 있을 때만 다시 큐에 등록 |

BullMQ 재시도를 고려해 DB 상태를 처리 기준으로 사용한다.

---

## 9. FactCheckBatchInput 조립

BatchTask에 연결된 모든 대상 Component와 공통 Turn, Debate를 조회한다.

```text
FactCheckBatchTask
  ↓ turnId
DebateTurn
  ↓ debateId
Debate

FactCheckBatchTask
  ↓
FactCheckBatchTarget[]
  ↓ componentId
ArgumentComponent[]
```

### Input DTO

```ts
export interface FactCheckTarget {
  componentId: string;
  statement: string;
}

export interface FactCheckBatchInput {
  debate: {
    id: string;
    topic: string;
  };

  turn: {
    id: string;
    sequence: number;
  };

  targets: FactCheckTarget[];
}
```

### 조립 예시

```ts
private async buildFactCheckBatchInput(
  factCheckBatchTaskId: string,
): Promise<FactCheckBatchInput> {
  const task = await this.factCheckBatchTaskRepository
    .createQueryBuilder('task')
    .innerJoinAndSelect('task.turn', 'turn')
    .innerJoinAndSelect('turn.debate', 'debate')
    .innerJoinAndSelect('task.targets', 'target')
    .innerJoinAndSelect('target.component', 'component')
    .where('task.id = :taskId', {
      taskId: factCheckBatchTaskId,
    })
    .getOne();

  if (!task) {
    throw new NonRetryableFactCheckError(
      'FactCheckBatchTask not found',
    );
  }

  if (task.targets.length === 0) {
    throw new NonRetryableFactCheckError(
      'FactCheckBatchTask has no targets',
    );
  }

  return {
    debate: {
      id: task.turn.debate.id,
      topic: task.turn.debate.topic,
    },
    turn: {
      id: task.turn.id,
      sequence: task.turn.sequence,
    },
    targets: task.targets.map(({ component }) => ({
      componentId: component.id,
      statement: component.statement,
    })),
  };
}
```

### Input 검증

AI 호출 전에 다음 조건을 확인한다.

- BatchTask가 존재하는가
- BatchTask에 Target이 하나 이상 존재하는가
- 모든 Target Component가 존재하는가
- 모든 Component가 BatchTask의 Turn에 속하는가
- 모든 Component의 `requiresFactCheck`가 `true`인가
- `componentId`가 중복되지 않았는가
- `statement`가 비어 있지 않은가
- Target 개수가 배치 최대 크기를 초과하지 않는가

```ts
const MAX_FACT_CHECK_TARGETS_PER_BATCH = 5;
```

---

## 10. FactCheckerAiService

`FactCheckerAiService`는 AI 통신만 담당한다.

```ts
@Injectable()
export class FactCheckerAiService {
  async check(
    input: FactCheckBatchInput,
  ): Promise<FactCheckBatchOutput> {
    const response = await this.openAi.responses.create({
      // model
      // instructions
      // structured output schema
      // input
    });

    return this.parseFactCheckBatchOutput(response);
  }
}
```

이 서비스에서는 다음 작업을 수행하지 않는다.

- DB 조회
- Task 상태 변경
- Result 저장
- Source 저장

AI 호출은 DB 트랜잭션 밖에서 실행한다.

---

## 11. FactCheckBatchOutput

```ts
export enum VerificationStatus {
  SUPPORTED = 'SUPPORTED',
  CONTRADICTED = 'CONTRADICTED',
  PARTIALLY_SUPPORTED = 'PARTIALLY_SUPPORTED',
  INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE',
  NOT_VERIFIABLE = 'NOT_VERIFIABLE',
  OUTDATED_OR_TIME_SENSITIVE = 'OUTDATED_OR_TIME_SENSITIVE',
}

export interface FactCheckBatchOutput {
  results: FactCheckItemOutput[];
}

export interface FactCheckItemOutput {
  componentId: string;

  status: VerificationStatus;
  reason: string;

  sources: FactCheckSourceOutput[];
}

export interface FactCheckSourceOutput {
  title: string;
  publisher: string;
  url: string;
}
```

`NOT_VERIFIABLE`는 원칙적으로 Analyzer 단계에서 제외해야 하지만, Analyzer가 잘못 분류한 경우를 대비한 FactChecker의 안전장치로 유지한다.

다음 상태는 시스템 실패가 아니라 정상적인 팩트체크 결과다.

- `INSUFFICIENT_EVIDENCE`
- `NOT_VERIFIABLE`
- `OUTDATED_OR_TIME_SENSITIVE`

이 상태가 반환되어도 Task는 `COMPLETED` 처리한다.

---

## 12. AI Output 검증

AI 응답은 신뢰할 수 없는 외부 입력으로 취급하고 DB 저장 전에 검증한다.

### 필수 집합 검증

1. `output.results.length`와 `input.targets.length`가 같아야 한다.
2. Output에 Input에 없던 `componentId`가 존재하면 안 된다.
3. Output에서 동일한 `componentId`가 중복되면 안 된다.
4. Input의 모든 `componentId`가 Output에 정확히 한 번 존재해야 한다.

```ts
export class InvalidFactCheckBatchOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFactCheckBatchOutputError';
  }
}

export function validateFactCheckBatchOutput(
  input: FactCheckBatchInput,
  output: FactCheckBatchOutput,
): void {
  const targetIds = input.targets.map(
    ({ componentId }) => componentId,
  );

  const resultIds = output.results.map(
    ({ componentId }) => componentId,
  );

  const targetIdSet = new Set(targetIds);
  const resultIdSet = new Set(resultIds);

  if (targetIdSet.size !== targetIds.length) {
    throw new InvalidFactCheckBatchOutputError(
      'FactCheckBatchInput contains duplicate componentIds.',
    );
  }

  if (output.results.length !== input.targets.length) {
    throw new InvalidFactCheckBatchOutputError(
      `Result count mismatch: expected ${input.targets.length}, received ${output.results.length}.`,
    );
  }

  if (resultIdSet.size !== resultIds.length) {
    throw new InvalidFactCheckBatchOutputError(
      'FactCheckBatchOutput contains duplicate componentIds.',
    );
  }

  const unexpectedIds = resultIds.filter(
    (componentId) => !targetIdSet.has(componentId),
  );

  if (unexpectedIds.length > 0) {
    throw new InvalidFactCheckBatchOutputError(
      `Unexpected componentIds returned: ${unexpectedIds.join(', ')}`,
    );
  }

  const missingIds = targetIds.filter(
    (componentId) => !resultIdSet.has(componentId),
  );

  if (missingIds.length > 0) {
    throw new InvalidFactCheckBatchOutputError(
      `Missing results for componentIds: ${missingIds.join(', ')}`,
    );
  }
}
```

### 항목별 검증

각 Result와 Source에도 다음 검증을 적용한다.

- `status`가 `VerificationStatus` 값인가
- `reason.trim()`이 비어 있지 않은가
- `reason`이 최대 길이를 초과하지 않는가
- `sources`가 배열인가
- `title`, `publisher`, `url`이 비어 있지 않은가
- URL 형식이 유효한가
- 같은 Result 안에서 동일 URL이 중복되지 않았는가
- Source 개수가 최대 제한을 초과하지 않는가

AI Structured Output을 사용하더라도 비즈니스 검증은 백엔드에서 다시 수행한다.

---

## 13. Entity 매핑

Output 검증이 완료된 뒤 DB Entity로 변환한다.

```ts
export function mapFactCheckBatchOutputToEntities(
  factCheckBatchTaskId: string,
  output: FactCheckBatchOutput,
): {
  results: FactCheckResult[];
  sources: FactCheckSource[];
} {
  const checkedAt = new Date();

  const mapped = output.results.map((item) => {
    const resultId = crypto.randomUUID();

    const result: FactCheckResult = {
      id: resultId,
      factCheckBatchTaskId,
      componentId: item.componentId,
      status: item.status,
      reason: item.reason.trim(),
      checkedAt,
    };

    const sources: FactCheckSource[] = item.sources.map((source) => ({
      id: crypto.randomUUID(),
      factCheckResultId: resultId,
      title: source.title.trim(),
      publisher: source.publisher.trim(),
      url: source.url.trim(),
    }));

    return {
      result,
      sources,
    };
  });

  return {
    results: mapped.map(({ result }) => result),
    sources: mapped.flatMap(({ sources }) => sources),
  };
}
```

매핑 함수는 검증 책임을 갖지 않는다.

```text
Output 검증
  ↓
Entity 매핑
  ↓
DB 저장
```

순서를 고정한다.

---

## 14. Result / Source 저장 및 Task 완료

모든 결과를 검증한 후 다음 작업을 하나의 DB 트랜잭션으로 처리한다.

```text
Transaction 시작
  ↓
FactCheckResult 전체 저장
  ↓
FactCheckSource 전체 저장
  ↓
PROCESSING Task를 COMPLETED로 변경
  ↓
Transaction 커밋
```

```ts
private async saveResultsAndCompleteTask(
  factCheckBatchTaskId: string,
  entities: {
    results: FactCheckResult[];
    sources: FactCheckSource[];
  },
): Promise<void> {
  const completedAt = new Date();

  await this.dataSource.transaction(async (manager) => {
    await manager.insert(
      FactCheckResultEntity,
      entities.results,
    );

    if (entities.sources.length > 0) {
      await manager.insert(
        FactCheckSourceEntity,
        entities.sources,
      );
    }

    const updated = await manager
      .createQueryBuilder()
      .update(FactCheckBatchTaskEntity)
      .set({
        status: FactCheckBatchTaskStatus.COMPLETED,
        completedAt,
        failureReason: null,
      })
      .where('id = :taskId', {
        taskId: factCheckBatchTaskId,
      })
      .andWhere('status = :status', {
        status: FactCheckBatchTaskStatus.PROCESSING,
      })
      .execute();

    if (updated.affected !== 1) {
      throw new Error(
        `FactCheckBatchTask could not be completed: ${factCheckBatchTaskId}`,
      );
    }
  });
}
```

Task 완료를 조건부로 처리하여 이미 완료되었거나 올바르지 않은 상태의 Task를 덮어쓰지 않는다.

Task 완료 갱신이 실패하면 트랜잭션 전체가 롤백되어 Result와 Source도 저장되지 않는다.

---

## 15. 배치 원자성 정책

한 BatchTask의 Output 중 일부가 누락되거나 잘못된 경우 부분 저장하지 않는다.

```text
Input targets: 3개
Output results: 2개
  ↓
Output 검증 실패
  ↓
Result / Source 저장하지 않음
  ↓
Batch Job 전체 재시도
```

정상적인 경우에만 전체 결과를 한 번에 저장한다.

```text
모든 Result 검증 성공
  ↓
하나의 DB 트랜잭션
  ├─ Result 전체 저장
  ├─ Source 전체 저장
  └─ BatchTask COMPLETED 처리
```

졸업 프로젝트 범위에서는 부분 성공보다 배치 전체 성공 또는 전체 실패 정책이 단순하고 안전하다.

---

## 16. 실패 및 재시도

### 재시도 가능한 오류

- AI API 타임아웃
- AI API 5xx 오류
- 일시적인 네트워크 장애
- 응답 파싱 실패
- Structured Output 또는 비즈니스 검증 실패
- 일시적인 DB 연결 실패

재시도 횟수가 남아 있으면 Task를 다시 처리 가능한 상태로 변경하고 예외를 던진다.

```text
PROCESSING
  ↓ 재시도 가능한 오류
QUEUED
  ↓
BullMQ 재시도
```

### 복구 불가능한 오류

- BatchTask가 존재하지 않음
- BatchTarget이 없음
- Target Component가 영구적으로 존재하지 않음
- Component와 Turn의 참조 관계가 깨짐
- Turn 또는 Debate가 존재하지 않음
- 최종 재시도 횟수 초과

최종 실패 시:

```text
PROCESSING → FAILED
```

```ts
await this.factCheckBatchTaskRepository
  .createQueryBuilder()
  .update(FactCheckBatchTaskEntity)
  .set({
    status: FactCheckBatchTaskStatus.FAILED,
    failureReason: sanitizedFailureReason,
  })
  .where('id = :taskId', {
    taskId: factCheckBatchTaskId,
  })
  .andWhere('status = :status', {
    status: FactCheckBatchTaskStatus.PROCESSING,
  })
  .execute();
```

`failureReason`에는 API Key, 전체 Prompt, 민감한 사용자 데이터, AI 원본 응답 전체를 저장하지 않는다.

---

## 17. 상태 전이

```text
PENDING
  ↓ BullMQ 등록 성공
QUEUED
  ↓ Worker 선점
PROCESSING
  ├─ 전체 결과 저장 성공 → COMPLETED
  ├─ 재시도 가능 오류 → QUEUED
  └─ 최종 실패 → FAILED

FAILED
  ↓ 명시적 재처리
QUEUED
```

| From | To | 조건 |
|---|---|---|
| `PENDING` | `QUEUED` | BullMQ Job 등록 성공 |
| `PENDING` | `PROCESSING` | 복구 처리에서 직접 선점 |
| `QUEUED` | `PROCESSING` | Worker가 조건부 UPDATE로 선점 |
| `PROCESSING` | `COMPLETED` | Result와 Source 전체 저장 성공 |
| `PROCESSING` | `QUEUED` | BullMQ 재시도 예정 |
| `PROCESSING` | `FAILED` | 최종 재시도 실패 |
| `FAILED` | `QUEUED` | 명시적 재처리 요청 |

`COMPLETED`는 최종 상태로 취급한다.

---

## 18. 장애 복구

### PENDING Task 복구

DB에는 Task가 생성됐지만 BullMQ Job 등록이 실패한 경우다.

```text
status = PENDING
createdAt이 기준 시간 이전
  ↓
BullMQ Job 재등록
  ↓
등록 성공 시 QUEUED
```

### PROCESSING Task 복구

Worker가 작업 중 종료되면 DB Task가 `PROCESSING`에 남을 수 있다.

```text
status = PROCESSING
processingStartedAt이 제한 시간을 초과
  ↓
BullMQ Job 활성 상태 확인
  ↓
stale Task를 QUEUED로 복구 후 재등록
```

BullMQ의 stalled job 복구 기능과 DB 복구 작업을 함께 사용할 수 있다.

### COMPLETED Job 재수신

재전달된 Job의 Task가 이미 `COMPLETED`라면 AI 호출과 DB 저장을 수행하지 않고 성공 종료한다.

---

## 19. 권장 폴더 구조

```text
fact-check/
├─ domain/
│  ├─ fact-check-batch-task-status.enum.ts
│  ├─ verification-status.enum.ts
│  └─ errors/
├─ dto/
│  ├─ fact-check-job-data.ts
│  ├─ fact-check-batch-input.ts
│  └─ fact-check-batch-output.ts
├─ processor/
│  └─ fact-check.processor.ts
├─ service/
│  ├─ fact-check-batch-task.service.ts
│  ├─ fact-check-input-assembler.service.ts
│  └─ fact-checker-ai.service.ts
├─ validator/
│  └─ fact-check-batch-output.validator.ts
├─ mapper/
│  └─ fact-check-batch-output.mapper.ts
└─ repository/
   └─ fact-check-batch-task.repository.ts
```

---

## 20. 최종 구현 책임 분리

### Analyzer 저장 서비스

- Analyzer Output 검증
- Component / Relation 저장
- 팩트체크 대상 수집
- BatchTask / BatchTarget 생성
- DB 커밋 후 BullMQ Job 등록

### FactCheckProcessor

- BullMQ Job 수신
- `factCheckBatchTaskId` 추출
- `FactCheckBatchTaskService` 호출

### FactCheckBatchTaskService

- Task 상태 선점
- Input 조립 요청
- AI Service 호출
- Output 검증 요청
- Entity 매핑
- Result / Source 저장
- Task 완료 및 실패 처리

### FactCheckInputAssembler

- BatchTask / Target / Component / Turn / Debate 조회
- 참조 정합성 검증
- `FactCheckBatchInput` 조립

### FactCheckerAiService

- Responses API 호출
- Structured Output 파싱
- `FactCheckBatchOutput` 반환

### FactCheckBatchOutputValidator

- Input과 Output 개수 비교
- 예상하지 않은 `componentId` 검사
- 중복 `componentId` 검사
- 누락된 `componentId` 검사
- Result / Source 필드 검증

### FactCheckBatchOutputMapper

- 검증 완료된 Output을 Result / Source Entity로 변환

---

## 21. 핵심 설계 원칙

1. 팩트체크는 Component 단건이 아니라 **Turn 단위 배치**로 처리한다.
2. 한 Turn의 `requiresFactCheck = true` Component를 하나의 BatchTask로 묶는다.
3. 팩트체크 대상이 없으면 BatchTask를 생성하지 않는다.
4. BullMQ Job에는 `factCheckBatchTaskId`만 전달한다.
5. Component, Relation, BatchTask, BatchTarget 생성은 하나의 DB 트랜잭션으로 처리한다.
6. BullMQ Job 등록은 DB 커밋 이후 수행한다.
7. Job 등록 실패 시 `PENDING` Task 재등록 경로를 둔다.
8. Worker는 조건부 UPDATE로 Task를 원자적으로 선점한다.
9. AI 호출은 DB 트랜잭션 밖에서 수행한다.
10. Output의 Result 개수와 Component ID 집합을 저장 전에 검증한다.
11. `componentId` 순서가 아니라 ID 값으로 Input과 Output을 매칭한다.
12. 결과 일부만 저장하지 않고 배치 전체를 원자적으로 저장한다.
13. Result, Source 저장과 BatchTask 완료는 같은 DB 트랜잭션으로 처리한다.
14. DB Unique Constraint로 중복 결과 저장을 방지한다.
15. 팩트체크 결론과 시스템 처리 실패를 구분한다.


---

## 24. TypeORM 적용 원칙

- `synchronize: false`를 사용한다.
- 모든 스키마 변경은 Migration으로 관리한다.
- 트랜잭션 내부에서는 콜백으로 전달받은 `EntityManager`만 사용한다.
- 대량 저장은 `EntityManager.insert()`를 우선한다.
- Task 선점과 상태 전이는 QueryBuilder 조건부 `UPDATE`와 `UpdateResult.affected`로 판단한다.
- BatchTask/Turn/Debate/Target/Component 조회는 명시적인 QueryBuilder JOIN을 사용한다.
- DTO, AI Output, Validator, Mapper와 TypeORM Entity를 분리한다.
