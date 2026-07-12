# Judge 구현 구조 및 처리 흐름 — TypeORM

## 1. 목적

Judge는 토론이 종료되고 모든 팩트체크가 완료된 뒤, 전체 논증 그래프와 팩트체크 결과를 기반으로 양측의 토론 수행을 평가한다.

평가 항목은 다음과 같다.

```text
논증 구조                  40점
상호작용                   30점
사실 신뢰성                30점
──────────────────────────────
총점                      100점
```

Judge AI는 각 평가 영역의 점수와 평가 사유만 반환한다.

다음 값은 AI가 아니라 백엔드가 계산한다.

- 양측 총점
- 최종 승자

이를 통해 AI 출력의 산술 오류와 승자 불일치를 원천적으로 방지한다.

---

## 2. 명명 기준

프로젝트 전체에서 참가자를 `former/latter`가 아니라 `SIDE_A/SIDE_B` 기준으로 통일한다.

```text
Debate.sideASpeakerId ↔ DebateSide.A
Debate.sideBSpeakerId ↔ DebateSide.B
```

기존 DB 필드가 `formerSpeakerId`, `latterSpeakerId`라면 Judge Input을 조립할 때 다음처럼 변환할 수 있다.

```text
formerSpeakerId → sideASpeakerId
latterSpeakerId → sideBSpeakerId
```

Judge DTO와 `JudgmentResult`는 모두 `sideA`, `sideB` 명칭을 사용한다.

---

## 3. Judge 실행 조건

Judge는 다음 조건이 모두 충족된 경우에만 실행한다.

1. Debate가 종료 단계에 도달했다.
2. 모든 DebateTurn의 Analyzer 처리가 완료됐다.
3. 모든 `requiresFactCheck = true` Component에 FactCheckResult가 존재한다.
4. 모든 FactCheckBatchTask가 `COMPLETED` 상태다.
5. Debate 상태가 `JUDGING`이다.
6. 기존 JudgmentResult가 존재하지 않는다.

권장 상태 흐름:

```text
IN_PROGRESS
  ↓ 모든 Turn 종료
FINAL_FACT_CHECKING
  ↓ 모든 FactCheckBatchTask COMPLETED
JUDGING
  ↓ Judge 처리 성공
COMPLETED
```

Judge 처리 실패 시 Debate를 바로 `FAILED`로 만들지, Judge Task만 재시도할지는 운영 정책에 따라 결정한다.

---

## 4. 전체 처리 흐름

```text
토론 종료
  ↓
모든 FactCheckBatchTask 완료 여부 확인
  ↓
Debate 상태를 JUDGING으로 전환
  ↓
JudgeInput 조립
  ├─ Debate 정보 조회
  ├─ 전체 ArgumentComponent 조회
  ├─ ArgumentalRelation 조회
  ├─ InteractionalRelation 조회
  └─ FactCheckResult 조회
  ↓
JudgeInput 정합성 검증
  ↓
JudgeAiService 호출
  ↓
JudgeOutput 수신
  ↓
JudgeOutput 스키마 및 점수 검증
  ↓
백엔드에서 총점 계산
  ↓
백엔드에서 승자 결정
  ↓
JudgmentResult Entity 변환
  ↓
DB Transaction
  ├─ JudgmentResult 저장
  └─ Debate COMPLETED 처리
```

---

# 5. Judge Input DTO

## 5.1 JudgeComponent

```ts
export interface JudgeComponent {
  id: string;

  speakerId: string;
  speakerSide: DebateSide;

  phase: DebatePhase;
  round: number;
  turnSequence: number;

  statement: string;
  isMajorClaim: boolean;
  requiresFactCheck: boolean;
}
```

### 필드 목적

