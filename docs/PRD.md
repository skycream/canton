# CAP: Canton Agent Protocol
## Product Requirements Document v0.1

---

## 1. Executive Summary

**CAP (Canton Agent Protocol)** 은 AI 에이전트 간 경제 활동(결제, 계약, 평판)을 **프라이빗하게** 처리하는 프로토콜이다. Canton Network의 sub-transaction privacy 위에서 동작하며, 에이전트의 가격 전략, 고객 목록, 거래 내역을 경쟁 에이전트로부터 보호한다.

### Problem

AI 에이전트 경제가 폭발적으로 성장하고 있다 (x402: 1,500만+ tx, Nevermined: 30일 만에 100만 tx). 하지만 기존 프로토콜은 모두 퍼블릭 체인 또는 중앙화 인프라 위에서 동작한다:

| 프로토콜 | 결제 | 프라이버시 | SLA 강제 | 분쟁 해결 |
|---------|------|-----------|---------|----------|
| x402 (Coinbase) | USDC on Base/Solana | 퍼블릭 | 없음 | 없음 |
| AP2 (Google) | 카드/스테이블코인 | 중앙화 | 없음 | 카드사 의존 |
| ACP (Stripe/OpenAI) | Stripe 결제 | 중앙화 | 없음 | Stripe 의존 |
| ERC-8004 | ETH 메인넷 | 퍼블릭 | 없음 | 없음 |
| Fetch.ai | FET/USDC | 퍼블릭 | 없음 | 없음 |

**결과**: 에이전트 A가 에이전트 B를 고용하면, 경쟁 에이전트 C가 이 사실을 알 수 있다. A의 사용 패턴, B의 가격표, 거래 빈도가 모두 노출된다.

### Solution

Canton Network의 sub-transaction privacy를 활용해 **에이전트 간 거래를 당사자만 볼 수 있는** 프로토콜을 구축한다.

```
경쟁 에이전트 C의 시점:
  x402/Base:    A→B 500원, A→B 300원, A→D 1000원 (전부 보임)
  CAP/Canton:   [아무것도 안 보임]
```

---

## 2. Market Context

### 2.1 시장 규모

- AI 에이전트 시장: 2025년 $7.8B → 2028년 $51.2B (예상 CAGR 87%)
- 에이전트 결제 트랜잭션: 2025년 하반기부터 급성장 (x402만 1,500만+)
- Canton Network: $6T+ 토큰화 자산, USDCx 실가동, 기관 참여자 다수

### 2.2 경쟁 분석

**직접 경쟁 없음.** 프라이빗 에이전트 경제 프로토콜은 현재 존재하지 않는다.

간접 경쟁자:
- **x402**: 가장 큰 에이전트 결제 프로토콜이지만 프라이버시 없음. CAP과 **보완 관계** (x402 for public, CAP for private).
- **Fetch.ai**: 에이전트 마켓플레이스이지만 모든 거래가 퍼블릭.
- **Nevermined**: x402 위에서 구독/크레딧 모델 제공하지만 역시 퍼블릭.

### 2.3 타겟 사용자

**Phase 1**: AI 에이전트 개발자 (LangChain, CrewAI, AutoGen 사용자)
**Phase 2**: 기업 AI 인프라 팀 (내부 에이전트 간 비용 정산)
**Phase 3**: 에이전트 서비스 제공업체 (API 제공자, 모델 호스팅 업체)

---

## 3. Product Vision

### 3.1 One-liner

> "The private economic layer for AI agents."

### 3.2 핵심 가치 제안

1. **Privacy by Default**: 에이전트 간 거래가 당사자만 볼 수 있음
2. **Atomic Escrow**: 작업 완료 시에만 결제 (스마트 컨트랙트 강제)
3. **Enforceable SLA**: 서비스 품질 조건을 Daml 컨트랙트로 정의 및 강제
4. **Portable Reputation**: 거래 상세를 공개하지 않으면서 신뢰도 증명

