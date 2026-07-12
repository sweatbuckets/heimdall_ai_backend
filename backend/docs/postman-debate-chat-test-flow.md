# Postman Debate Chat Test Flow

이 문서는 Postman으로 `member -> debate -> Redis draft chat -> turn finalize -> Analyzer`
흐름을 테스트하기 위한 예시다.

## 전제

서버와 Docker 서비스가 실행 중이어야 한다.

```bash
docker compose up -d
npm run start:dev
```

기본 URL:

```text
HTTP http://localhost:3000
WS   ws://localhost:8080
```

Gemini quota 때문에 Fact Checker까지 돌리고 싶지 않으면 `.env`에 아래 값을 둔다.

```env
FACT_CHECK_ENABLED=false
```

이 경우 Analyzer는 실행되지만 Fact Checker BullMQ job은 등록되지 않는다.

## 테스트 논제

```text
고등학교에서 스마트폰 사용을 전면 금지해야 하는가
```

이 논제는 테스트에 적합하다.

- SIDE_A는 금지 찬성 입장이다.
- SIDE_B는 전면 금지 반대 입장이다.
- 양쪽 모두 Major Claim을 만들기 쉽다.
- 집중력, 사이버불링, 학습 도구, 긴급 연락 등 SUPPORTS/ATTACKS 관계가 잘 나온다.
- “OECD 조사”, “미국 학교”, “성적 향상” 같은 사실 검증 후보가 포함된다.

## 1. SIDE_A 멤버 생성

```http
POST http://localhost:3000/members
Content-Type: application/json
```

```json
{
  "displayName": "Alice",
  "profileImageUrl": null
}
```

응답의 `id`를 복사해서 이후 `SIDE_A_MEMBER_ID` 위치에 넣는다.

## 2. SIDE_B 멤버 생성

```http
POST http://localhost:3000/members
Content-Type: application/json
```

```json
{
  "displayName": "Bob",
  "profileImageUrl": null
}
```

응답의 `id`를 복사해서 이후 `SIDE_B_MEMBER_ID` 위치에 넣는다.

## 3. Debate 생성

```http
POST http://localhost:3000/debates
Content-Type: application/json
```

```json
{
  "topic": "고등학교에서 스마트폰 사용을 전면 금지해야 하는가",
  "sideASpeakerId": "SIDE_A_MEMBER_ID",
  "sideBSpeakerId": "SIDE_B_MEMBER_ID",
  "rebuttalQuestionRounds": 2
}
```

응답의 `id`를 복사해서 이후 `DEBATE_ID` 위치에 넣는다.

## 4. 초기 채팅 상태 확인

```http
GET http://localhost:3000/debates/DEBATE_ID/chat
```

기대:

```json
{
  "turns": [],
  "draftMessages": []
}
```

## 5. SIDE_A Opening Draft Message 1

```http
POST http://localhost:3000/debates/DEBATE_ID/chat/messages
Content-Type: application/json
```

```json
{
  "clientMessageId": "a-opening-1",
  "speakerId": "SIDE_A_MEMBER_ID",
  "speakerSide": "SIDE_A",
  "phase": "OPENING",
  "round": 1,
  "content": "저는 고등학교에서 스마트폰 사용을 전면 금지해야 한다고 봅니다. 스마트폰은 수업 중 집중력을 떨어뜨리고, 학생들이 교사의 설명보다 알림과 짧은 영상에 더 쉽게 반응하게 만듭니다."
}
```

## 6. SIDE_A Opening Draft Message 2

```http
POST http://localhost:3000/debates/DEBATE_ID/chat/messages
Content-Type: application/json
```

```json
{
  "clientMessageId": "a-opening-2",
  "speakerId": "SIDE_A_MEMBER_ID",
  "speakerSide": "SIDE_A",
  "phase": "OPENING",
  "round": 1,
  "content": "실제로 여러 학교가 휴대전화 제한 정책을 도입한 뒤 수업 방해와 사이버불링 신고가 줄었다는 보고가 있습니다. 학교는 학습 공간이므로, 긴급 연락은 교무실이나 보호자 연락 체계를 통해 처리하면 됩니다."
}
```

Analyzer 기대:

- Major Claim: 고등학교에서 스마트폰 사용을 전면 금지해야 한다.
- SUPPORTS 후보: 집중력 저하, 수업 방해 감소, 사이버불링 신고 감소, 대체 연락 체계
- Fact-check 후보: 휴대전화 제한 정책 도입 후 수업 방해/사이버불링 신고 감소

