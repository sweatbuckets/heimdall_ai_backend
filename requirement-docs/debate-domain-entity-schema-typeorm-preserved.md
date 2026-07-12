# Debate Domain Entity Schema — TypeORM

## 1. 설계 기준

이 문서는 토론 그래프, Turn 단위 배치 팩트체크, 최종 판정 결과를 저장하기 위한 기본 엔티티 스키마를 정의한다.

팩트체크는 개별 `ArgumentComponent`마다 별도의 Task를 생성하지 않고, 하나의 `DebateTurn`에서 `requiresFactCheck = true`인 모든 컴포넌트를 하나의 `FactCheckBatchTask`로 묶어 처리한다.

```text
DebateTurn 1개
  ↓
ArgumentComponent 여러 개
  ↓
requiresFactCheck = true인 Component 수집
  ↓
FactCheckBatchTask 1개
  ↓
FactCheckBatchTarget 여러 개
```


## TypeORM 적용 원칙

이 문서의 기존 TypeScript 인터페이스는 엔티티가 표현해야 하는 논리적 필드와 관계를 빠짐없이 보존하기 위한 도메인 스키마다. 실제 DB 매핑은 문서 후반의 TypeORM Entity 정의를 사용한다.

- NestJS `@nestjs/typeorm`과 TypeORM Data Mapper 패턴을 사용한다.
- `synchronize: false`를 사용한다.
- 모든 스키마 변경은 Migration으로 관리한다.
- Entity는 DB 매핑 책임에 집중하고 DTO, Validator, Mapper와 분리한다.
- 복합 Unique는 `@Unique`, 조회용 인덱스는 `@Index`로 선언한다.
- Decorator로 표현하기 어려운 CHECK Constraint는 Migration에서 추가한다.
- 참가자 필드는 프로젝트 전체에서 `sideASpeakerId`, `sideBSpeakerId`로 통일한다.

---

## 2. Enum

```ts
export enum DebatePhase {
  OPENING = 'OPENING',
  REBUTTAL_QUESTION = 'REBUTTAL_QUESTION',
  CLOSING = 'CLOSING',
}

export enum DebateSide {
  A = 'A',
  B = 'B',
}

export enum DebateStatus {
  READY = 'READY',
  IN_PROGRESS = 'IN_PROGRESS',
  FINAL_FACT_CHECKING = 'FINAL_FACT_CHECKING',
  JUDGING = 'JUDGING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum ArgumentalRelationType {
  SUPPORTS = 'SUPPORTS',
  ATTACKS = 'ATTACKS',
}

export enum InteractionalRelationType {
  QUESTIONS = 'QUESTIONS',
  ANSWERS = 'ANSWERS',
}

export enum FactCheckBatchTaskStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum VerificationStatus {
  SUPPORTED = 'SUPPORTED',
  CONTRADICTED = 'CONTRADICTED',
  PARTIALLY_SUPPORTED = 'PARTIALLY_SUPPORTED',
  INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE',
  NOT_VERIFIABLE = 'NOT_VERIFIABLE',
  OUTDATED_OR_TIME_SENSITIVE = 'OUTDATED_OR_TIME_SENSITIVE',
}

export enum JudgmentWinner {
  SIDE_A = 'SIDE_A',
  SIDE_B = 'SIDE_B',
  DRAW = 'DRAW',
}
```

### VerificationStatus 의미

| 상태 | 의미 |
|---|---|
| `SUPPORTED` | 신뢰 가능한 출처가 주장 전체를 뒷받침함 |
| `CONTRADICTED` | 신뢰 가능한 출처가 주장과 명확히 충돌함 |
| `PARTIALLY_SUPPORTED` | 일부만 맞거나 조건, 범위, 예외가 누락됨 |
| `INSUFFICIENT_EVIDENCE` | 검증 가능한 주장이지만 충분한 근거를 찾지 못함 |
| `NOT_VERIFIABLE` | 가치 판단, 예측, 주관 표현 등 사실 검증 대상으로 부적절함 |
| `OUTDATED_OR_TIME_SENSITIVE` | 시점에 따라 달라져 현재 기준으로 단정하기 어려움 |

