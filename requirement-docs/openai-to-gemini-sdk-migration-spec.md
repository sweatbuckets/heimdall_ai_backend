# OpenAI 호출 모듈 → Gemini SDK 전환 구현 명세

## 1. 목적

기존 설계의 OpenAI Responses API 호출 계층을 Google Gemini API와 공식 JavaScript SDK인 `@google/genai` 기반으로 전환한다.

TypeORM, BullMQ, Redis, DTO, Validator, Mapper, 트랜잭션, 상태 전이, 멱등성 구조는 변경하지 않는다.

변경 대상은 주로 다음 AI 호출 계층이다.

```text
AnalyzerAiService
FactCheckerAiService
JudgeAiService
공통 Gemini Client Provider
AI 관련 환경변수
Structured Output Schema 전달 방식
Grounding Source 추출 방식
```

---

## 2. 역할별 모델 전략

비용 추정 자료의 설정을 기준으로 다음처럼 고정한다.

| 모듈 | 모델 / 도구 | 호출 횟수 가정 | 예상 비용 |
|---|---|---:|---:|
| Analyzer | Gemini 2.5 Flash | Debate당 6회 | 약 `$0.03` |
| Fact Checker | Gemini 2.5 Flash + Google Search Grounding | Debate당 30회 | 모델 약 `$0.03` + Grounding `$0` 또는 `$1.05` |
| Judge | Gemini 2.5 Flash | Debate당 1회 | 약 `$0.02` |
| 전체 | 위 조합 | 설계 가정 기준 | Grounding 무료 구간 약 `$0.08`, 유료 구간 약 `$1.13` |

### 비용 계산 전제

```text
Debate 1개
Turn 6개
Turn당 발언 약 1,000자
평균 Component 20개/Turn
전체 Component 약 120개
Fact Check 대상 약 30개
Judge는 전체 Graph를 한 번에 평가
```

위 수치는 구현 예산 산정을 위한 추정치다. 실제 비용은 다음 항목에 따라 달라진다.

- 프롬프트 길이
- 누적 Graph 크기
- 출력 토큰 수
- Grounding 호출 정책
- 무료 할당량
- 재시도 횟수
- Google의 가격 정책 변경

따라서 운영 전 최신 Gemini API 가격표와 실제 usage metadata를 다시 확인한다.

---

## 3. 중요한 Gemini 2.5 제약

Gemini 2.5 계열에서는 Google Search Grounding과 JSON Schema 기반 Structured Output을 한 요청에서 동시에 사용하는 구성이 제한될 수 있다.

따라서 Fact Checker는 다음 2단계 호출 구조를 사용한다.

```text
1단계: Grounded Evidence 수집
Gemini 2.5 Flash + Google Search Grounding
  ↓
근거 텍스트 + groundingMetadata + 실제 Source

2단계: Structured Result 생성
Gemini 2.5 Flash + responseMimeType/application/json + responseSchema
  ↓
FactCheckBatchOutput

3단계: 백엔드 검증
componentId 집합 / status / reason / source 정합성 검증
```

이 구조에서 Grounding 과금은 1단계 검색 호출에만 적용된다.

2단계는 검색 도구 없이 구조화된 결과를 생성하므로 추가 Grounding 과금은 없다. 다만 일반 모델 입력·출력 토큰 비용은 발생한다.

향후 Gemini 3 이상으로 전환하고 도구와 Structured Output의 동시 사용이 안정적으로 지원되면 한 번의 호출로 합치는 것을 검토할 수 있다.

---

## 4. 변경하지 않는 영역

다음 영역은 기존 설계를 그대로 유지한다.

```text
TypeORM Entity
TypeORM Migration
Repository / QueryBuilder
DataSource.transaction
EntityManager.insert
BullMQ Queue / Worker
Task 상태 전이
Analyzer DTO
Fact Checker DTO
Judge DTO
Validator
Mapper
멱등성
DB Unique Constraint
총점 계산
승자 결정
```

---

## 5. 패키지 변경

### 제거 대상

프로젝트에서 OpenAI만 사용하고 있었다면 다음 의존성을 제거한다.

```bash
npm uninstall openai
```

### 추가 대상

```bash
npm install @google/genai
```