- `speakerId`: 실제 참가자 식별
- `speakerSide`: SIDE_A / SIDE_B를 AI가 직접 구분하도록 제공
- `phase`: OPENING, REBUTTAL_QUESTION, CLOSING의 역할 구분
- `round`: 반박 및 질문 라운드 구분
- `turnSequence`: 전체 토론 시간 순서 파악
- `statement`: 평가 대상 논증 문장
- `isMajorClaim`: 각 참가자의 핵심 주장 식별
- `requiresFactCheck`: FactCheckResult 누락 여부 검증 및 사실 신뢰성 평가 기준

---

## 5.2 JudgeArgumentalRelation

```ts
export interface JudgeArgumentalRelation {
  fromComponentId: string;
  toComponentId: string;

  type: ArgumentalRelationType;
}
```

관계 방향:

```text
SUPPORTS:
from Component가 to Component를 지지한다.

ATTACKS:
from Component가 to Component를 반박하거나 공격한다.
```

---

## 5.3 JudgeInteractionalRelation

```ts
export interface JudgeInteractionalRelation {
  fromComponentId: string;
  toComponentId: string;

  type: InteractionalRelationType;
}
```

관계 방향:

```text
QUESTIONS:
from Component가 to Component에 질문한다.

ANSWERS:
from Component가 to Component의 질문에 답한다.
```

---

## 5.4 JudgeFactCheckResult

```ts
export interface JudgeFactCheckResult {
  componentId: string;

  status: VerificationStatus;
  reason: string;
}
```

Judge는 FactChecker가 생성한 검증 결론을 이용해 사실 신뢰성 점수를 계산한다.

`FactCheckSource`는 Judge Input에 포함하지 않는다.

Judge는 출처를 다시 검증하는 역할이 아니라, 이미 완료된 FactCheckResult를 토론 평가에 반영하는 역할이기 때문이다.

---

## 5.5 JudgeInput

```ts
export interface JudgeInput {
  debate: {
    id: string;
    topic: string;

    sideASpeakerId: string;
    sideBSpeakerId: string;

    rebuttalQuestionRounds: number;
  };

  argumentGraph: {
    components: JudgeComponent[];
    argumentalRelations: JudgeArgumentalRelation[];
    interactionalRelations: JudgeInteractionalRelation[];
  };

  factCheckResults: JudgeFactCheckResult[];
}
```

---

# 6. JudgeInput 조립

```ts
async function buildJudgeInput(
  debateId: string,
): Promise<JudgeInput> {
  const debate = await this.debateRepository
    .createQueryBuilder('debate')
    .leftJoinAndSelect('debate.turns', 'turn')
    .leftJoinAndSelect('turn.components', 'component')
    .where('debate.id = :debateId', { debateId })
    .orderBy('turn.sequence', 'ASC')
    .getOne();

  if (!debate) {
    throw new Error('Debate not found.');
  }

  const componentIds = debate.turns.flatMap((turn) =>
    turn.components.map((component) => component.id),
  );

  const argumentalRelations =
    componentIds.length === 0
      ? []
      : await this.argumentalRelationRepository
          .createQueryBuilder('relation')
          .where('relation.fromComponentId IN (:...componentIds)', {
            componentIds,
          })
          .andWhere('relation.toComponentId IN (:...componentIds)', {
            componentIds,
          })
          .getMany();

  const interactionalRelations =
    componentIds.length === 0
      ? []
      : await this.interactionalRelationRepository
          .createQueryBuilder('relation')
          .where('relation.fromComponentId IN (:...componentIds)', {
            componentIds,
          })
          .andWhere('relation.toComponentId IN (:...componentIds)', {
            componentIds,
          })
          .getMany();

  const factCheckResults =
    componentIds.length === 0
      ? []
      : await this.factCheckResultRepository
          .createQueryBuilder('result')
          .where('result.componentId IN (:...componentIds)', {
            componentIds,
          })
          .getMany();

  const factCheckBatchTasks = await this.factCheckBatchTaskRepository
    .createQueryBuilder('task')
    .innerJoin('task.turn', 'turn')
    .where('turn.debateId = :debateId', { debateId })
    .getMany();

  return {
    debate: {
      id: debate.id,
      topic: debate.topic,

      sideASpeakerId: debate.sideASpeakerId,
      sideBSpeakerId: debate.sideBSpeakerId,

      rebuttalQuestionRounds:
        debate.rebuttalQuestionRounds,
    },

    argumentGraph: {
      components: debate.turns.flatMap((turn) =>
        turn.components.map((component) => ({
          id: component.id,

          speakerId: turn.speakerId,
          speakerSide: turn.speakerSide,

          phase: turn.phase,
          round: turn.round,
          turnSequence: turn.sequence,

          statement: component.statement,
          isMajorClaim: component.isMajorClaim,
          requiresFactCheck:
            component.requiresFactCheck,
        })),
      ),

      argumentalRelations:
        argumentalRelations.map((relation) => ({
          fromComponentId:
            relation.fromComponentId,
          toComponentId:
            relation.toComponentId,
          type: relation.type,
        })),

      interactionalRelations:
        interactionalRelations.map((relation) => ({
          fromComponentId:
            relation.fromComponentId,
          toComponentId:
            relation.toComponentId,
          type: relation.type,
        })),
    },

    factCheckResults:
      factCheckResults.map((result) => ({
        componentId: result.componentId,
        status: result.status,
        reason: result.reason,
      })),
  };
}
```