### 3.3 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    CAP Protocol Stack                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ Identity  │  │ Discovery│  │ Escrow   │  │ Reputa-│ │
│  │ Layer     │  │ Layer    │  │ Layer    │  │ tion   │ │
│  │          │  │          │  │          │  │ Layer  │ │
│  │ Agent    │  │ Service  │  │ Atomic   │  │ Score  │ │
│  │ Registry │  │ Catalog  │  │ Payment  │  │ w/o    │ │
│  │ + Auth   │  │ + Match  │  │ + SLA    │  │ Detail │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                  Daml Smart Contracts                    │
├─────────────────────────────────────────────────────────┤
│             Canton Network (Sub-tx Privacy)              │
├─────────────────────────────────────────────────────────┤
│           USDCx / Canton Coin (Settlement)               │
└─────────────────────────────────────────────────────────┘

┌─────────────┐         ┌─────────────┐
│ Agent A     │         │ Agent B     │
│ (Consumer)  │         │ (Provider)  │
│             │◄───────►│             │
│ Python SDK  │   CAP   │ Python SDK  │
│ or TS SDK   │Protocol │ or TS SDK   │
└─────────────┘         └─────────────┘
```

---

## 4. Functional Requirements

### 4.1 Agent Identity & Registration

**FR-1**: 에이전트는 Canton에 고유 ID로 등록할 수 있어야 한다.

```
AgentProfile:
  agentId:       Party          -- Canton party ID
  name:          Text           -- 에이전트 이름
  description:   Text           -- 기능 설명
  capabilities:  [Text]         -- 제공 가능한 서비스 태그 ["translation", "summarization", "image-gen"]
  endpoint:      Text           -- HTTP callback URL
  priceModel:    PriceModel     -- 가격 모델 (per-call, per-token, subscription)
  status:        AgentStatus    -- Active | Inactive | Suspended
```

**FR-2**: 에이전트 프로필은 등록자 본인만 수정할 수 있어야 한다.
**FR-3**: Discovery Layer에 공개할 정보(capabilities, name)와 비공개 정보(priceModel, endpoint)를 분리해야 한다.

### 4.2 Service Discovery

**FR-4**: 에이전트는 capability 태그로 다른 에이전트를 검색할 수 있어야 한다.

```
ServiceListing:
  provider:      Party          -- 서비스 제공 에이전트
  capability:    Text           -- "translation"
  description:   Text           -- "EN→KO translation, 99% accuracy"
  minPrice:      Decimal        -- 최소 가격 (공개 가능)
  maxLatency:    Int            -- 최대 응답 시간 (ms)
  isPublic:      Bool           -- Discovery에 노출 여부
```

**FR-5**: 비공개 리스팅은 초대(invite)를 통해서만 접근 가능해야 한다.
**FR-6**: 검색 결과에서 다른 에이전트의 거래 이력은 보이지 않아야 한다.

### 4.3 Negotiation & Agreement

**FR-7**: Consumer 에이전트가 Provider에게 서비스를 요청(Request)할 수 있어야 한다.

```
ServiceRequest:
  consumer:      Party
  provider:      Party
  capability:    Text           -- 요청 서비스
  params:        Text           -- JSON-encoded 파라미터
  maxPrice:      Decimal        -- 지불 가능 최대 금액
  deadline:      Time           -- 응답 기한
  slaTerms:      SLATerms       -- 품질 요구사항
```

**FR-8**: Provider는 Offer로 응답할 수 있어야 한다 (가격, 예상 시간, SLA 약속).

```
ServiceOffer:
  request:       ContractId ServiceRequest
  price:         Decimal        -- 확정 가격
  estimatedTime: Int            -- 예상 소요 시간 (ms)
  slaGuarantee:  SLATerms       -- SLA 보장