타입 검증 라이브러리는 기존 프로젝트에 있는 것을 우선 재사용한다.

예:

```text
zod
class-validator
직접 작성한 런타임 Validator
```

Gemini Structured Output을 사용하더라도 기존 도메인 Validator는 반드시 유지한다.

---

## 6. 환경변수 변경

기존 OpenAI 환경변수를 Gemini 환경변수로 교체한다.

```env
# Gemini
GEMINI_API_KEY=

GEMINI_ANALYZER_MODEL=gemini-2.5-flash
GEMINI_FACT_CHECKER_MODEL=gemini-2.5-flash
GEMINI_JUDGE_MODEL=gemini-2.5-flash

# Request control
GEMINI_REQUEST_TIMEOUT_MS=60000
GEMINI_MAX_RETRIES=3

# Analyzer limits
MAX_COMPONENTS_PER_TURN=20
MAX_FACT_CHECK_TARGETS_PER_TURN=5
MAX_COMPONENT_STATEMENT_LENGTH=1000

# Fact Checker limits
MAX_FACT_CHECK_SOURCES_PER_RESULT=5
MAX_FACT_CHECK_REASON_LENGTH=2000

# Judge limits
MAX_JUDGE_OVERALL_REASON_LENGTH=3000
MAX_JUDGE_FEEDBACK_LENGTH=1500
```

### 환경변수 원칙

- `.env.example`에는 Secret을 넣지 않는다.
- 실제 API Key는 `.env` 또는 배포 환경의 Secret Manager에 저장한다.
- `ConfigService.getOrThrow()`로 필수 값을 읽는다.
- 모델명을 코드에 하드코딩하지 않는다.
- 가격 정책 변경에 대비해 역할별 모델명을 각각 분리한다.

---

## 7. 권장 모듈 구조

```text
src/
├─ ai/
│  ├─ gemini/
│  │  ├─ gemini.module.ts
│  │  ├─ gemini.constants.ts
│  │  ├─ gemini-client.provider.ts
│  │  ├─ gemini-response.util.ts
│  │  ├─ gemini-error.mapper.ts
│  │  └─ types/
│  │     ├─ gemini-grounding.types.ts
│  │     └─ gemini-usage.types.ts
│  └─ schemas/
│     ├─ analyze-turn.schema.ts
│     ├─ fact-check-batch.schema.ts
│     └─ judge.schema.ts
├─ analyzer/
│  └─ analyzer-ai.service.ts
├─ fact-check/
│  ├─ fact-checker-ai.service.ts
│  ├─ grounded-evidence.mapper.ts
│  └─ grounding-source.extractor.ts
└─ judge/
   └─ judge-ai.service.ts
```

---

## 8. Gemini Client Provider

Gemini Client는 모듈에서 하나만 생성하고 DI로 주입한다.

```ts
import { GoogleGenAI } from '@google/genai';

export const GEMINI_CLIENT = Symbol('GEMINI_CLIENT');
```

```ts
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

export const geminiClientProvider = {
  provide: GEMINI_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): GoogleGenAI => {
    return new GoogleGenAI({
      apiKey:
        configService.getOrThrow<string>(
          'GEMINI_API_KEY',
        ),
    });
  },
};
```

```ts
@Module({
  providers: [geminiClientProvider],
  exports: [GEMINI_CLIENT],
})
export class GeminiModule {}
```

각 AI Service가 직접 Client를 새로 생성하지 않는다.

---

## 9. 공통 응답 처리 원칙

Gemini 응답은 신뢰할 수 없는 외부 입력으로 취급한다.

```text
Gemini Response
  ↓
응답 text 존재 여부 확인
  ↓
JSON.parse
  ↓
Structured Output 기본 형태 확인
  ↓
기존 도메인 Validator 실행
  ↓
Mapper 실행
```

### JSON 파싱

```ts
export function parseRequiredJson<T>(
  text: string | undefined,
): T {
  if (!text || !text.trim()) {
    throw new InvalidGeminiResponseError(
      'Gemini response text is empty.',
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new InvalidGeminiResponseError(
      'Gemini response is not valid JSON.',
    );
  }
}
```