실제 TypeORM Entity Relation 구조에 따라 QueryBuilder의 JOIN과 조회 쿼리는 조정한다.

---

# 7. JudgeInput 검증

Judge AI 호출 전에 입력 그래프와 팩트체크 결과의 정합성을 검증한다.

## 7.1 Debate 상태 검증

```text
debate.status === JUDGING
```

이어야 한다.

---

## 7.2 참가자 검증

모든 Component의 `speakerId`는 다음 중 하나여야 한다.

```text
debate.sideASpeakerId
debate.sideBSpeakerId
```

또한 `speakerId`와 `speakerSide`가 일치해야 한다.

```text
speakerSide = A
→ speakerId = sideASpeakerId

speakerSide = B
→ speakerId = sideBSpeakerId
```

---

## 7.3 Component ID 중복 금지

```text
argumentGraph.components[].id
```

는 모두 유일해야 한다.

---

## 7.4 Relation 참조 무결성

모든 ArgumentalRelation과 InteractionalRelation의 양 끝 ID가 `components`에 존재해야 한다.

```text
fromComponentId ∈ componentIds
toComponentId ∈ componentIds
```

---

## 7.5 Relation 자기 참조 금지

```text
fromComponentId !== toComponentId
```

이어야 한다.

---

## 7.6 FactCheckResult 중복 금지

동일한 `componentId`의 FactCheckResult가 중복되면 안 된다.

```text
UNIQUE(factCheckResults.componentId)
```

Judge Input 기준으로도 다시 검증한다.

---

## 7.7 예상하지 않은 FactCheckResult 금지

FactCheckResult의 `componentId`는 반드시 `argumentGraph.components`에 존재해야 한다.

---

## 7.8 FactCheckResult 누락 검증

`requiresFactCheck = true`인 모든 Component는 FactCheckResult를 정확히 하나 가져야 한다.

```text
requiresFactCheck = true
→ FactCheckResult 정확히 1개 필요

requiresFactCheck = false
→ FactCheckResult 없어도 정상
```

`requiresFactCheck = true`인데 결과가 없다면 Judge를 호출하지 않는다.

---

## 7.9 FactCheckBatchTask 완료 검증

현재 Debate의 모든 FactCheckBatchTask가 `COMPLETED` 상태인지 확인한다.

팩트체크 대상이 없는 Turn은 BatchTask가 없어도 정상이다.

---

## 7.10 Major Claim 검증

각 Side에는 최대 하나의 Major Claim이 존재해야 한다.

```text
SIDE_A Major Claim <= 1
SIDE_B Major Claim <= 1
```