`NOT_VERIFIABLE`은 원칙적으로 Analyzer가 걸러야 하지만, 잘못 전달된 입력에 대한 FactChecker의 안전장치로 유지한다.

---

## 3. Debate

```ts
export interface Debate {
  id: string;
  topic: string;

  sideASpeakerId: string;
  sideBSpeakerId: string;

  rebuttalQuestionRounds: number;
  status: DebateStatus;

  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
}
```

### 설명

- `sideASpeakerId`: SIDE_A 참가자
- `sideBSpeakerId`: SIDE_B 참가자
- `rebuttalQuestionRounds`: 반박 및 질문 라운드 수
- `status`: 전체 토론 진행 상태

기존 DB가 `formerSpeakerId`, `latterSpeakerId`를 사용하고 있다면 Migration과 Mapper에서 다음 대응 규칙을 고정한다.

```text
formerSpeakerId → sideASpeakerId → DebateSide.A
latterSpeakerId → sideBSpeakerId → DebateSide.B
```

신규 TypeORM Entity에서는 `sideASpeakerId`, `sideBSpeakerId`를 사용한다.

---

## 4. DebateTurn

```ts
export interface DebateTurn {
  id: string;
  debateId: string;

  speakerId: string;
  speakerSide: DebateSide;

  phase: DebatePhase;
  round: number;
  sequence: number;

  content: string;

  createdAt: Date;
}
```

### 제약 조건

```text
UNIQUE(debate_id, sequence)
```

하나의 토론 안에서 `sequence`는 전체 발언 순서를 나타내며 중복될 수 없다.

백엔드는 다음 정합성을 검증해야 한다.

```text
speakerSide = A이면 speakerId = debate.sideASpeakerId
speakerSide = B이면 speakerId = debate.sideBSpeakerId
```

---

## 5. ArgumentComponent

```ts
export interface ArgumentComponent {
  id: string;
  turnId: string;

  isMajorClaim: boolean;
  statement: string;

  requiresFactCheck: boolean;

  createdAt: Date;
}
```

### 규칙

- `statement`는 공백일 수 없다.
- `isMajorClaim = true`는 `OPENING` Turn에서만 허용한다.
- 한 참가자의 Major Claim은 토론 전체에서 최대 하나만 허용한다.
- `requiresFactCheck = true`인 컴포넌트만 해당 Turn의 FactCheck Batch 대상에 포함한다.
- Major Claim이 아닌 신규 컴포넌트는 적어도 하나의 논증 관계 또는 상호작용 관계에 참여해야 한다.

---

## 6. ArgumentalRelation

```ts
export interface ArgumentalRelation {
  id: string;

  fromComponentId: string;
  toComponentId: string;

  type: ArgumentalRelationType;

  createdAt: Date;
}
```

### 관계 방향

```text
SUPPORTS:
from Component가 to Component를 지지함

ATTACKS:
from Component가 to Component를 반박하거나 공격함
```

### 제약 조건

```text
from_component_id != to_component_id
UNIQUE(from_component_id, to_component_id, type)
```

동일한 `from / to` 조합에 `SUPPORTS`와 `ATTACKS`가 동시에 존재하지 않도록 서비스 계층에서 검증하는 것을 권장한다.

---

## 7. InteractionalRelation

```ts
export interface InteractionalRelation {
  id: string;

  fromComponentId: string;
  toComponentId: string;

  type: InteractionalRelationType;

  createdAt: Date;
}
```

### 관계 방향

```text
QUESTIONS:
from Component가 to Component에 질문함

ANSWERS:
from Component가 to Component의 질문에 답함
```

### 제약 조건