`JSON.parse()` 결과를 바로 신뢰하지 않는다. 반드시 역할별 Validator를 통과시킨다.

정규식으로 코드 펜스를 제거하거나 깨진 JSON을 임의 복구하지 않는다.

---

# 10. Analyzer 전환

## 10.1 처리 흐름

```text
AnalyzeTurnInput
  ↓
Gemini 2.5 Flash
  ↓
Structured AnalyzeTurnOutput
  ↓
validateAnalyzeTurnOutput
  ↓
localKey → UUID
  ↓
TypeORM Transaction
```

## 10.2 호출 예시

```ts
@Injectable()
export class AnalyzerAiService {
  constructor(
    @Inject(GEMINI_CLIENT)
    private readonly gemini: GoogleGenAI,
    private readonly configService: ConfigService,
  ) {}

  async analyze(
    input: AnalyzeTurnInput,
  ): Promise<AnalyzeTurnOutput> {
    const response =
      await this.gemini.models.generateContent({
        model:
          this.configService.getOrThrow<string>(
            'GEMINI_ANALYZER_MODEL',
          ),
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: JSON.stringify(input),
              },
            ],
          },
        ],
        config: {
          systemInstruction:
            ANALYZER_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: ANALYZE_TURN_RESPONSE_SCHEMA,
          temperature: 0.1,
        },
      });

    const output =
      parseRequiredJson<AnalyzeTurnOutput>(
        response.text,
      );

    validateAnalyzeTurnOutput(input, output);

    return output;
  }
}
```

## 10.3 Analyzer 주의사항

- 누적 Graph와 현재 Turn 원문만 전달한다.
- 기존 Graph를 수정하지 못하도록 Prompt와 Validator 양쪽에서 제한한다.
- `NEW → NEW`, `NEW → EXISTING`만 허용한다.
- `localKey`, Major Claim, Relation 정합성은 백엔드에서 재검증한다.
- Gemini가 반환한 UUID를 사용하지 않는다.
- 실제 Component UUID는 백엔드에서 생성한다.

---

# 11. Fact Checker 전환

## 11.1 전체 구조

```text
FactCheckBatchInput
  ↓
Grounding 단계
Gemini 2.5 Flash + Google Search
  ↓
GroundedEvidenceBundle
  ├─ 모델 근거 텍스트
  ├─ 검색 Query
  └─ groundingChunks 기반 Source
  ↓
Structured Synthesis 단계
Gemini 2.5 Flash + responseSchema
  ↓
FactCheckBatchOutput
  ↓
백엔드 검증
  ↓
FactCheckResult / FactCheckSource 저장
```

---

## 11.2 Grounding 단계

Grounding 단계에서는 JSON Schema를 강제하지 않는다.

```ts
const groundedResponse =
  await this.gemini.models.generateContent({
    model:
      this.configService.getOrThrow<string>(
        'GEMINI_FACT_CHECKER_MODEL',
      ),
    contents: buildGroundingPrompt(input),
    config: {
      systemInstruction:
        FACT_CHECK_GROUNDING_SYSTEM_INSTRUCTION,
      tools: [
        {
          googleSearch: {},
        },
      ],
      temperature: 0.1,
    },
  });
```

### Grounding Prompt 원칙

- 각 대상의 `componentId`를 반드시 포함한다.
- 대상별로 독립적으로 검증하도록 요구한다.
- 최신성이 필요한 주장은 현재 기준 검색을 요구한다.
- 가능한 한 공공기관, 학술기관, 공식 통계, 원문 자료를 우선한다.
- 블로그나 2차 요약 자료만으로 확정하지 않는다.
- 근거가 부족하면 억지로 결론을 만들지 않는다.

---

## 11.3 Grounding Metadata 추출

FactCheckSource는 모델 본문의 URL 문자열을 그대로 사용하지 않는다.

가능한 경우 Gemini 응답의 grounding metadata를 기준으로 Source를 추출한다.

개념적 타입:

```ts
export interface GroundedWebSource {
  title: string;
  uri: string;
}

export interface GroundedEvidenceBundle {
  evidenceText: string;
  webSearchQueries: string[];
  sources: GroundedWebSource[];
}
```

개념적 추출 예시:

```ts
export function extractGroundedEvidence(
  response: GenerateContentResponse,
): GroundedEvidenceBundle {
  const candidate = response.candidates?.[0];

  if (!candidate) {
    throw new InvalidGeminiResponseError(
      'Gemini returned no candidate.',
    );
  }

  const metadata = candidate.groundingMetadata;

  const sources =
    metadata?.groundingChunks
      ?.flatMap((chunk) => {
        const web = chunk.web;

        if (!web?.uri) {
          return [];
        }

        return [
          {
            title: web.title?.trim() || web.uri,
            uri: web.uri,
          },
        ];
      }) ?? [];

  return {
    evidenceText: response.text?.trim() ?? '',
    webSearchQueries:
      metadata?.webSearchQueries ?? [],
    sources: deduplicateSources(sources),
  };
}
```

SDK 버전에 따라 실제 타입명과 필드명은 달라질 수 있으므로 설치된 `@google/genai` 버전의 타입 정의를 기준으로 구현한다.

### Source 검증

- URI가 유효한 `http` 또는 `https` URL인지 검사한다.
- URL 중복을 제거한다.
- Source 최대 개수를 제한한다.
- grounding metadata가 없거나 Source가 비어 있다면 기술적 실패 또는 `INSUFFICIENT_EVIDENCE` 처리 정책을 명시한다.
- 모델이 본문에 임의로 적은 URL은 Source Entity로 저장하지 않는다.

---

## 11.4 Structured Synthesis 단계

Grounding 결과와 실제 Source 목록을 입력으로 다시 전달해 DTO 형식으로 변환한다.

```ts
const response =
  await this.gemini.models.generateContent({
    model:
      this.configService.getOrThrow<string>(
        'GEMINI_FACT_CHECKER_MODEL',
      ),
    contents: buildStructuredFactCheckPrompt({
      input,
      groundedEvidence,
    }),
    config: {
      systemInstruction:
        FACT_CHECK_SYNTHESIS_SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema:
        FACT_CHECK_BATCH_RESPONSE_SCHEMA,
      temperature: 0,
    },
  });
```

```ts
const output =
  parseRequiredJson<FactCheckBatchOutput>(
    response.text,
  );

validateFactCheckBatchOutput(input, output);
validateFactCheckSourcesAgainstGrounding(
  output,
  groundedEvidence,
);
```

### Source 허용 규칙

Structured Output의 Source URL은 반드시 Grounding 단계에서 추출된 URL 집합에 포함돼야 한다.

```ts
const allowedUrls = new Set(
  groundedEvidence.sources.map(({ uri }) => uri),
);
```

Output에 없는 URL이 생성되면 전체 결과를 거부한다.

더 안전한 방식은 AI가 URL을 직접 반환하지 않고 `sourceIndex`만 반환하도록 하는 것이다.

```ts
export interface FactCheckSourceReferenceOutput {
  sourceIndex: number;
}
```

백엔드가 `sourceIndex`를 Grounding Source와 매핑하여 실제 title, publisher, URL을 저장한다.

이 방식을 우선 권장한다.

---

## 11.5 Fact Checker 비용 구조

Fact Checker 한 Batch 처리에는 논리적으로 다음 두 모델 호출이 발생한다.

```text
Grounding 호출 1회
+
Structured Synthesis 호출 1회
```

다만 Grounding 과금은 첫 번째 호출에만 적용된다.

비용 추정 자료의 Debate당 Fact Check 30회가 개별 Component 기준인지, Turn Batch 기준인지 구현 전에 명확히 해야 한다.

현재 도메인 설계는 Turn 단위 Batch이므로 실제 Grounding 호출 수는 다음처럼 계산한다.

```text
Grounding 호출 수
= 팩트체크 대상 Component 수가 아니라
  팩트체크 대상이 존재하는 Turn의 Batch 수
```

예:

```text
Turn 6개
각 Turn에 팩트체크 대상 존재
→ Grounding 호출 최대 6회

Component 30개
각 Component를 별도로 검색
→ Grounding 호출 최대 30회
```

비용표가 30회 Grounding을 가정했다면, 현재 Batch 설계와 비용 계산 전제가 다를 수 있다.