토론 정책상 OPENING에서 반드시 Major Claim이 하나 있어야 한다면 정확히 하나인지 검사할 수 있다.

---

# 8. 점수 기준

## 8.1 논증 구조: 40점

다음 요소를 평가한다.

- 핵심 주장 명확성
- 근거와 주장 사이의 SUPPORTS 구조
- 상대 핵심 주장에 대한 ATTACKS 적절성
- 반박이 상대 논거를 실제로 약화시키는지
- 주장 간 논리적 일관성
- 근거 없는 단정이나 자기모순 여부
- Opening부터 Closing까지 논증 구조의 완결성

점수 범위:

```text
0 ~ 40
```

---

## 8.2 상호작용: 30점

다음 요소를 평가한다.

- 상대 주장에 대한 질문의 적절성
- 질문이 상대 논증의 핵심을 겨냥했는지
- 질문에 대한 답변 대응성
- 회피성 답변 여부
- 상대의 반박을 실제로 다뤘는지
- QUESTIONS / ANSWERS 연결의 완결성
- 토론 흐름과 맥락에 맞는 상호작용인지

점수 범위:

```text
0 ~ 30
```

---

## 8.3 사실 신뢰성: 30점

`requiresFactCheck = true`인 Component와 FactCheckResult를 기반으로 평가한다.

일반적인 반영 방향:

| VerificationStatus | 평가 방향 |
|---|---|
| `SUPPORTED` | 긍정적으로 반영 |
| `CONTRADICTED` | 큰 감점 |
| `PARTIALLY_SUPPORTED` | 제한적 감점 |
| `INSUFFICIENT_EVIDENCE` | 근거 부족으로 감점 |
| `NOT_VERIFIABLE` | 사실 신뢰성 평가에서 중립 또는 제한적 반영 |
| `OUTDATED_OR_TIME_SENSITIVE` | 단정 수준과 시점 의존성을 고려해 제한적 감점 |

`requiresFactCheck = false`인 의견, 가치판단, 논리적 주장은 FactCheckResult가 없다는 이유만으로 감점하지 않는다.

점수 범위:

```text
0 ~ 30
```

---

# 9. JudgeOutput DTO

AI는 세부 점수와 평가 텍스트만 반환한다.

총점과 승자는 반환하지 않는다.

```ts
export interface JudgeOutput {
  sideAArgumentationScore: number;
  sideAInteractionScore: number;
  sideAFactualReliabilityScore: number;

  sideBArgumentationScore: number;
  sideBInteractionScore: number;
  sideBFactualReliabilityScore: number;

  overallReason: string;

  sideAFeedback: string;
  sideBFeedback: string;
}
```

---

# 10. JudgeOutput 예시

```json
{
  "sideAArgumentationScore": 33,
  "sideAInteractionScore": 24,
  "sideAFactualReliabilityScore": 21,

  "sideBArgumentationScore": 29,
  "sideBInteractionScore": 22,
  "sideBFactualReliabilityScore": 18,

  "overallReason": "SIDE_A는 상대의 핵심 논거인 출석의 참여 보장 효과를 직접 공격하고 자신의 폐지 주장을 보강했다. SIDE_B는 출석을 최소 참여 조건으로 재정의했으나, 해당 조건이 점수 반영까지 정당화한다는 추가 근거가 부족했다. SIDE_A의 일부 조사 근거는 충분히 검증되지 않아 사실 신뢰성 점수에는 제한적으로 반영되었다.",

  "sideAFeedback": "상대 핵심 논거를 겨냥한 반박 구조는 좋았지만, 조사 결과와 같은 사실 근거를 제시할 때 확인 가능한 자료를 활용하면 설득력이 높아질 수 있습니다.",

  "sideBFeedback": "출석을 최소 참여 조건으로 재정의한 대응은 적절했지만, 해당 조건이 성적 반영으로 이어져야 하는 이유를 뒷받침할 근거가 필요합니다."
}
```

백엔드 계산 결과:

```text
SIDE_A Total = 33 + 24 + 21 = 78
SIDE_B Total = 29 + 22 + 18 = 69

Winner = SIDE_A
```

---

# 11. JudgeOutput 검증

## 11.1 점수 타입 및 범위 검증

모든 점수는 정수여야 한다.

```ts
interface ScoreRule {
  name: string;
  value: number;
  max: number;
}

export function validateJudgeOutput(
  output: JudgeOutput,
): void {
  const scoreRules: ScoreRule[] = [
    {
      name: 'sideAArgumentationScore',
      value: output.sideAArgumentationScore,
      max: 40,
    },
    {
      name: 'sideAInteractionScore',
      value: output.sideAInteractionScore,
      max: 30,
    },
    {
      name: 'sideAFactualReliabilityScore',
      value: output.sideAFactualReliabilityScore,
      max: 30,
    },
    {
      name: 'sideBArgumentationScore',
      value: output.sideBArgumentationScore,
      max: 40,
    },
    {
      name: 'sideBInteractionScore',
      value: output.sideBInteractionScore,
      max: 30,
    },
    {
      name: 'sideBFactualReliabilityScore',
      value: output.sideBFactualReliabilityScore,
      max: 30,
    },
  ];

  for (const rule of scoreRules) {
    if (!Number.isInteger(rule.value)) {
      throw new InvalidJudgeOutputError(
        `${rule.name} must be an integer.`,
      );
    }

    if (rule.value < 0 || rule.value > rule.max) {
      throw new InvalidJudgeOutputError(
        `${rule.name} must be between 0 and ${rule.max}.`,
      );
    }
  }

  validateJudgeOutputTexts(output);
}
```

---

## 11.2 평가 텍스트 검증

```ts
const MAX_OVERALL_REASON_LENGTH = 3000;
const MAX_FEEDBACK_LENGTH = 1500;

function validateJudgeOutputTexts(
  output: JudgeOutput,
): void {
  const overallReason = output.overallReason.trim();
  const sideAFeedback = output.sideAFeedback.trim();
  const sideBFeedback = output.sideBFeedback.trim();

  if (!overallReason) {
    throw new InvalidJudgeOutputError(
      'overallReason must not be empty.',
    );
  }

  if (!sideAFeedback) {
    throw new InvalidJudgeOutputError(
      'sideAFeedback must not be empty.',
    );
  }

  if (!sideBFeedback) {
    throw new InvalidJudgeOutputError(
      'sideBFeedback must not be empty.',
    );
  }

  if (
    overallReason.length >
    MAX_OVERALL_REASON_LENGTH
  ) {
    throw new InvalidJudgeOutputError(
      'overallReason exceeds the maximum length.',
    );
  }

  if (sideAFeedback.length > MAX_FEEDBACK_LENGTH) {
    throw new InvalidJudgeOutputError(
      'sideAFeedback exceeds the maximum length.',
    );
  }

  if (sideBFeedback.length > MAX_FEEDBACK_LENGTH) {
    throw new InvalidJudgeOutputError(
      'sideBFeedback exceeds the maximum length.',
    );
  }
}
```

---

# 12. 총점 계산

총점은 백엔드에서 계산한다.

```ts
export interface CalculatedJudgeScore {
  sideATotalScore: number;
  sideBTotalScore: number;
}

export function calculateJudgeTotalScores(
  output: JudgeOutput,
): CalculatedJudgeScore {
  return {
    sideATotalScore:
      output.sideAArgumentationScore +
      output.sideAInteractionScore +
      output.sideAFactualReliabilityScore,

    sideBTotalScore:
      output.sideBArgumentationScore +
      output.sideBInteractionScore +
      output.sideBFactualReliabilityScore,
  };
}
```

각 총점은 점수 범위 검증을 통과했다면 자동으로 `0~100` 범위가 된다.

---

# 13. 승자 결정