```

**FR-9**: Consumer가 Offer를 Accept하면 Escrow 컨트랙트가 생성되어야 한다.
**FR-10**: Consumer는 Offer를 Reject할 수 있어야 한다.
**FR-11**: Provider는 Request를 Decline할 수 있어야 한다.

### 4.4 Escrow & Settlement

**FR-12**: Accept 시 Consumer의 자금이 Escrow 컨트랙트에 잠겨야 한다.

```
Escrow:
  consumer:      Party
  provider:      Party
  amount:        Decimal        -- 잠긴 금액
  serviceRef:    ContractId ServiceOffer
  deadline:      Time           -- 작업 완료 기한
  slaTerms:      SLATerms       -- 합의된 SLA
  status:        EscrowStatus   -- Locked | Released | Disputed | Expired
```

**FR-13**: Provider가 결과물을 제출(Deliver)하면 Consumer가 검증 후 Release할 수 있어야 한다.
**FR-14**: Deadline 초과 시 Consumer가 Escrow를 자동 회수(Reclaim)할 수 있어야 한다.
**FR-15**: 분쟁(Dispute) 시 양측이 증거를 제출하고, 제3자 Arbitrator가 판결할 수 있어야 한다.
**FR-16**: 모든 결제는 Canton Coin 또는 USDCx로 이루어져야 한다.

### 4.5 Delivery & Verification

**FR-17**: Provider는 결과물을 Escrow에 첨부(Deliver)할 수 있어야 한다.

```
Delivery:
  escrow:        ContractId Escrow
  resultHash:    Text           -- 결과물 해시 (off-chain 데이터 참조)
  resultUrl:     Text           -- 결과물 접근 URL
  metadata:      Text           -- 추가 메타데이터
```

**FR-18**: Consumer는 결과물을 확인 후 Accept(Release) 또는 Dispute를 발행할 수 있어야 한다.
**FR-19**: Consumer가 일정 시간 내 응답하지 않으면 자동으로 Release되어야 한다 (auto-settle).

### 4.6 Reputation

**FR-20**: 거래 완료 시 양측이 상대방을 평가할 수 있어야 한다 (1-5 점).
**FR-21**: 평가 점수는 집계(aggregate)만 공개되고, 개별 거래 평가는 비공개여야 한다.

```
ReputationScore:
  agent:         Party
  totalDeals:    Int            -- 총 거래 수
  avgRating:     Decimal        -- 평균 점수
  successRate:   Decimal        -- 성공적 완료 비율
  -- 누가 몇 점을 줬는지는 보이지 않음
```

**FR-22**: Reputation은 Canton의 privacy model을 활용해, 각 평가자의 identity가 다른 평가자에게 노출되지 않아야 한다.

### 4.7 SLA (Service Level Agreement)

**FR-23**: SLA 조건을 Daml 컨트랙트에 명시할 수 있어야 한다.

```
SLATerms:
  maxLatency:    Optional Int    -- 최대 응답 시간 (ms)
  minAccuracy:   Optional Decimal -- 최소 정확도 (0.0-1.0)
  maxRetries:    Optional Int    -- 최대 재시도 횟수
  penalty:       Optional Decimal -- SLA 위반 시 페널티 비율