```text
from_component_id != to_component_id
UNIQUE(from_component_id, to_component_id, type)
```

기존 코드에는 `createdAt`이 없었지만 다른 Relation과 생성 시각 관리 방식을 통일하기 위해 추가한다.

---

## 8. FactCheckBatchTask

기존 단건 `FactCheckTask`를 Turn 단위 배치 구조로 변경한다.

```ts
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

### 설명

- 하나의 Turn에 존재하는 팩트체크 대상 Component들을 하나의 작업으로 묶는다.
- 팩트체크 대상 Component가 하나도 없으면 BatchTask를 생성하지 않는다.
- `processingStartedAt`은 Worker 장애 후 `PROCESSING` 상태에 멈춘 Task를 복구할 때 사용한다.

### 제약 조건

한 Turn에 최종 팩트체크 배치 하나만 허용한다면:

```text
UNIQUE(turn_id)
```

재검증 이력을 저장해야 한다면 `version`을 추가하고 다음 제약을 사용한다.

```text
UNIQUE(turn_id, version)
```

---

## 9. FactCheckBatchTarget

BatchTask와 팩트체크 대상 ArgumentComponent를 연결한다.

```ts
export interface FactCheckBatchTarget {
  id: string;

  factCheckBatchTaskId: string;
  componentId: string;

  createdAt: Date;
}
```

### 제약 조건

```text
UNIQUE(fact_check_batch_task_id, component_id)
```

### 정합성 규칙

- Target Component는 반드시 BatchTask의 `turnId`와 같은 Turn에 속해야 한다.
- Target Component의 `requiresFactCheck`는 반드시 `true`여야 한다.
- 하나의 BatchTask에는 최소 하나 이상의 Target이 존재해야 한다.

---

## 10. BullMQ Job Data

```ts
export interface FactCheckJobData {
  factCheckBatchTaskId: string;
}
```

Job에는 Component 목록이나 AI Input 전체를 넣지 않고 BatchTask ID만 전달한다.

Worker는 `factCheckBatchTaskId`로 다음 데이터를 조회한다.

```text
FactCheckBatchTask
  ↓
FactCheckBatchTarget[]
  ↓
ArgumentComponent[]

FactCheckBatchTask.turnId
  ↓
DebateTurn
  ↓
Debate
```

---

## 11. FactCheckResult

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

### 설명

배치 AI 응답의 각 `componentId` 결과를 개별 행으로 저장한다.

BatchTask ID도 함께 저장하여 어느 배치 처리에서 생성된 결과인지 추적할 수 있도록 한다.

### 제약 조건

```text
UNIQUE(fact_check_batch_task_id, component_id)
```

컴포넌트당 결과를 평생 하나만 허용한다면 `UNIQUE(component_id)`도 가능하지만 재검증 이력을 저장하기 어려우므로 배치 Task와 Component의 복합 Unique를 권장한다.

---

## 12. FactCheckSource

```ts
export interface FactCheckSource {
  id: string;
  factCheckResultId: string;

  title: string;
  publisher: string;
  url: string;

  createdAt: Date;
}
```

### 제약 조건

```text
UNIQUE(fact_check_result_id, url)
```

하나의 결과에 같은 출처 URL이 중복 저장되지 않도록 한다.

---

## 13. JudgmentResult

```ts
export interface JudgmentResult {
  id: string;
  debateId: string;

  winner: JudgmentWinner;

  sideAArgumentationScore: number;
  sideAInteractionScore: number;
  sideAFactualReliabilityScore: number;
  sideATotalScore: number;

  sideBArgumentationScore: number;
  sideBInteractionScore: number;
  sideBFactualReliabilityScore: number;
  sideBTotalScore: number;

  overallReason: string;
  sideAFeedback: string;
  sideBFeedback: string;

