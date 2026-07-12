# Analyzer 구현 구조 및 저장 흐름 — TypeORM

## 1. 목적

Analyzer는 현재 `DebateTurn`의 원문과 지금까지 DB에 확정 저장된 논증 그래프를 입력으로 받아, 이번 Turn에서 새롭게 생성되는 논증 컴포넌트와 관계를 추출한다.

```text
현재 Turn 원문
+
현재 Debate의 누적 Component / Relation
  ↓
Analyzer AI 호출
  ↓
AnalyzeTurnOutput
  ↓
백엔드 검증
  ↓
임시 localKey를 실제 DB ID로 치환
  ↓
ArgumentComponent / Relation 저장
  ↓
requiresFactCheck 대상이 있으면 FactCheckBatchTask 생성
```

Analyzer는 기존 그래프를 수정하지 않는다.

이번 Turn에서 추출된 신규 Component만 관계의 출발점이 될 수 있으며, 관계 대상은 다음 중 하나다.

- 이번 Turn에서 함께 생성된 신규 Component
- 현재 Debate의 누적 그래프에 이미 존재하는 Component

따라서 Analyzer가 생성할 수 있는 관계 방향은 다음과 같다.

```text
NEW → NEW
NEW → EXISTING
```

다음 관계는 Analyzer 단계에서 생성하지 않는다.

```text
EXISTING → NEW
EXISTING → EXISTING
```

---

## 2. 전체 처리 흐름

```text
DebateTurn 저장 또는 조회
  ↓
현재 Debate의 누적 그래프 조회
  ↓
AnalyzeTurnInput 조립
  ↓
AnalyzerAiService 호출
  ↓
AnalyzeTurnOutput 수신
  ↓
Structured Output 스키마 검증
  ↓
도메인 검증
  ├─ localKey 형식 및 중복 검증
  ├─ NEW / EXISTING 참조 검증
  ├─ Major Claim 규칙 검증
  ├─ 관계 중복 및 모순 검증
  ├─ 고립 Component 검증
  └─ Component / FactCheck 대상 개수 제한 검증
  ↓
localKey → 실제 UUID 매핑 생성
  ↓
Component / Relation Entity 변환
  ↓
DB Transaction
  ├─ ArgumentComponent 저장
  ├─ ArgumentalRelation 저장
  ├─ InteractionalRelation 저장
  ├─ FactCheckBatchTask 생성
  └─ FactCheckBatchTarget 생성
  ↓
Transaction 커밋
  ↓
FactCheckBatchTask가 있으면 BullMQ Job 등록
```

---

# 3. Analyzer Input DTO

## 3.1 ExistingComponent

누적 그래프에 이미 저장된 Component를 Analyzer에게 전달하기 위한 축약 DTO다.

```ts
export interface ExistingComponent {
  id: string;
  turnId: string;

  speakerId: string;
  speakerSide: DebateSide;

  phase: DebatePhase;
  round: number;
  turnSequence: number;

  statement: string;
  isMajorClaim: boolean;
}
```

### 포함 필드의 목적

- `id`: EXISTING 관계 참조에 사용
- `turnId`: Component가 어느 Turn에 속하는지 식별
- `speakerId`: 참가자별 Major Claim 검증과 발언자 구분
- `speakerSide`: A/B 진영 관계 판단
- `phase`: OPENING, REBUTTAL_QUESTION, CLOSING 구분
- `round`: 같은 Phase 안에서의 라운드 구분
- `turnSequence`: 토론 전체 시간 순서 파악
- `statement`: 논증 관계 판단에 필요한 실제 문장
- `isMajorClaim`: 기존 Major Claim 존재 여부와 관계 해석에 사용

`requiresFactCheck`는 Analyzer가 기존 Component의 팩트체크 여부를 수정하지 않는다면 입력에서 생략할 수 있다.

---

## 3.2 ExistingArgumentalRelation

```ts
export interface ExistingArgumentalRelation {
  fromComponentId: string;
  toComponentId: string;
  type: ArgumentalRelationType;
}
```