Batch 안에서 모델이 여러 검색 Query를 실행할 수 있으므로 실제 과금 단위는 사용 중인 Gemini 모델과 최신 가격 정책을 기준으로 다시 확인해야 한다.

---

# 12. Judge 전환

## 12.1 처리 흐름

```text
JudgeInput
  ↓
Gemini 2.5 Flash
  ↓
Structured JudgeOutput
  ↓
점수 검증
  ↓
백엔드 총점 계산
  ↓
백엔드 승자 결정
```

## 12.2 호출 예시

```ts
@Injectable()
export class JudgeAiService {
  constructor(
    @Inject(GEMINI_CLIENT)
    private readonly gemini: GoogleGenAI,
    private readonly configService: ConfigService,
  ) {}

  async judge(
    input: JudgeInput,
  ): Promise<JudgeOutput> {
    const response =
      await this.gemini.models.generateContent({
        model:
          this.configService.getOrThrow<string>(
            'GEMINI_JUDGE_MODEL',
          ),
        contents: JSON.stringify(input),
        config: {
          systemInstruction:
            JUDGE_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: JUDGE_RESPONSE_SCHEMA,
          temperature: 0.1,
        },
      });

    const output =
      parseRequiredJson<JudgeOutput>(
        response.text,
      );

    validateJudgeOutput(output);

    return output;
  }
}
```

AI Output에는 총점과 승자를 포함하지 않는다.

```text
세부 점수 → Gemini
총점 계산 → Backend
승자 결정 → Backend
```

---

## 13. Structured Output Schema 원칙

Gemini의 `responseSchema`는 DTO 구조와 최대한 동일하게 작성한다.

다만 JSON Schema가 모든 도메인 규칙을 표현한다고 가정하지 않는다.

Schema가 담당하는 영역:

- object/array/string/number/boolean 타입
- required 필드
- enum
- 기본 배열 구조

백엔드 Validator가 담당하는 영역:

- Component ID 집합 일치
- 참조 무결성
- localKey 규칙
- Major Claim 규칙
- 점수 정수와 범위
- Source URL 허용 목록
- 중복 및 누락
- 최대 개수
- 문자열 trim 후 공백 여부

---

## 14. 오류 분류

```text
Retryable
- Gemini 429
- Gemini 5xx
- 네트워크 오류
- 요청 Timeout
- 일시적인 Grounding 실패
- 빈 응답 또는 일시적 SDK 오류

Non-retryable
- DB Input 정합성 오류
- 존재하지 않는 Task
- 잘못된 Component 관계
- 최대 제한 초과
- 영구적으로 유효하지 않은 설정
```

Structured Output 형식 오류는 제한 횟수까지 재시도할 수 있다.

재시도 후에도 실패하면 Task 상태 정책에 따라 `FAILED` 처리한다.

로그에는 다음 내용을 남기지 않는다.

- `GEMINI_API_KEY`
- 전체 Prompt
- 전체 사용자 발언
- 전체 Gemini 원본 응답
- 전체 검색 결과 본문

추적용 로그에는 다음만 포함한다.

```text
debateId
turnId
taskId
jobId
model
attempt
latencyMs
inputTokenCount
outputTokenCount
grounding 사용 여부
sourceCount
```

---

## 15. Usage 및 비용 관측

Gemini 응답에서 제공되는 usage metadata를 수집해 실제 비용 추정값을 보정한다.

권장 로그/메트릭:

```ts
export interface GeminiUsageMetric {
  module: 'ANALYZER' | 'FACT_CHECKER' | 'JUDGE';
  model: string;
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  totalTokenCount: number | null;
  grounded: boolean;
  sourceCount: number;
  latencyMs: number;
}
```

민감한 Prompt나 Output 본문은 저장하지 않는다.

Debate 단위로 다음을 집계한다.

```text
Analyzer 호출 수
Fact Checker Grounding 호출 수
Fact Checker Synthesis 호출 수
Judge 호출 수
입력 토큰
출력 토큰
재시도 수
Grounding Source 수
예상 비용
```

---

## 16. 테스트 항목

### Gemini Client

- API Key 누락
- 모델명 누락
- 정상 Client 주입
- SDK 오류 매핑

### AnalyzerAiService