  judgedAt: Date;
}
```

### 제약 조건

토론당 최종 판정 결과를 하나만 저장한다면:

```text
UNIQUE(debate_id)
```

### 점수 규칙

세부 점수 범위는 서비스 정책으로 고정해야 한다.

예시:

```text
Argumentation Score: 0~40
Interaction Score: 0~30
Factual Reliability Score: 0~30
Total Score: 0~100
```

총점은 AI가 임의로 반환한 값을 그대로 신뢰하기보다 백엔드에서 계산하는 방식을 권장한다.

```ts
sideATotalScore =
  sideAArgumentationScore +
  sideAInteractionScore +
  sideAFactualReliabilityScore;

sideBTotalScore =
  sideBArgumentationScore +
  sideBInteractionScore +
  sideBFactualReliabilityScore;
```

승자도 계산된 총점과 무승부 기준을 사용해 백엔드에서 결정할 수 있다.

---

## 14. 전체 TypeScript 스키마

```ts
export enum DebatePhase {
  OPENING = 'OPENING',
  REBUTTAL_QUESTION = 'REBUTTAL_QUESTION',
  CLOSING = 'CLOSING',
}

export enum DebateSide {
  A = 'A',
  B = 'B',
}

export enum DebateStatus {
  READY = 'READY',
  IN_PROGRESS = 'IN_PROGRESS',
  FINAL_FACT_CHECKING = 'FINAL_FACT_CHECKING',
  JUDGING = 'JUDGING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum ArgumentalRelationType {
  SUPPORTS = 'SUPPORTS',
  ATTACKS = 'ATTACKS',
}

export enum InteractionalRelationType {
  QUESTIONS = 'QUESTIONS',
  ANSWERS = 'ANSWERS',
}

export enum FactCheckBatchTaskStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum VerificationStatus {
  SUPPORTED = 'SUPPORTED',
  CONTRADICTED = 'CONTRADICTED',
  PARTIALLY_SUPPORTED = 'PARTIALLY_SUPPORTED',
  INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE',
  NOT_VERIFIABLE = 'NOT_VERIFIABLE',
  OUTDATED_OR_TIME_SENSITIVE = 'OUTDATED_OR_TIME_SENSITIVE',
}

export enum JudgmentWinner {
  SIDE_A = 'SIDE_A',
  SIDE_B = 'SIDE_B',
  DRAW = 'DRAW',
}

export interface Debate {
  id: string;
  topic: string;

  sideASpeakerId: string;
  sideBSpeakerId: string;

  rebuttalQuestionRounds: number;
  status: DebateStatus;

  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
}

export interface DebateTurn {
  id: string;
  debateId: string;

  speakerId: string;
  speakerSide: DebateSide;

  phase: DebatePhase;
  round: number;
  sequence: number;

  content: string;

  createdAt: Date;
}

export interface ArgumentComponent {
  id: string;
  turnId: string;

  isMajorClaim: boolean;
  statement: string;

  requiresFactCheck: boolean;

  createdAt: Date;
}

export interface ArgumentalRelation {
  id: string;

  fromComponentId: string;
  toComponentId: string;

  type: ArgumentalRelationType;

  createdAt: Date;
}

export interface InteractionalRelation {
  id: string;

  fromComponentId: string;
  toComponentId: string;

  type: InteractionalRelationType;

  createdAt: Date;
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

export interface FactCheckBatchTarget {
  id: string;

  factCheckBatchTaskId: string;
  componentId: string;

  createdAt: Date;
}

export interface FactCheckJobData {
  factCheckBatchTaskId: string;
}

export interface FactCheckResult {
  id: string;

  factCheckBatchTaskId: string;
  componentId: string;

  status: VerificationStatus;
  reason: string;

  checkedAt: Date;
}

export interface FactCheckSource {
  id: string;
  factCheckResultId: string;

  title: string;
  publisher: string;
  url: string;

  createdAt: Date;
}

export interface JudgmentResult {
  id: string;
  debateId: string;

  winner: JudgmentWinner;