Analyzer는 기존 관계를 수정하거나 재생성하지 않고 누적 그래프의 문맥으로만 사용한다.

---

## 3.3 ExistingInteractionalRelation

```ts
export interface ExistingInteractionalRelation {
  fromComponentId: string;
  toComponentId: string;
  type: InteractionalRelationType;
}
```

---

## 3.4 AnalyzeTurnInput

```ts
export interface AnalyzeTurnInput {
  debate: {
    id: string;
    topic: string;

    sideASpeakerId: string;
    sideBSpeakerId: string;

    rebuttalQuestionRounds: number;
  };

  currentTurn: {
    id: string;

    speakerId: string;
    speakerSide: DebateSide;

    phase: DebatePhase;
    round: number;
    sequence: number;

    content: string;
  };

  accumulatedGraph: {
    components: ExistingComponent[];
    argumentalRelations: ExistingArgumentalRelation[];
    interactionalRelations: ExistingInteractionalRelation[];
  };
}
```

### 입력 조립 규칙

백엔드는 Analyzer 호출 전에 다음을 보장해야 한다.

1. `currentTurn.id`는 아직 분석 결과가 저장되지 않은 Turn이어야 한다.
2. `accumulatedGraph.components`에는 현재 Turn의 Component가 포함되지 않아야 한다.
3. 모든 Existing Component는 `debate.id`에 속해야 한다.
4. 모든 Existing Relation의 양 끝 Component가 `accumulatedGraph.components`에 존재해야 한다.
5. `currentTurn.speakerId`와 `speakerSide`는 Debate 참가자 정보와 일치해야 한다.
6. 누적 그래프는 DB에 이미 확정 저장된 데이터만 포함해야 한다.
7. `currentTurn.content`는 공백이 아니어야 하며 최대 길이를 초과하면 안 된다.

---

# 4. Analyzer Output DTO

## 4.1 NewComponentLocalKey

```ts
export type NewComponentLocalKey = `NEW_${number}`;
```

AI 응답 안에서 신규 Component를 참조하기 위한 임시 식별자다.

실제 런타임 검증에는 다음 정규식을 사용한다.

```ts
const NEW_COMPONENT_LOCAL_KEY_PATTERN = /^NEW_[1-9]\d*$/;
```

유효 예시:

```text
NEW_1
NEW_2
NEW_15
```

무효 예시:

```text
NEW_0
NEW_-1
NEW_A
new_1
COMPONENT_1
```

번호가 반드시 연속일 필요는 없다.

```text
NEW_1, NEW_3
```

도 localKey 유일성과 참조 무결성만 만족하면 허용할 수 있다.

---

## 4.2 Component Reference

```ts
export interface NewComponentRef {
  source: 'NEW';
  localKey: NewComponentLocalKey;
}

export interface ExistingComponentRef {
  source: 'EXISTING';
  componentId: string;
}

export type RelationTargetRef =
  | NewComponentRef
  | ExistingComponentRef;
```

`source`는 Discriminated Union의 판별 필드다.

```ts
if (ref.source === 'NEW') {
  ref.localKey;
}

if (ref.source === 'EXISTING') {
  ref.componentId;
}
```

---

## 4.3 NewComponent

```ts
export interface NewComponent {
  /**
   * 현재 AnalyzeTurnOutput 안에서만 사용하는 임시 식별자.
   * 백엔드가 검증한 후 실제 DB UUID로 변환한다.
   */
  localKey: NewComponentLocalKey;

  statement: string;
  isMajorClaim: boolean;
  requiresFactCheck: boolean;
}
```

---

## 4.4 NewArgumentalRelation

```ts
export interface NewArgumentalRelation {
  /**
   * 현재 Turn에서 생성된 신규 Component만
   * 관계의 출발점이 될 수 있다.
   */
  from: NewComponentRef;

  /**
   * 관계 대상은 이번 Turn의 신규 Component이거나
   * 현재 Debate 누적 그래프의 기존 Component다.
   */
  to: RelationTargetRef;

  type: ArgumentalRelationType;
}
```

