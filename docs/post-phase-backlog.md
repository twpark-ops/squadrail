# Post-Phase Backlog

작성일: 2026-03-10

## 목적

Phase 0~4와 real-org E2E로 `agent가 실제로 끝까지 일하는 delivery runtime`은 검증됐다.

다음 backlog의 목적은 두 가지다.

1. 사용자가 숨김 worktree를 직접 뒤지지 않고도 변경 결과를 검토하고 반영하게 만든다.
2. 현재 usable한 RAG를 실측 기반으로 개선한다.

## 지금 먼저 할 것

### P0. Visual Rebuild

목표: `Paperclip` 흔적이 남은 기존 콘솔 스타일을 버리고, 반자율 개발 조직에 맞는 새 제품 시각언어를 만든다.

진행 상태:

- 완료: visual direction, shell/rail/sidebar/top-bar redesign spec
- 진행 중: global tokens, company rail, sidebar, top shell, knowledge shell tone 정리
- 다음 slice: Overview / Work / Changes 실화면 visual rebuild

산출물:

- 브랜드 마크/로고타입 방향
- 색 체계와 상태 색 재정의
- 타이포그래피 규칙
- shell 레이아웃
- Overview / Work / Changes / Runs / Knowledge 핵심 화면 패턴

참고:

- [ui-visual-rebuild-spec-v1.md](/home/taewoong/company-project/squadall/docs/ui-visual-rebuild-spec-v1.md)
- [ui-visual-rebuild-spec-v1.puml](/home/taewoong/company-project/squadall/docs/ui-visual-rebuild-spec-v1.puml)

### P0. UI Rebuild Spec

목표: Paperclip control-plane UI를 탈피할 새 제품 정보 구조를 고정한다.

산출물:

- top-level IA
- 핵심 화면 정의
- route migration 방향
- Work / Changes / Runs / Knowledge 중심 구조

참고:

- [ui-rebuild-spec-v1.md](/home/taewoong/company-project/squadall/docs/ui-rebuild-spec-v1.md)
- [ui-rebuild-spec-v1.puml](/home/taewoong/company-project/squadall/docs/ui-rebuild-spec-v1.puml)

### P0. Change Tracking Surface

목표: issue 화면에서 바로 `무슨 코드가 어디서 어떻게 바뀌었는지` 확인 가능하게 만든다.

범위:

- issue detail에 git execution card 추가
- 노출 항목
  - implementation workspace path
  - branch name
  - head sha
  - changed files
  - diff stat
  - recent verification summary
  - latest `diff`, `test_run`, `build_run`, `approval` artifact
- read-only diff preview
- `Open Worktree`, `Copy Branch`, `Copy Workspace Path` 액션

이유:

- 지금 실제 수정은 `.squadrail-worktrees/...`에서 일어난다.
- 원본 repo는 clean 상태라 사용자가 VS Code에서 기본 repo만 열면 변경이 안 보인다.
- 현재 artifact는 DB에 있지만 제품 표면이 부족하다.

완료 기준:

- 사용자가 issue detail만 보고도 변경 파일, 검증 결과, branch/worktree를 파악한다.
- hidden worktree 경로를 직접 찾지 않아도 된다.

### P0. Merge Candidate Flow

목표: `pending_external_merge`에서 멈춘 delivery를 실제 반영 단계까지 자연스럽게 연결한다.

범위:

- issue close 후 merge candidate card 추가
- 노출 항목
  - source branch
  - target repo/workspace
  - target base branch
  - diff stat
  - approval summary
  - rollback note
- 1차는 read-only + operator actions
  - `Open Worktree`
  - `Copy Cherry-pick/merge instructions`
  - `Mark merged`
  - `Mark rejected`
- 2차 후보
  - PR export
  - branch push
  - merge automation

완료 기준:

- operator가 issue 종료 후 "이 변경을 어떻게 반영하지?"에서 멈추지 않는다.

## 그 다음 할 것

### P1. Nightly Real-Org E2E

목표: 지금 성공한 `cloud-swiftsight` 조직 루프가 계속 유지되는지 자동으로 감시한다.

범위:

- 대표 시나리오 3개 nightly 실행
- 실패 시 recovery queue 또는 알림에 노출
- 결과 요약 저장

완료 기준:

- 조직 루프 회귀가 하루 단위로 감지된다.

### P1. Prompt Quality Tightening

목표: 역할은 맞게 움직이되 표현 품질이 들쭉날쭉한 부분을 정리한다.

범위:

- PM reassignment rationale 정제
- TL review/close wording 정제
- QA evidence/approval summary 품질 가이드 강화

완료 기준:

- protocol summary가 운영 로그로 읽기 좋은 수준으로 안정화된다.

## RAG 관련 backlog

### P2. RAG Quality Instrumentation

목표: 감으로 RAG를 바꾸지 않고, 실제 swiftsight 데이터로 retrieval 품질을 측정한다.

수집 항목:

- brief confidence
- degraded reason 분포
- retrieval hit count
- source diversity
- wrong-project / wrong-file selection
- review 단계에서 근거 부족으로 되돌아간 비율

완료 기준:

- 각 프로젝트와 역할별 retrieval 품질을 숫자로 설명할 수 있다.

### P2. Cross-Project Retrieval Improvement

목표: CTO/PM/TL이 cross-project 이슈를 던질 때 관련 프로젝트를 더 정확히 찾게 만든다.

범위:

- project affinity scoring
- cross-project path/symbol weighting
- multi-project brief context shaping

완료 기준:

- cross-project 이슈에서 irrelevant file selection 비율이 내려간다.

### P3. Deep RAG Hardening

범위:

- version-aware retrieval
- symbol/dependency graph traversal
- retrieval cache / incremental reindex
- role-specific retrieval personalization

판정:

- 이 단계는 instrumentation 이후 실제 병목이 보일 때 들어간다.

## `.paperclip`에서 가져온 참고점

`.paperclip` 전체를 가져올 필요는 없다. 아래 두 축만 흡수하면 된다.

1. `issue/project/agent` 단위의 git visibility 아이디어
   - 참고: `.paperclip/doc/plugins/ideas-from-opencode.md`
   - 채택 포인트:
     - issue/project/agent에 git tab 또는 git card 제공
     - branch/worktree/dirty state/diff/commits를 한 곳에서 보여주기

2. release worktree lifecycle 규칙
   - 참고: `.paperclip/scripts/release-start.sh`, `.paperclip/scripts/release-lib.sh`
   - 채택 포인트:
     - branch에 연결된 worktree 재사용
     - 경로 충돌 방지
     - clean worktree 요구 조건
     - operator가 branch/worktree를 이해할 수 있게 노출

반대로 `issue execution lock` 쪽은 이미 현재 `squadall` 구현에 흡수돼 있다.

## 권장 순서

1. P0 UI Rebuild Spec
2. P0 Change Tracking Surface
3. P0 Merge Candidate Flow
4. P1 Nightly Real-Org E2E
5. P2 RAG Quality Instrumentation
6. P2 Cross-Project Retrieval Improvement
7. P3 Deep RAG Hardening

## 결론

다음 우선순위는 `RAG 대공사`가 아니다.

먼저 사용자가 실제 변경을 자연스럽게 검토하고 반영할 수 있게 만들고, 그 다음 실측 기반으로 RAG를 올리는 것이 맞다.