```ts
export enum JudgmentWinner {
  SIDE_A = 'SIDE_A',
  SIDE_B = 'SIDE_B',
  DRAW = 'DRAW',
}
```

```ts
export function determineJudgmentWinner(
  sideATotalScore: number,
  sideBTotalScore: number,
): JudgmentWinner {
  if (sideATotalScore > sideBTotalScore) {
    return JudgmentWinner.SIDE_A;
  }

  if (sideBTotalScore > sideATotalScore) {
    return JudgmentWinner.SIDE_B;
  }

  return JudgmentWinner.DRAW;
}
```

현재 정책은 총점이 동일할 때만 무승부로 처리한다.

점수 차이가 일정 범위 이내면 무승부로 처리하려면 다음처럼 기준을 별도로 둘 수 있다.

```ts
const DRAW_THRESHOLD = 0;
```

졸업 프로젝트 범위에서는 동일 점수만 DRAW로 처리하는 것이 가장 명확하다.

---

# 14. JudgmentResult Entity

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

추천 DB 제약:

```text
UNIQUE(debate_id)
```

토론당 최종 판정 결과 하나만 저장한다.

---

# 15. Entity 변환

```ts
export function mapJudgeOutputToJudgmentResult(
  debateId: string,
  output: JudgeOutput,
): JudgmentResult {
  const {
    sideATotalScore,
    sideBTotalScore,
  } = calculateJudgeTotalScores(output);

  const winner = determineJudgmentWinner(
    sideATotalScore,
    sideBTotalScore,
  );

  return {
    id: crypto.randomUUID(),
    debateId,

    winner,

    sideAArgumentationScore:
      output.sideAArgumentationScore,
    sideAInteractionScore:
      output.sideAInteractionScore,
    sideAFactualReliabilityScore:
      output.sideAFactualReliabilityScore,
    sideATotalScore,

    sideBArgumentationScore:
      output.sideBArgumentationScore,
    sideBInteractionScore:
      output.sideBInteractionScore,
    sideBFactualReliabilityScore:
      output.sideBFactualReliabilityScore,
    sideBTotalScore,

    overallReason: output.overallReason.trim(),

    sideAFeedback: output.sideAFeedback.trim(),
    sideBFeedback: output.sideBFeedback.trim(),

    judgedAt: new Date(),
  };
}
```

매핑 함수는 검증이 완료된 JudgeOutput만 받는 것을 전제로 한다.

```text
JudgeOutput
  ↓
validateJudgeOutput
  ↓
mapJudgeOutputToJudgmentResult
  ↓
DB 저장
```

---

# 16. DB 저장

JudgmentResult 저장과 Debate 완료 처리는 하나의 트랜잭션으로 묶는다.

```ts
await this.dataSource.transaction(async (manager) => {
  await manager.insert(
    JudgmentResultEntity,
    judgmentResult,
  );

  const updated = await manager
    .createQueryBuilder()
    .update(DebateEntity)
    .set({
      status: DebateStatus.COMPLETED,
      endedAt: new Date(),
    })
    .where('id = :debateId', { debateId })
    .andWhere('status = :status', {
      status: DebateStatus.JUDGING,
    })
    .execute();

  if (updated.affected !== 1) {
    throw new Error(
      `Debate could not be completed: ${debateId}`,
    );
  }
});
```

Debate 상태 갱신이 실패하면 JudgmentResult 저장도 롤백된다.

---

# 17. JudgeAiService

Judge AI 통신만 담당한다.

```ts
@Injectable()
export class JudgeAiService {
  async judge(
    input: JudgeInput,
  ): Promise<JudgeOutput> {
    const response = await this.openAi.responses.create({
      // model
      // instructions
      // structured output schema
      // input
    });

    return this.parseJudgeOutput(response);
  }
}
```

JudgeAiService에서는 다음 작업을 하지 않는다.

- DB 조회
- 총점 계산
- 승자 결정
- JudgmentResult 저장
- Debate 상태 변경

---

# 18. JudgeService