### 방향 정의

```text
SUPPORTS:
from Component가 to Component를 지지한다.

ATTACKS:
from Component가 to Component를 반박하거나 공격한다.
```

---

## 4.5 NewInteractionalRelation

```ts
export interface NewInteractionalRelation {
  from: NewComponentRef;
  to: RelationTargetRef;

  type: InteractionalRelationType;
}
```

### 방향 정의

```text
QUESTIONS:
from Component가 to Component에 질문한다.

ANSWERS:
from Component가 to Component의 질문에 답한다.
```

`ANSWERS`의 `to`는 질문 Component를 가리킨다.

---

## 4.6 AnalyzeTurnOutput

```ts
export interface AnalyzeTurnOutput {
  newComponents: NewComponent[];

  newArgumentalRelations: NewArgumentalRelation[];
  newInteractionalRelations: NewInteractionalRelation[];
}
```

---

# 5. Analyzer Output 예시

```json
{
  "newComponents": [
    {
      "localKey": "NEW_1",
      "statement": "단순 출석만으로 실제 수업 참여를 보장할 수 없다.",
      "isMajorClaim": false,
      "requiresFactCheck": false
    }
  ],
  "newArgumentalRelations": [
    {
      "from": {
        "source": "NEW",
        "localKey": "NEW_1"
      },
      "to": {
        "source": "EXISTING",
        "componentId": "cmp_b_1"
      },
      "type": "ATTACKS"
    }
  ],
  "newInteractionalRelations": []
}
```

이 결과는 다음 의미다.

```text
현재 Turn에서 생성된 NEW_1 Component가
기존 Component cmp_b_1을 반박한다.
```

---

# 6. 백엔드 검증 규칙

AI의 Structured Output이 TypeScript 형태와 맞더라도, 저장 전에 도메인 검증을 별도로 수행해야 한다.

## 6.1 localKey 형식 검증

모든 `NewComponent.localKey`는 다음 형식이어야 한다.

```ts
/^NEW_[1-9]\d*$/
```

---

## 6.2 localKey 중복 금지

한 응답의 `newComponents` 안에서 localKey는 유일해야 한다.

```ts
const localKeys = output.newComponents.map(
  ({ localKey }) => localKey,
);

if (new Set(localKeys).size !== localKeys.length) {
  throw new InvalidAnalyzeTurnOutputError(
    'Duplicate new component localKey.',
  );
}
```

---

## 6.3 NEW 참조 무결성

모든 관계의 NEW 참조는 `newComponents`에 실제로 존재해야 한다.

검증 대상:

- `relation.from.localKey`
- `relation.to.source === 'NEW'`인 경우 `relation.to.localKey`

---

## 6.4 EXISTING 참조 무결성

모든 EXISTING 참조는 다음 조건을 만족해야 한다.

1. `accumulatedGraph.components`에 포함되어 있어야 한다.
2. 현재 `debate.id`에 속한 Component여야 한다.
3. 현재 Turn에서 새로 생성된 Component를 EXISTING으로 참조하면 안 된다.

입력에 포함된 Existing Component ID Set을 기준으로 검증한다.

```ts
const existingComponentIds = new Set(
  input.accumulatedGraph.components.map(({ id }) => id),
);
```

---

## 6.5 from은 항상 NEW Component

모든 신규 관계의 `from.source`는 반드시 `NEW`여야 한다.

TypeScript 타입에서도 제한되지만 AI 응답은 런타임 입력이므로 다시 검증한다.

Analyzer는 기존 그래프의 관계를 수정하지 않는다.

---

## 6.6 고립 Component 제한

Major Claim이 아닌 신규 Component는 최소 하나의 관계에 참여해야 한다.

관계 참여는 다음 중 하나면 된다.

- ArgumentalRelation의 `from`
- ArgumentalRelation의 `to`
- InteractionalRelation의 `from`
- InteractionalRelation의 `to`