## 7. SIDE_A Draft 확인

```http
GET http://localhost:3000/debates/DEBATE_ID/chat
```

기대:

```text
turns: []
draftMessages: 2개
```

## 8. SIDE_A Turn Finalize

```http
POST http://localhost:3000/debates/DEBATE_ID/chat/finalize
Content-Type: application/json
```

```json
{
  "speakerId": "SIDE_A_MEMBER_ID",
  "speakerSide": "SIDE_A",
  "phase": "OPENING",
  "round": 1
}
```

기대:

```text
sequence: 1
analysisStatus: PENDING -> PROCESSING -> COMPLETED 또는 FAILED
Redis draft 삭제
Analyzer job enqueue
```

## 9. SIDE_B Opening Draft Message 1

```http
POST http://localhost:3000/debates/DEBATE_ID/chat/messages
Content-Type: application/json
```

```json
{
  "clientMessageId": "b-opening-1",
  "speakerId": "SIDE_B_MEMBER_ID",
  "speakerSide": "SIDE_B",
  "phase": "OPENING",
  "round": 1,
  "content": "저는 스마트폰 사용을 전면 금지하는 데 반대합니다. 문제는 스마트폰 자체가 아니라 사용 방식이며, 학교는 금지보다 책임 있는 사용 규칙을 가르쳐야 합니다."
}
```

## 10. SIDE_B Opening Draft Message 2

```http
POST http://localhost:3000/debates/DEBATE_ID/chat/messages
Content-Type: application/json
```

```json
{
  "clientMessageId": "b-opening-2",
  "speakerId": "SIDE_B_MEMBER_ID",
  "speakerSide": "SIDE_B",
  "phase": "OPENING",
  "round": 1,
  "content": "스마트폰은 번역, 일정 관리, 자료 검색, 긴급 연락 같은 학습과 안전 기능도 제공합니다. 전면 금지는 이런 장점을 모두 없애며, 오히려 학생들이 몰래 사용하는 문제를 만들 수 있습니다."
}
```

Analyzer 기대:

- Major Claim: 스마트폰 전면 금지에 반대한다.
- ATTACKS 후보: SIDE_A의 전면 금지 주장에 대한 반박
- SUPPORTS 후보: 책임 있는 사용 규칙, 학습 도구, 안전 기능, 몰래 사용 문제
- Fact-check 후보: 스마트폰의 학습/안전 기능 자체는 일반적으로 검증보다 분류 기준상 낮음

## 11. SIDE_B Turn Finalize

```http
POST http://localhost:3000/debates/DEBATE_ID/chat/finalize
Content-Type: application/json
```

```json
{
  "speakerId": "SIDE_B_MEMBER_ID",
  "speakerSide": "SIDE_B",
  "phase": "OPENING",
  "round": 1
}
```

기대:

```text
sequence: 2
Analyzer가 SIDE_A 기존 component를 EXISTING target으로 사용할 수 있음
```

## 12. 최종 확인

```http
GET http://localhost:3000/debates/DEBATE_ID
```

기대:

```text
turns: 2개
SIDE_A opening sequence 1
SIDE_B opening sequence 2
```

채팅 snapshot:

```http
GET http://localhost:3000/debates/DEBATE_ID/chat
```

기대:

```text
turns: 2개
draftMessages: []
```

## 13. DB에서 Analyzer 결과 확인

DataGrip 또는 SQL 클라이언트에서 확인한다.

```sql
SELECT id, speaker_side, phase, round, sequence, analysis_status, content
FROM debate_turn
WHERE debate_id = 'DEBATE_ID'
ORDER BY sequence;
```

```sql
SELECT ac.*
FROM argument_component ac
JOIN debate_turn dt ON dt.id = ac.turn_id
WHERE dt.debate_id = 'DEBATE_ID'
ORDER BY dt.sequence, ac.created_at;
```

```sql
SELECT ar.*
FROM argumental_relation ar
JOIN argument_component fc ON fc.id = ar.from_component_id
JOIN debate_turn dt ON dt.id = fc.turn_id
WHERE dt.debate_id = 'DEBATE_ID';
```

## 14. 실패 시 확인

Analyzer가 실패하면 서버 로그에서 다음 메시지를 확인한다.

```text
[AnalyzerProcessor] Analyze turn job failed. jobId=... turnId=...
```

이미 `FAILED` 된 turn은 자동 재분석되지 않는다. 테스트 중에는 새 debate로 다시
시도하는 것이 가장 단순하다.