- 정상 Structured Output
- 빈 response.text
- JSON 파싱 오류
- Schema는 맞지만 도메인 검증 실패
- Timeout
- 429/5xx 재시도

### FactCheckerAiService

- Grounding 성공
- groundingMetadata 누락
- groundingChunks 누락
- 중복 Source 제거
- 유효하지 않은 URL 제거/거부
- Synthesis 정상 응답
- Input componentId 결과 누락
- 예상하지 않은 componentId
- Grounding에 없는 URL 생성
- sourceIndex 범위 초과
- `INSUFFICIENT_EVIDENCE` 정상 완료
- Grounding 실패 후 재시도

### JudgeAiService

- 정상 점수
- 소수점 점수
- 점수 범위 초과
- 빈 Feedback
- AI가 totalScore/winner를 반환하더라도 저장 DTO에서 제외
- Backend 총점 및 승자 계산

---

## 17. 기존 구현 프롬프트에서 바꿀 표현

```text
OpenAI Node SDK
→ @google/genai

OpenAI Responses API
→ Gemini API

OpenAI Responses API Structured Output
→ Gemini responseSchema 기반 Structured Output

OPENAI_API_KEY
→ GEMINI_API_KEY

OPENAI_ANALYZER_MODEL
→ GEMINI_ANALYZER_MODEL

OPENAI_FACT_CHECKER_MODEL
→ GEMINI_FACT_CHECKER_MODEL

OPENAI_JUDGE_MODEL
→ GEMINI_JUDGE_MODEL
```

### 공통 구현 원칙 변경

기존:

```text
AI Service에서 OpenAI Responses API를 호출한다.
```

변경:

```text
AI Service에서 @google/genai SDK를 사용한다.
Analyzer와 Judge는 responseMimeType/application/json 및 responseSchema를 사용한다.
Fact Checker는 Google Search Grounding 단계와 Structured Synthesis 단계를 분리한다.
FactCheckSource는 grounding metadata에서 추출된 출처만 저장한다.
```

---

## 18. Codex 구현 지시문

다음 내용을 구현 프롬프트에 추가한다.

```text
AI 호출 계층은 OpenAI가 아니라 Google Gemini API로 구현하세요.

공식 JavaScript SDK인 @google/genai를 사용하세요.

역할별 모델은 환경변수로 분리합니다.

- Analyzer: gemini-2.5-flash
- Fact Checker: gemini-2.5-flash + Google Search Grounding
- Judge: gemini-2.5-flash

Analyzer와 Judge는 Gemini Structured Output을 사용하세요.

Fact Checker는 Gemini 2.5의 도구/Structured Output 결합 제약을 고려하여 다음 두 단계로 구현하세요.

1. Google Search Grounding으로 근거와 grounding metadata를 수집
2. 수집한 근거를 입력으로 별도의 Structured Output 호출을 수행

FactCheckSource는 모델이 임의 생성한 URL이 아니라 grounding metadata의 실제 Source를 기준으로 저장하세요.

가능하면 Structured Output에는 URL 대신 sourceIndex를 반환하게 하고, 백엔드가 Grounding Source 목록과 매핑하세요.

기존 TypeORM, BullMQ, DTO, Validator, Mapper, 트랜잭션, 상태 전이, 멱등성 설계는 변경하지 마세요.
```

---

## 19. 최종 구조

```text
NestJS
├─ TypeORM / PostgreSQL
├─ BullMQ / Redis
└─ GeminiModule
   ├─ Analyzer
   │  └─ Gemini 2.5 Flash
   │     + Structured Output
   │
   ├─ Fact Checker
   │  ├─ Gemini 2.5 Flash
   │  │  + Google Search Grounding
   │  └─ Gemini 2.5 Flash
   │     + Structured Output
   │
   └─ Judge
      └─ Gemini 2.5 Flash
         + Structured Output
```

비용 추정 자료 기준:

```text
Grounding 무료 구간
≈ $0.08 / Debate

Grounding 유료 구간
≈ $1.13 / Debate
```

단, 현재 Fact Checker가 Turn 단위 Batch라는 점과 비용표의 Grounding 30회 가정이 일치하는지 반드시 다시 확인해야 한다.