단, 현재 구조에서 모든 신규 Relation의 `from`은 NEW이므로 일반적으로 신규 Component는 `from` 또는 다른 NEW Component의 `to`로 연결된다.

```text
isMajorClaim = true
  → 관계 없는 루트 Component 허용

isMajorClaim = false
  → 최소 하나의 ArgumentalRelation 또는 InteractionalRelation 참여 필수
```

---

## 6.7 Major Claim Phase 제한

```text
isMajorClaim = true
```

는 `currentTurn.phase === OPENING`인 경우에만 허용한다.

OPENING이 아닌 Turn에서 `isMajorClaim = true`가 반환되면 전체 Analyzer Output을 거부한다.

---

## 6.8 참가자별 Major Claim 최대 하나

동일 참가자는 하나의 Debate에서 Major Claim을 최대 하나만 가질 수 있다.

검증 시 다음을 합산한다.

```text
accumulatedGraph에서 현재 speakerId의 기존 Major Claim 개수
+
이번 Output에서 isMajorClaim = true인 Component 개수
<= 1
```

현재 Turn 화자의 Major Claim만 새로 생성될 수 있으므로 `currentTurn.speakerId` 기준으로 검사한다.

---

## 6.9 동일 Relation 중복 금지

동일한 `from / to / type` 관계는 한 응답 안에서 중복될 수 없다.

NEW 참조는 localKey 기준으로, EXISTING 참조는 componentId 기준으로 정규화하여 비교한다.

예시 중복:

```text
NEW_1 → EXISTING:cmp_1 / ATTACKS
NEW_1 → EXISTING:cmp_1 / ATTACKS
```

---

## 6.10 SUPPORTS / ATTACKS 동시 생성 금지

동일한 `from / to` 조합에 다음 두 관계를 동시에 생성할 수 없다.

```text
SUPPORTS
ATTACKS
```

동일한 논증 방향이 동시에 지지와 반박 의미를 갖는 모순을 방지한다.

---

## 6.11 자기 참조 금지

관계의 `from`과 `to`는 같은 Component를 가리킬 수 없다.

예시:

```json
{
  "from": {
    "source": "NEW",
    "localKey": "NEW_1"
  },
  "to": {
    "source": "NEW",
    "localKey": "NEW_1"
  }
}
```

이 결과는 거부한다.

---

## 6.12 statement 검증

```text
statement.trim().length > 0
statement.length <= MAX_COMPONENT_STATEMENT_LENGTH
```

저장 시 앞뒤 공백은 제거한다.

---

## 6.13 Component 개수 제한

한 Turn에서 생성할 수 있는 신규 Component 수를 제한한다.

```ts
const MAX_COMPONENTS_PER_TURN = 10;
```

실제 값은 AI 비용과 서비스 정책에 따라 조정한다.

---

## 6.14 FactCheck 대상 개수 제한

한 Turn에서 `requiresFactCheck = true`인 Component 수를 제한한다.

```ts
const MAX_FACT_CHECK_TARGETS_PER_TURN = 5;
```

이 값은 이후 생성되는 `FactCheckBatchTask`의 최대 배치 크기와 일치시키는 것이 좋다.

---

## 6.15 현재 Turn 귀속

모든 `NewComponent`는 저장 시 반드시 `currentTurn.id`를 `turnId`로 가져야 한다.

AI Output에는 `turnId`를 받지 않는다.

```ts
const component: ArgumentComponent = {
  id: generatedId,
  turnId: input.currentTurn.id,
  ...
};
```

백엔드가 현재 Turn ID를 강제로 주입하여 AI가 다른 Turn으로 귀속시키지 못하게 한다.

---

# 7. 추가 권장 검증

## 7.1 InteractionalRelation 모순 검증

동일한 `from / to`에 `QUESTIONS`와 `ANSWERS`가 동시에 생성되는 것을 막는 것이 좋다.

```text
NEW_1 QUESTIONS NEW_2
NEW_1 ANSWERS NEW_2
```

는 의미가 충돌할 가능성이 높다.

---

## 7.2 Relation 양 끝 Debate 일치