  sideAArgumentationScore: number;
  sideAInteractionScore: number;
  sideAFactualReliabilityScore: number;
  sideATotalScore: number;

  sideBArgumentationScore: number;
  sideBInteractionScore: number;
  sideBFactualReliabilityScore: number;
  sideBTotalScore: number;

  overallReason: string;
  sideAFeedback: string;
  sideBFeedback: string;

  judgedAt: Date;
}
```

---

## 15. 기존 스키마에서 수정된 사항

### 문법 오류 수정

기존 `InteractionalRelationType` enum의 닫는 중괄호가 누락되어 있었다.

```ts
export enum InteractionalRelationType {
  QUESTIONS = 'QUESTIONS',
  ANSWERS = 'ANSWERS',
}
```

### 중복 필드 제거

기존 `FactCheckTask`에 `createdAt`이 두 번 선언되어 있었다.

### 단건 Task를 BatchTask로 변경

기존:

```ts
FactCheckTask {
  componentId
}

FactCheckJobData {
  factCheckTaskId
}
```

변경:

```ts
FactCheckBatchTask {
  turnId
}

FactCheckBatchTarget {
  factCheckBatchTaskId
  componentId
}

FactCheckJobData {
  factCheckBatchTaskId
}
```

### FactCheckResult에 BatchTask 연결 추가

기존에는 Result가 `componentId`만 보유했지만, 배치 실행 이력과 멱등성 보장을 위해 `factCheckBatchTaskId`를 추가했다.

### Relation과 Source의 생성 시각 통일

`InteractionalRelation`, `FactCheckSource`, `FactCheckBatchTarget`에 `createdAt`을 추가해 생성 이력 관리 방식을 통일했다.

---

## 16. 핵심 관계

```text
Debate
  1 ── N DebateTurn

DebateTurn
  1 ── N ArgumentComponent

ArgumentComponent
  1 ── N ArgumentalRelation
  1 ── N InteractionalRelation

DebateTurn
  1 ── 0..1 FactCheckBatchTask

FactCheckBatchTask
  1 ── N FactCheckBatchTarget

FactCheckBatchTarget
  N ── 1 ArgumentComponent

FactCheckBatchTask
  1 ── N FactCheckResult

FactCheckResult
  N ── 1 ArgumentComponent

FactCheckResult
  1 ── N FactCheckSource

Debate
  1 ── 0..1 JudgmentResult
```


---

## 17. TypeORM Entity 전체 매핑

아래 Entity는 앞에서 정의한 필드, 관계, Unique Constraint를 TypeORM 기준으로 매핑한 구현 기준이다.

```ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';

@Entity('debate')
export class DebateEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 500 })
  topic: string;

  @Column('uuid', { name: 'side_a_speaker_id' })
  sideASpeakerId: string;

  @Column('uuid', { name: 'side_b_speaker_id' })
  sideBSpeakerId: string;

  @Column({ type: 'int', name: 'rebuttal_question_rounds' })
  rebuttalQuestionRounds: number;

  @Column({ type: 'enum', enum: DebateStatus })
  status: DebateStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'ended_at', nullable: true })
  endedAt: Date | null;

  @OneToMany(() => DebateTurnEntity, (turn) => turn.debate)
  turns: DebateTurnEntity[];

  @OneToOne(() => JudgmentResultEntity, (result) => result.debate)
  judgmentResult: JudgmentResultEntity | null;
}

@Entity('debate_turn')
@Unique('uq_debate_turn_sequence', ['debateId', 'sequence'])
@Index('idx_debate_turn_debate_id', ['debateId'])
export class DebateTurnEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'debate_id' })
  debateId: string;

  @ManyToOne(() => DebateEntity, (debate) => debate.turns, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'debate_id' })
  debate: DebateEntity;

  @Column('uuid', { name: 'speaker_id' })
  speakerId: string;

  @Column({ type: 'enum', enum: DebateSide, name: 'speaker_side' })
  speakerSide: DebateSide;

  @Column({ type: 'enum', enum: DebatePhase })
  phase: DebatePhase;

  @Column({ type: 'int' })
  round: number;

  @Column({ type: 'int' })
  sequence: number;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => ArgumentComponentEntity, (component) => component.turn)
  components: ArgumentComponentEntity[];

  @OneToOne(() => FactCheckBatchTaskEntity, (task) => task.turn)
  factCheckBatchTask: FactCheckBatchTaskEntity | null;
}