전체 Judge 유스케이스를 조율한다.

```ts
@Injectable()
export class JudgeService {
  async judgeDebate(debateId: string): Promise<void> {
    const claimed = await this.claimJudging(debateId);

    if (!claimed) {
      return;
    }

    try {
      const input =
        await this.judgeInputAssembler.build(debateId);

      validateJudgeInput(input);

      const output =
        await this.judgeAiService.judge(input);

      validateJudgeOutput(output);

      const judgmentResult =
        mapJudgeOutputToJudgmentResult(
          debateId,
          output,
        );

      await this.saveJudgmentAndCompleteDebate(
        debateId,
        judgmentResult,
      );
    } catch (error) {
      await this.handleJudgeFailure(
        debateId,
        error,
      );

      throw error;
    }
  }
}
```

---

# 19. Judge 실행 선점과 멱등성

같은 Debate에 대해 Judge가 중복 실행되지 않도록 해야 한다.

가장 단순한 방식은 Debate 상태를 조건부 갱신하는 것이다.

예를 들어 판정 대기 상태를 별도로 둔다면:

```text
READY_TO_JUDGE → JUDGING
```

조건부 UPDATE로 선점할 수 있다.

현재 상태 enum만 사용한다면 Judge 호출 전에 Debate가 이미 `JUDGING`으로 전환되었는지 확인하고, `JudgmentResult.debateId`에 Unique Constraint를 둔다.

```text
UNIQUE(judgment_result.debate_id)
```

중복 실행이 발생해도 DB가 두 번째 결과 저장을 차단한다.

Judge Task를 BullMQ로 처리한다면 별도의 `JudgmentTask` 엔티티를 두는 것도 가능하다.

---

# 20. 실패 처리

## 재시도 가능한 오류

- AI API 타임아웃
- AI API 5xx 오류
- 일시적인 네트워크 장애
- 응답 파싱 실패
- JudgeOutput 스키마 검증 실패
- 일시적인 DB 오류

## 복구 불가능한 오류

- Debate가 존재하지 않음
- 참가자 정보 불일치
- Relation이 존재하지 않는 Component를 참조
- 팩트체크 대상 Component의 결과 누락
- FactCheckBatchTask 미완료
- 이미 JudgmentResult가 존재함

Judge 실패 시 Debate를 `FAILED`로 즉시 전환하면 재시도가 어려워질 수 있다.

권장 방식:

```text
Debate.status = JUDGING 유지
JudgmentTask.status = FAILED
```

또는 별도 Judge Task를 사용하지 않는 단순 구조에서는 오류를 기록하고 명시적 재시도 정책을 둔다.

---

# 21. 책임 분리

## JudgeInputAssembler

- Debate 조회
- 전체 Component 조회
- 전체 Relation 조회
- FactCheckResult 조회
- `JudgeInput` 조립

## JudgeInputValidator

- Debate 상태 검증
- 참가자와 Side 일치 검증
- Component ID 중복 검증
- Relation 참조 무결성 검증
- FactCheckResult 중복 및 누락 검증
- 모든 FactCheckBatchTask 완료 여부 검증

## JudgeAiService

- Responses API 호출
- Structured Output 파싱
- `JudgeOutput` 반환

## JudgeOutputValidator

- 정수 점수 검증
- 40/30/30 범위 검증
- 평가 텍스트 필수값 및 길이 검증

## JudgmentCalculator

- 양측 총점 계산
- 최종 승자 결정

## JudgmentMapper

- JudgeOutput과 계산 결과를 `JudgmentResult`로 변환

## JudgeService

- 전체 유스케이스 조율
- 중복 실행 방지
- Input 조립
- AI 호출
- 검증
- Entity 저장
- Debate 상태 전환

---

# 22. 권장 폴더 구조