모든 관계의 양 끝 Component는 동일한 Debate에 속해야 한다.

NEW Component는 현재 Turn에 속하고, 현재 Turn은 `input.debate.id`에 속한다.

EXISTING Component도 반드시 같은 Debate에 속해야 한다.

---

## 7.3 Current Turn 재분석 방지

BullMQ 재시도나 API 중복 호출로 같은 Turn이 두 번 저장되지 않도록 멱등성을 보장해야 한다.

권장 방식:

```text
DebateTurn.analysisStatus
- PENDING
- PROCESSING
- COMPLETED
- FAILED
```

또는 별도 `TurnAnalysisTask`를 둘 수 있다.

최소한 DB에서 현재 Turn에 이미 Component가 저장되어 있다면 중복 분석 저장을 차단해야 한다.

---

## 7.4 빈 Output 허용 여부

발언 내용에 논증 요소가 전혀 없다면 다음 Output을 허용할 수 있다.

```json
{
  "newComponents": [],
  "newArgumentalRelations": [],
  "newInteractionalRelations": []
}
```

다만 Phase별로 반드시 Component가 존재해야 하는 정책이 있다면 별도의 규칙을 둔다.

예:

```text
OPENING Turn은 최소 하나의 Major Claim 필요
CLOSING Turn은 최소 하나의 Component 필요
```

이 정책은 토론 진행 규칙에 따라 결정한다.

---

# 8. 검증 함수 구조

```ts
export function validateAnalyzeTurnOutput(
  input: AnalyzeTurnInput,
  output: AnalyzeTurnOutput,
): void {
  validateOutputSize(output);
  validateLocalKeys(output);
  validateReferences(input, output);
  validateRelationSources(output);
  validateSelfReferences(output);
  validateDuplicateRelations(output);
  validateConflictingArgumentalRelations(output);
  validateConflictingInteractionalRelations(output);
  validateStatements(output);
  validateMajorClaims(input, output);
  validateComponentConnectivity(output);
}
```

각 검증을 작은 함수로 분리하는 것이 좋다.

```text
validateLocalKeys
validateReferences
validateMajorClaims
validateRelations
validateLimits
```

하나의 거대한 함수에 모든 검증을 넣으면 테스트와 오류 추적이 어려워진다.

---

# 9. Reference 정규화

중복 관계와 자기 참조 검증을 위해 참조를 공통 문자열로 변환한다.

```ts
type ComponentRef =
  | NewComponentRef
  | ExistingComponentRef;

function normalizeComponentRef(
  ref: ComponentRef,
): string {
  if (ref.source === 'NEW') {
    return `NEW:${ref.localKey}`;
  }

  return `EXISTING:${ref.componentId}`;
}
```

Relation Key:

```ts
function buildRelationKey(
  from: NewComponentRef,
  to: RelationTargetRef,
  type: string,
): string {
  return [
    normalizeComponentRef(from),
    normalizeComponentRef(to),
    type,
  ].join('|');
}
```

방향만 비교하는 Key:

```ts
function buildRelationPairKey(
  from: NewComponentRef,
  to: RelationTargetRef,
): string {
  return [
    normalizeComponentRef(from),
    normalizeComponentRef(to),
  ].join('|');
}
```

---

# 10. localKey → DB ID 매핑

Output 검증이 끝나면 각 신규 Component에 실제 UUID를 부여한다.

```ts
function createLocalKeyToComponentIdMap(
  output: AnalyzeTurnOutput,
): Map<NewComponentLocalKey, string> {
  return new Map(
    output.newComponents.map(({ localKey }) => [
      localKey,
      crypto.randomUUID(),
    ]),
  );
}
```

예시:

```text
NEW_1 → 8f8ad719-...
NEW_2 → 6ac623f1-...
NEW_3 → 4f840bea-...
```

이 Map은 Component Entity와 Relation Entity를 만들 때 동일하게 사용한다.

---

# 11. Component Entity 매핑