```

**FR-24**: SLA 위반 시 Escrow에서 자동으로 페널티가 차감되어야 한다.

---

## 5. Non-Functional Requirements

### 5.1 Performance
- **NFR-1**: 서비스 요청~오퍼 응답 지연: < 2초 (Canton 원장 커밋 포함)
- **NFR-2**: Escrow 생성~정산 지연: < 5초
- **NFR-3**: 동시 활성 Escrow 지원: 10,000+

### 5.2 Security
- **NFR-4**: 모든 에이전트 인증은 Canton Party + JWT 기반
- **NFR-5**: Off-chain 결과물은 해시로 무결성 검증
- **NFR-6**: Escrow 자금은 양측 합의 또는 Arbitrator 판결 없이 인출 불가

### 5.3 Privacy
- **NFR-7**: 거래 당사자가 아닌 에이전트는 거래 존재 자체를 알 수 없어야 함
- **NFR-8**: Discovery Layer에서 에이전트의 거래량/매출은 노출 불가
- **NFR-9**: Reputation 집계 시 개별 평가 내용/평가자 비공개

### 5.4 Interoperability
- **NFR-10**: Python SDK 제공 (LangChain/CrewAI 에이전트 연동)
- **NFR-11**: TypeScript SDK 제공 (Node.js 에이전트 연동)
- **NFR-12**: REST API 제공 (언어 무관 에이전트 연동)
- **NFR-13**: x402 호환 모드 지원 (HTTP 402 응답 형식 호환)

---

## 6. Technical Architecture

### 6.1 Daml Contract Layer

```
daml/
├── Agent.daml              -- AgentProfile, ServiceListing
├── Service.daml            -- ServiceRequest, ServiceOffer
├── Escrow.daml             -- Escrow, Delivery, Dispute
├── Reputation.daml         -- Rating, ReputationScore
├── Token.daml              -- Payment token interface (Canton Coin / USDCx)
└── Setup.daml              -- Init script for development
```

### 6.2 API Gateway

Canton JSON API 위에 프로토콜 전용 REST API를 구축한다:

```
POST   /cap/v1/agents                  -- 에이전트 등록
GET    /cap/v1/agents?capability=X     -- 에이전트 검색
POST   /cap/v1/requests                -- 서비스 요청
POST   /cap/v1/offers                  -- 오퍼 생성
POST   /cap/v1/escrows/:id/accept      -- 오퍼 수락 (Escrow 생성)
POST   /cap/v1/escrows/:id/deliver     -- 결과물 제출
POST   /cap/v1/escrows/:id/release     -- 결제 해제
POST   /cap/v1/escrows/:id/dispute     -- 분쟁 제기
GET    /cap/v1/reputation/:agentId     -- 평판 조회
```

### 6.3 SDK Architecture

```
sdk/
├── python/
│   └── cap/
│       ├── client.py          -- CAPClient (consumer용)
│       ├── provider.py        -- CAPProvider (provider용)
│       ├── models.py          -- Pydantic 모델
│       └── langchain.py       -- LangChain tool integration
├── typescript/
│   └── src/
│       ├── client.ts          -- CAPClient
│       ├── provider.ts        -- CAPProvider
│       └── types.ts           -- TypeScript 타입
└── examples/
    ├── translator-agent/      -- 번역 에이전트 (Provider)
    ├── researcher-agent/      -- 리서치 에이전트 (Consumer)
    └── multi-agent-workflow/  -- 3+ 에이전트 체인
```

### 6.4 System Diagram

```
┌─ Agent A (Consumer) ─────────┐     ┌─ Agent B (Provider) ─────────┐
│                               │     │                               │
│  LangChain Agent              │     │  FastAPI Service              │
│  + CAP Python SDK             │     │  + CAP Python SDK             │
│                               │     │                               │
│  cap.find("translation")      │     │  @cap.provide("translation")  │
│  cap.request(agent_b, params) │     │  def translate(text): ...     │
│  # auto: escrow → deliver →   │     │  # auto: receive → execute →  │
│  #       verify → release     │     │  #       deliver → get paid   │
│                               │     │                               │
└───────────┬───────────────────┘     └───────────┬───────────────────┘
            │                                     │
            │         CAP REST API                │
            └──────────┬──────────────────────────┘
                       │
            ┌──────────▼──────────┐
            │   CAP API Gateway   │
            │   (Node.js/Express) │
            └──────────┬──────────┘
                       │
            ┌──────────▼──────────┐
            │  Canton JSON API    │
            │  (Ledger API)       │
            └──────────┬──────────┘
                       │
            ┌──────────▼──────────┐
            │  Canton Network     │
            │  (Daml Contracts)   │
            │  Sub-tx Privacy     │
            └─────────────────────┘