```text
judge/
├─ dto/
│  ├─ judge-input.ts
│  └─ judge-output.ts
├─ service/
│  ├─ judge.service.ts
│  ├─ judge-input-assembler.service.ts
│  └─ judge-ai.service.ts
├─ validator/
│  ├─ judge-input.validator.ts
│  └─ judge-output.validator.ts
├─ calculator/
│  └─ judgment.calculator.ts
├─ mapper/
│  └─ judgment-result.mapper.ts
├─ errors/
│  ├─ invalid-judge-input.error.ts
│  └─ invalid-judge-output.error.ts
└─ constants/
   └─ judge-score.constants.ts
```

---

# 23. 최종 TypeScript DTO

```ts
export interface JudgeComponent {
  id: string;

  speakerId: string;
  speakerSide: DebateSide;

  phase: DebatePhase;
  round: number;
  turnSequence: number;

  statement: string;
  isMajorClaim: boolean;
  requiresFactCheck: boolean;
}

export interface JudgeArgumentalRelation {
  fromComponentId: string;
  toComponentId: string;

  type: ArgumentalRelationType;
}

export interface JudgeInteractionalRelation {
  fromComponentId: string;
  toComponentId: string;

  type: InteractionalRelationType;
}

export interface JudgeFactCheckResult {
  componentId: string;

  status: VerificationStatus;
  reason: string;
}

export interface JudgeInput {
  debate: {
    id: string;
    topic: string;

    sideASpeakerId: string;
    sideBSpeakerId: string;

    rebuttalQuestionRounds: number;
  };

  argumentGraph: {
    components: JudgeComponent[];
    argumentalRelations: JudgeArgumentalRelation[];
    interactionalRelations: JudgeInteractionalRelation[];
  };

  factCheckResults: JudgeFactCheckResult[];
}

export interface JudgeOutput {
  sideAArgumentationScore: number;
  sideAInteractionScore: number;
  sideAFactualReliabilityScore: number;

  sideBArgumentationScore: number;
  sideBInteractionScore: number;
  sideBFactualReliabilityScore: number;

  overallReason: string;

  sideAFeedback: string;
  sideBFeedback: string;
}
```

---

# 24. 핵심 설계 원칙

1. 참가자 명칭은 `SIDE_A/SIDE_B`로 통일한다.
2. JudgeComponent에 `speakerSide`, `phase`, `requiresFactCheck`를 포함한다.
3. Judge는 전체 확정 논증 그래프를 입력으로 받는다.
4. Judge는 FactChecker의 최종 결과만 사용하며 Source를 재검증하지 않는다.
5. 팩트체크 대상 Component의 결과가 누락되면 Judge를 실행하지 않는다.
6. 점수는 논증 구조 40점, 상호작용 30점, 사실 신뢰성 30점으로 구성한다.
7. AI는 세부 점수와 평가 문장만 반환한다.
8. 총점은 백엔드에서 계산한다.
9. 승자는 백엔드에서 총점 비교로 결정한다.
10. JudgeOutput 점수는 정수와 범위를 모두 검증한다.
11. JudgmentResult 저장과 Debate 완료 처리는 하나의 트랜잭션으로 처리한다.
12. Debate당 JudgmentResult는 최대 하나만 허용한다.
13. 입력 그래프와 FactCheckResult의 참조 무결성을 Judge 호출 전에 검증한다.
14. Judge AI 통신과 DB 저장 책임을 분리한다.


---

# 22. TypeORM 적용 원칙

- `synchronize: false`를 사용한다.
- 모든 스키마 변경은 Migration으로 관리한다.
- 전체 그래프 조회는 QueryBuilder와 명시적인 JOIN으로 수행한다.
- JudgmentResult 저장과 Debate 완료 갱신은 같은 `DataSource.transaction()`에서 처리한다.
- 트랜잭션 내부에서는 콜백으로 전달받은 `EntityManager`만 사용한다.
- Debate 상태 전이는 조건부 `UPDATE` 후 `UpdateResult.affected === 1`로 검증한다.
- Judge DTO, Validator, Calculator, Mapper와 TypeORM Entity를 분리한다.