```ts
function mapNewComponentsToEntities(
  input: AnalyzeTurnInput,
  output: AnalyzeTurnOutput,
  idMap: Map<NewComponentLocalKey, string>,
): ArgumentComponent[] {
  const createdAt = new Date();

  return output.newComponents.map((component) => ({
    id: getRequiredComponentId(idMap, component.localKey),
    turnId: input.currentTurn.id,

    statement: component.statement.trim(),
    isMajorClaim: component.isMajorClaim,
    requiresFactCheck: component.requiresFactCheck,

    createdAt,
  }));
}
```

---

# 12. Relation Target ID 해석

```ts
function resolveComponentRefId(
  ref: RelationTargetRef,
  idMap: Map<NewComponentLocalKey, string>,
): string {
  if (ref.source === 'NEW') {
    return getRequiredComponentId(idMap, ref.localKey);
  }

  return ref.componentId;
}
```

```ts
function getRequiredComponentId(
  idMap: Map<NewComponentLocalKey, string>,
  localKey: NewComponentLocalKey,
): string {
  const componentId = idMap.get(localKey);

  if (!componentId) {
    throw new Error(
      `Missing generated ID for localKey: ${localKey}`,
    );
  }

  return componentId;
}
```

---

# 13. ArgumentalRelation Entity 매핑

```ts
function mapArgumentalRelationsToEntities(
  output: AnalyzeTurnOutput,
  idMap: Map<NewComponentLocalKey, string>,
): ArgumentalRelation[] {
  const createdAt = new Date();

  return output.newArgumentalRelations.map((relation) => ({
    id: crypto.randomUUID(),

    fromComponentId: getRequiredComponentId(
      idMap,
      relation.from.localKey,
    ),

    toComponentId: resolveComponentRefId(
      relation.to,
      idMap,
    ),

    type: relation.type,
    createdAt,
  }));
}
```

---

# 14. InteractionalRelation Entity 매핑

```ts
function mapInteractionalRelationsToEntities(
  output: AnalyzeTurnOutput,
  idMap: Map<NewComponentLocalKey, string>,
): InteractionalRelation[] {
  const createdAt = new Date();

  return output.newInteractionalRelations.map((relation) => ({
    id: crypto.randomUUID(),

    fromComponentId: getRequiredComponentId(
      idMap,
      relation.from.localKey,
    ),

    toComponentId: resolveComponentRefId(
      relation.to,
      idMap,
    ),

    type: relation.type,
    createdAt,
  }));
}
```

---

# 15. 전체 Entity 매핑

```ts
export interface AnalyzeTurnMappedEntities {
  components: ArgumentComponent[];
  argumentalRelations: ArgumentalRelation[];
  interactionalRelations: InteractionalRelation[];
}

export function mapAnalyzeTurnOutputToEntities(
  input: AnalyzeTurnInput,
  output: AnalyzeTurnOutput,
): AnalyzeTurnMappedEntities {
  const idMap = createLocalKeyToComponentIdMap(output);

  return {
    components: mapNewComponentsToEntities(
      input,
      output,
      idMap,
    ),

    argumentalRelations: mapArgumentalRelationsToEntities(
      output,
      idMap,
    ),

    interactionalRelations:
      mapInteractionalRelationsToEntities(
        output,
        idMap,
      ),
  };
}
```

매핑 함수는 검증이 완료된 Output만 받는 것을 전제로 한다.

```text
AI Output
  ↓
validateAnalyzeTurnOutput
  ↓
mapAnalyzeTurnOutputToEntities
  ↓
DB 저장
```

---

# 16. FactCheck Batch 생성

매핑된 신규 Component 중 `requiresFactCheck = true`인 Component를 수집한다.

```ts
const factCheckTargets = entities.components.filter(
  ({ requiresFactCheck }) => requiresFactCheck,
);
```

대상이 하나 이상일 때만 BatchTask를 생성한다.

```ts
const batchTaskId =
  factCheckTargets.length > 0
    ? crypto.randomUUID()
    : null;
```

---

# 17. DB Transaction 저장