@Entity('argument_component')
@Index('idx_argument_component_turn_id', ['turnId'])
export class ArgumentComponentEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'turn_id' })
  turnId: string;

  @ManyToOne(() => DebateTurnEntity, (turn) => turn.components, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'turn_id' })
  turn: DebateTurnEntity;

  @Column({ type: 'boolean', name: 'is_major_claim' })
  isMajorClaim: boolean;

  @Column({ type: 'text' })
  statement: string;

  @Column({ type: 'boolean', name: 'requires_fact_check' })
  requiresFactCheck: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('argumental_relation')
@Unique('uq_argumental_relation', [
  'fromComponentId',
  'toComponentId',
  'type',
])
@Check('ck_argumental_relation_no_self_ref', 'from_component_id <> to_component_id')
export class ArgumentalRelationEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'from_component_id' })
  fromComponentId: string;

  @ManyToOne(() => ArgumentComponentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'from_component_id' })
  fromComponent: ArgumentComponentEntity;

  @Column('uuid', { name: 'to_component_id' })
  toComponentId: string;

  @ManyToOne(() => ArgumentComponentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'to_component_id' })
  toComponent: ArgumentComponentEntity;

  @Column({ type: 'enum', enum: ArgumentalRelationType })
  type: ArgumentalRelationType;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('interactional_relation')
@Unique('uq_interactional_relation', [
  'fromComponentId',
  'toComponentId',
  'type',
])
@Check('ck_interactional_relation_no_self_ref', 'from_component_id <> to_component_id')
export class InteractionalRelationEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'from_component_id' })
  fromComponentId: string;

  @ManyToOne(() => ArgumentComponentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'from_component_id' })
  fromComponent: ArgumentComponentEntity;

  @Column('uuid', { name: 'to_component_id' })
  toComponentId: string;

  @ManyToOne(() => ArgumentComponentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'to_component_id' })
  toComponent: ArgumentComponentEntity;

  @Column({ type: 'enum', enum: InteractionalRelationType })
  type: InteractionalRelationType;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('fact_check_batch_task')
@Unique('uq_fact_check_batch_task_turn', ['turnId'])
@Index('idx_fact_check_batch_task_status', ['status'])
export class FactCheckBatchTaskEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'turn_id' })
  turnId: string;

  @OneToOne(() => DebateTurnEntity, (turn) => turn.factCheckBatchTask, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'turn_id' })
  turn: DebateTurnEntity;

  @Column({ type: 'enum', enum: FactCheckBatchTaskStatus })
  status: FactCheckBatchTaskStatus;

  @Column({ type: 'varchar', name: 'bullmq_job_id', nullable: true })
  bullMqJobId: string | null;

  @Column({ type: 'text', name: 'failure_reason', nullable: true })
  failureReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'processing_started_at', nullable: true })
  processingStartedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @OneToMany(() => FactCheckBatchTargetEntity, (target) => target.batchTask)
  targets: FactCheckBatchTargetEntity[];

  @OneToMany(() => FactCheckResultEntity, (result) => result.batchTask)
  results: FactCheckResultEntity[];
}