```

---

## 7. User Stories & Scenarios

### Scenario 1: 기본 에이전트간 거래

```
1. Agent A (리서치 에이전트)가 보고서를 한국어로 번역해야 함
2. A가 CAP Discovery에서 "translation" capability 검색
3. Agent B (번역 에이전트)를 발견, 프로필 확인
4. A가 B에게 ServiceRequest 전송 (텍스트, 최대 가격, 기한)
5. B가 ServiceOffer 응답 (가격: 0.05 USDC, 예상시간: 3초)
6. A가 Accept → Escrow 생성 (0.05 USDC 잠김)
7. B가 번역 수행 → Delivery 제출 (번역 결과 해시 + URL)
8. A가 결과 검증 → Release (B에게 0.05 USDC 지급)
9. 양측 평가 (A→B: 5점, B→A: 5점)
10. Agent C (경쟁 번역 에이전트)는 이 거래를 전혀 알 수 없음
```

### Scenario 2: SLA 위반

```
1. Agent A가 Agent B에게 이미지 생성 요청 (SLA: 5초 이내)
2. Escrow 생성 (1.00 USDC, penalty: 50%)
3. B가 10초 후 Delivery 제출 (SLA 위반)
4. A가 SLA 위반으로 Dispute 제기
5. 컨트랙트가 자동으로 penalty 적용: B에게 0.50 USDC만 지급, 0.50 USDC A에게 반환
```

### Scenario 3: 멀티 에이전트 워크플로우

```
1. Agent A (오케스트레이터)가 복잡한 작업을 분할
2. A → B: 데이터 수집 (Escrow 1)
3. A → C: 데이터 분석 (Escrow 2, Escrow 1 완료 후 시작)
4. A → D: 보고서 작성 (Escrow 3, Escrow 2 완료 후 시작)
5. 각 에이전트는 자기 거래만 볼 수 있음
6. B는 C, D의 존재를 모름. C는 B, D의 가격을 모름.
```

---

## 8. Development Roadmap

### Phase 1: Core Protocol (2주)

**목표**: Daml 컨트랙트 + API + 2개 에이전트 데모

| 태스크 | 설명 | 일수 |
|--------|------|------|
| Daml 컨트랙트 작성 | Agent, Service, Escrow, Reputation templates | 3 |
| Canton Sandbox 테스트 | Daml Script로 시나리오 검증 | 1 |
| CAP API Gateway | Express.js REST API (Canton JSON API 래핑) | 3 |
| Python SDK (기본) | CAPClient, CAPProvider 클래스 | 2 |
| 데모 에이전트 2개 | 번역 에이전트 + 리서치 에이전트 | 2 |
| E2E 테스트 | 전체 플로우 자동 테스트 | 1 |

**Phase 1 산출물**:
- 동작하는 Daml 컨트랙트 (Sandbox)
- REST API 서버
- Python SDK
- 2개 에이전트가 CAP 위에서 실제 거래하는 데모 영상

### Phase 2: SDK & Dashboard (2주)

**목표**: 개발자가 실제로 사용할 수 있는 수준의 SDK + 모니터링

| 태스크 | 설명 | 일수 |
|--------|------|------|
| TypeScript SDK | Node.js 에이전트용 SDK | 3 |
| LangChain Integration | LangChain Tool로 CAP 연동 | 2 |
| Dashboard UI | 에이전트 등록, 거래 현황, 평판 대시보드 (React) | 3 |
| Dispute Resolution | 분쟁 처리 워크플로우 구현 | 2 |
| Documentation | API 문서, SDK 가이드, 튜토리얼 | 2 |

### Phase 3: Production & Ecosystem (4주)

**목표**: DevNet 배포 + 외부 에이전트 온보딩

| 태스크 | 설명 | 일수 |
|--------|------|------|
| DevNet 배포 | Canton Global Synchronizer 연결 | 3 |
| USDCx 연동 | 실제 스테이블코인 결제 | 5 |
| x402 호환 | HTTP 402 응답 형식 지원 | 3 |
| 보안 감사 | 컨트랙트 + API 보안 검토 | 3 |
| 에이전트 온보딩 | 외부 에이전트 3-5개 연동 | 5 |
| 성능 최적화 | 대량 트랜잭션 처리 최적화 | 3 |

---

## 9. Success Metrics

### Phase 1 (MVP)
- [ ] 2개 에이전트가 Canton에서 거래 완료
- [ ] 거래 프라이버시 검증 (제3자 에이전트가 거래 내용을 못 봄)
- [ ] E2E 테스트 통과

### Phase 2 (Developer Preview)
- [ ] SDK로 5분 내에 에이전트를 CAP에 연동 가능
- [ ] LangChain 에이전트가 CAP 통해 다른 에이전트 호출 성공
- [ ] Dashboard에서 거래 현황 실시간 모니터링

### Phase 3 (Production)
- [ ] DevNet에서 100+ 거래 처리
- [ ] 외부 에이전트 3개 이상 연동
- [ ] USDCx 실결제 완료

---

## 10. Risks & Mitigations

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Canton DevNet 접근 제한 | Phase 3 지연 | Phase 1-2는 Sandbox에서 완전 동작. SV 스폰서 조기 컨택 |
| USDCx 사용 제한 | 실결제 불가 | Canton Coin으로 대체. USDCx는 Phase 3에서 |
| 에이전트 개발자 채택 부족 | 생태계 성장 지연 | 킬러 데모 + 5분 연동 튜토리얼로 진입 장벽 최소화 |
| 에이전트 경제 시장 미성숙 | 수요 부족 | x402/AP2가 시장 교육 중. 기관 시장은 프라이버시 필요 시 CAP이 유일한 선택지 |
| Daml 개발자 부족 | 채용/협업 어려움 | SDK로 Daml 추상화 → 에이전트 개발자는 Python/TS만 사용 |

---

## 11. Revenue Model

### Phase 1-2: 오픈소스 + 무료
- 프로토콜, 컨트랙트, SDK 전부 오픈소스
- 커뮤니티 + 개발자 채택 우선

### Phase 3+: 수익화
| 수익원 | 모델 | 예상 |
|--------|------|------|
| API Gateway 호스팅 | 무료 1,000 tx/월, 이후 $0.001/tx | x402 Facilitator 모델 참고 |
| Premium SLA | 고가용성, 빠른 정산 | $99-999/월 |
| Enterprise 라이선스 | 온프레미스 배포, 커스텀 연동 | 협의 |
| Arbitration 수수료 | 분쟁 해결 시 분쟁 금액의 5% | 거래 증가에 비례 |

---

## 12. Competitive Moat

1. **Canton Network Effect**: Canton에 이미 $6T+ 자산이 있고 기관들이 참여 중. CAP은 이 네트워크 위에서 동작
2. **Privacy는 복제 불가**: 퍼블릭 체인에서 sub-transaction privacy를 구현하는 것은 구조적으로 불가능
3. **Protocol Lock-in**: 에이전트들이 CAP에서 reputation을 쌓으면, 다른 프로토콜로 이동 비용 발생
4. **x402 보완**: 경쟁이 아니라 보완 관계. "public은 x402, private은 CAP"

---

## Appendix A: Naming

- **CAP**: Canton Agent Protocol
- **프로젝트명**: `canton-agent-protocol` (GitHub repo)
- **NPM 패키지**: `@cap-protocol/sdk`
- **PyPI 패키지**: `cap-protocol`

## Appendix B: References

- [x402 Protocol](https://www.x402.org/)
- [Google AP2](https://ap2-protocol.org/specification/)
- [Stripe ACP](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol)
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)
- [Fetch.ai Agent Payments](https://fetch.ai/blog/world-s-first-ai-to-ai-payment-for-real-world-transactions)
- [Canton Network](https://www.canton.network/)
- [USDCx on Canton](https://www.canton.network/blog/usdcx-now-live-on-canton-unlocking-private-and-composable-usdc-backed-settlement)
- [AAIF / Linux Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
- [Daml Documentation](https://docs.daml.com/)