Component, Relation, BatchTask, BatchTarget은 하나의 DB 트랜잭션으로 저장한다.

```ts
const entities = mapAnalyzeTurnOutputToEntities(
  input,
  output,
);

const factCheckTargets = entities.components.filter(
  ({ requiresFactCheck }) => requiresFactCheck,
);

const factCheckBatchTaskId =
  factCheckTargets.length > 0
    ? crypto.randomUUID()
    : null;

await this.dataSource.transaction(async (manager) => {
  if (entities.components.length > 0) {
    await manager.insert(
      ArgumentComponentEntity,
      entities.components,
    );
  }

  if (entities.argumentalRelations.length > 0) {
    await manager.insert(
      ArgumentalRelationEntity,
      entities.argumentalRelations,
    );
  }

  if (entities.interactionalRelations.length > 0) {
    await manager.insert(
      InteractionalRelationEntity,
      entities.interactionalRelations,
    );
  }

  if (factCheckBatchTaskId) {
    await manager.insert(FactCheckBatchTaskEntity, {
      id: factCheckBatchTaskId,
      turnId: input.currentTurn.id,
      status: FactCheckBatchTaskStatus.PENDING,
      bullMqJobId: null,
      failureReason: null,
      processingStartedAt: null,
      completedAt: null,
    });

    await manager.insert(
      FactCheckBatchTargetEntity,
      factCheckTargets.map(({ id: componentId }) => ({
        id: crypto.randomUUID(),
        factCheckBatchTaskId,
        componentId,
        createdAt: new Date(),
      })),
    );
  }

  const updated = await manager
    .createQueryBuilder()
    .update(DebateTurnEntity)
    .set({
      analysisStatus: TurnAnalysisStatus.COMPLETED,
    })
    .where('id = :turnId', {
      turnId: input.currentTurn.id,
    })
    .andWhere('analysis_status = :status', {
      status: TurnAnalysisStatus.PROCESSING,
    })
    .execute();

  if (updated.affected !== 1) {
    throw new Error(
      `DebateTurn could not be completed: ${input.currentTurn.id}`,
    );
  }
});
```

---

# 18. BullMQ 등록

DB 커밋이 끝난 뒤 `FactCheckBatchTask`가 생성된 경우에만 Job을 등록한다.

```ts
if (factCheckBatchTaskId) {
  const job = await this.factCheckQueue.add(
    'fact-check-batch',
    {
      factCheckBatchTaskId,
    },
    {
      jobId: factCheckBatchTaskId,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    },
  );

  const queued = await this.factCheckBatchTaskRepository
    .createQueryBuilder()
    .update(FactCheckBatchTaskEntity)
    .set({
      status: FactCheckBatchTaskStatus.QUEUED,
      bullMqJobId: String(job.id),
    })
    .where('id = :taskId', {
      taskId: factCheckBatchTaskId,
    })
    .andWhere('status = :status', {
      status: FactCheckBatchTaskStatus.PENDING,
    })
    .execute();

  if (queued.affected !== 1) {
    throw new Error(
      `FactCheckBatchTask could not be queued: ${factCheckBatchTaskId}`,
    );
  }
}
```

Job 등록에 실패하면 Task는 `PENDING`에 남기고 별도 복구 로직으로 다시 등록한다.

---

# 19. Analyzer Service 책임 분리

## AnalyzerInputAssembler

- 현재 Turn 조회
- Debate 조회
- 누적 Component 조회
- 누적 Relation 조회
- `AnalyzeTurnInput` 조립
- 모든 누적 데이터가 현재 Debate에 속하는지 검증

## AnalyzerAiService

- Responses API 호출
- Structured Output 적용
- `AnalyzeTurnOutput` 반환
- DB 접근은 하지 않음

## AnalyzeTurnOutputValidator

- localKey 검증
- NEW / EXISTING 참조 검증
- Major Claim 검증
- Relation 중복 및 모순 검증
- Component 연결성 검증
- 개수 및 길이 제한 검증

## AnalyzeTurnOutputMapper