@Entity('fact_check_batch_target')
@Unique('uq_fact_check_batch_target', [
  'factCheckBatchTaskId',
  'componentId',
])
export class FactCheckBatchTargetEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'fact_check_batch_task_id' })
  factCheckBatchTaskId: string;

  @ManyToOne(() => FactCheckBatchTaskEntity, (task) => task.targets, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'fact_check_batch_task_id' })
  batchTask: FactCheckBatchTaskEntity;

  @Column('uuid', { name: 'component_id' })
  componentId: string;

  @ManyToOne(() => ArgumentComponentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'component_id' })
  component: ArgumentComponentEntity;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('fact_check_result')
@Unique('uq_fact_check_result_task_component', [
  'factCheckBatchTaskId',
  'componentId',
])
export class FactCheckResultEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'fact_check_batch_task_id' })
  factCheckBatchTaskId: string;

  @ManyToOne(() => FactCheckBatchTaskEntity, (task) => task.results, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'fact_check_batch_task_id' })
  batchTask: FactCheckBatchTaskEntity;

  @Column('uuid', { name: 'component_id' })
  componentId: string;

  @ManyToOne(() => ArgumentComponentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'component_id' })
  component: ArgumentComponentEntity;

  @Column({ type: 'enum', enum: VerificationStatus })
  status: VerificationStatus;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'timestamptz', name: 'checked_at' })
  checkedAt: Date;

  @OneToMany(() => FactCheckSourceEntity, (source) => source.result)
  sources: FactCheckSourceEntity[];
}

@Entity('fact_check_source')
@Unique('uq_fact_check_source_result_url', ['factCheckResultId', 'url'])
export class FactCheckSourceEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'fact_check_result_id' })
  factCheckResultId: string;

  @ManyToOne(() => FactCheckResultEntity, (result) => result.sources, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'fact_check_result_id' })
  result: FactCheckResultEntity;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'varchar', length: 255 })
  publisher: string;

  @Column({ type: 'text' })
  url: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('judgment_result')
@Unique('uq_judgment_result_debate', ['debateId'])
export class JudgmentResultEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'debate_id' })
  debateId: string;

  @OneToOne(() => DebateEntity, (debate) => debate.judgmentResult, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'debate_id' })
  debate: DebateEntity;

  @Column({ type: 'enum', enum: JudgmentWinner })
  winner: JudgmentWinner;

  @Column({ type: 'int', name: 'side_a_argumentation_score' })
  sideAArgumentationScore: number;

  @Column({ type: 'int', name: 'side_a_interaction_score' })
  sideAInteractionScore: number;

  @Column({ type: 'int', name: 'side_a_factual_reliability_score' })
  sideAFactualReliabilityScore: number;

  @Column({ type: 'int', name: 'side_a_total_score' })
  sideATotalScore: number;

  @Column({ type: 'int', name: 'side_b_argumentation_score' })
  sideBArgumentationScore: number;

  @Column({ type: 'int', name: 'side_b_interaction_score' })
  sideBInteractionScore: number;

  @Column({ type: 'int', name: 'side_b_factual_reliability_score' })
  sideBFactualReliabilityScore: number;

  @Column({ type: 'int', name: 'side_b_total_score' })
  sideBTotalScore: number;

  @Column({ type: 'text', name: 'overall_reason' })
  overallReason: string;

  @Column({ type: 'text', name: 'side_a_feedback' })
  sideAFeedback: string;

  @Column({ type: 'text', name: 'side_b_feedback' })
  sideBFeedback: string;

  @Column({ type: 'timestamptz', name: 'judged_at' })
  judgedAt: Date;
}
```

---

## 18. TypeORM Migration 및 DataSource 기준

```ts
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
```

```bash
npm run typeorm migration:generate -- src/database/migrations/CreateDebateSchema
npm run typeorm migration:run
npm run typeorm migration:revert
```

Migration은 다음 항목을 포함해야 한다.

- Enum type 생성 및 제거
- Table, FK, Unique Constraint, Index 생성
- Relation 자기 참조 금지 CHECK Constraint
- Judge 세부 점수와 총점 범위 CHECK Constraint
- Down Migration에서 생성 역순으로 안전하게 제거