- localKey에 실제 UUID 부여
- Component Entity 생성
- Relation 참조 ID 치환
- Relation Entity 생성

## AnalyzeTurnService

- 전체 유스케이스 조율
- Input 조립 요청
- AI 호출
- Output 검증
- Entity 매핑
- DB Transaction
- FactCheck Batch Job 등록
- 성공 및 실패 상태 처리

---

# 20. 권장 폴더 구조

```text
analyzer/
├─ dto/
│  ├─ analyze-turn-input.ts
│  └─ analyze-turn-output.ts
├─ service/
│  ├─ analyze-turn.service.ts
│  ├─ analyzer-input-assembler.service.ts
│  └─ analyzer-ai.service.ts
├─ validator/
│  └─ analyze-turn-output.validator.ts
├─ mapper/
│  └─ analyze-turn-output.mapper.ts
├─ errors/
│  └─ invalid-analyze-turn-output.error.ts
└─ constants/
   └─ analyzer-limits.ts
```

---

# 21. AnalyzeTurnService 의사 코드

```ts
@Injectable()
export class AnalyzeTurnService {
  async analyze(turnId: string): Promise<void> {
    const claimed = await this.claimTurnAnalysis(turnId);

    if (!claimed) {
      return;
    }

    try {
      const input =
        await this.analyzerInputAssembler.build(turnId);

      const output =
        await this.analyzerAiService.analyze(input);

      validateAnalyzeTurnOutput(input, output);

      const entities =
        mapAnalyzeTurnOutputToEntities(input, output);

      const factCheckBatchTaskId =
        await this.saveAnalysisResult(
          input,
          entities,
        );

      if (factCheckBatchTaskId) {
        await this.enqueueFactCheckBatch(
          factCheckBatchTaskId,
        );
      }
    } catch (error) {
      await this.markAnalysisFailed(turnId, error);
      throw error;
    }
  }
}
```

---

# 22. 핵심 설계 원칙

1. Analyzer 입력에는 현재 Turn 원문과 DB에 확정 저장된 누적 그래프만 포함한다.
2. 현재 Turn의 분석 결과는 누적 그래프 입력에 포함하지 않는다.
3. Analyzer는 기존 그래프를 수정하지 않는다.
4. 신규 관계의 `from`은 항상 현재 Turn의 NEW Component다.
5. 관계 대상은 NEW 또는 현재 Debate의 EXISTING Component다.
6. AI의 localKey는 DB ID가 아니며 검증 후 UUID로 치환한다.
7. 모든 NEW / EXISTING 참조는 저장 전에 검증한다.
8. Major Claim은 OPENING에서만 생성하고 참가자당 최대 하나로 제한한다.
9. 일반 Component는 최소 하나의 관계에 참여해야 한다.
10. 동일 관계와 의미적으로 충돌하는 관계를 저장하지 않는다.
11. Component와 Relation의 개수 및 길이를 제한한다.
12. AI Output 검증과 Entity 매핑을 분리한다.
13. Component, Relation, FactCheckBatchTask, BatchTarget을 하나의 트랜잭션으로 저장한다.
14. FactCheck Job은 DB 커밋 이후 등록한다.
15. 같은 Turn의 분석이 중복 저장되지 않도록 멱등성을 보장한다.


---

# 22. TypeORM 적용 원칙

- `synchronize: false`를 사용한다.
- 모든 테이블·컬럼·인덱스·제약 변경은 Migration으로 관리한다.
- 트랜잭션 내부에서는 콜백으로 전달받은 `EntityManager`만 사용한다.
- Component, Relation, BatchTarget 일괄 저장에는 `EntityManager.insert()`를 우선한다.
- 상태 전이는 QueryBuilder의 조건부 `UPDATE`와 `UpdateResult.affected`로 검증한다.
- 복잡한 누적 그래프 조회는 Repository의 `find`보다 QueryBuilder와 명시적 JOIN을 우선한다.
- AI DTO, Validator, Mapper와 TypeORM Entity를 분리한다.
