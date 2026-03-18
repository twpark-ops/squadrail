---
title: "Batch D Plugin And Extension Surface Plan"
author: "Taewoong Park (park.taewoong@airsmed.com)"
date: "2026-03-17"
---

# Batch D Plugin And Extension Surface Plan

상태: architecture-grade design draft  
범위: 장기 확장 surface 설계  
관련 상위 문서: [squadrail-product-overview-and-expansion-roadmap-2026-03-17.md](./squadrail-product-overview-and-expansion-roadmap-2026-03-17.md)

## 1. 목표

`Batch D`의 목적은 `Squadrail` core를 얇게 유지하면서 아래 확장 포인트를 안전하게 여는 것이다.

1. knowledge sync, preview deploy, report export, notifier 같은 기능을 **extension point**로 분리한다.
2. 회사별로 plugin을 enable/disable/configure 할 수 있게 만든다.
3. core delivery contract를 깨지 않으면서 외부 기능을 붙일 수 있게 한다.

즉 이 배치는 “무엇이든 붙일 수 있는 범용 플랫폼”이 아니라:

> 이미 있는 control plane 위에 검증된 확장 포인트를 여는 배치

다.

## 2. 왜 지금은 장기 우선순위인가

현재 `Squadrail`의 더 급한 문제는:

- parent issue progress
- issue documents / deliverables
- onboarding first success
- worktree/runtime clarity
- budget/command/collaboration

이다.

즉 plugin system은 **지금 당장 core보다 앞서면 안 된다.**

하지만 장기적으로는 아래 이유 때문에 설계는 미리 정리할 가치가 있다.

1. knowledge import와 notifier는 이미 extension-like 성격이 있다.
2. preview deploy / report export는 core에 넣기보다 plugin이 더 맞다.
3. 회사별로 필요한 integration이 다르다.

## 3. 현재 상태 (AS-IS)

현재 `Squadrail`에는 generic plugin runtime은 없다.

하지만 extension seed는 이미 존재한다.

### 3.1 integration-like surface

- adapter packages
- knowledge sync/import
- operating alerts webhook
- artifact export / merge automation
- company workflow templates

즉 “플러그인이라는 이름만 없지”, 이미 확장 포인트 후보는 많다.

### 3.2 reference

다른 운영 제품들에는 실제 plugin manager가 존재한다.

이 구현을 그대로 복제하지는 않되, 아래 아이디어는 가치가 높다.

- installed / enabled / error 상태
- example marketplace 개념
- enable / disable / uninstall

## 4. Batch D 설계 원칙

## 4.1 plugin은 core protocol을 바꾸지 않는다

plugin은:

- issue protocol state machine
- review/QA rules
- company isolation

을 마음대로 바꾸지 못한다.

V1 plugin은 **extension point 안에서만** 동작해야 한다.

## 4.2 extension point는 capability-based다

처음부터 범용 arbitrary hook을 만들지 않는다.

V1 capability:

- `knowledge_source`
- `artifact_exporter`
- `preview_deployer`
- `notifier`
- `command_contribution`

## 4.3 회사별 enablement가 기본이다

plugin은 instance 설치 여부와 별개로 회사별 enable/disable/config를 가진다.

## 4.4 안전성이 기본이다

V1에서 plugin은 아래 제약을 가진다.

- allowlisted package 또는 local built-in만
- explicit enablement
- budget / permission / audit trail 연동
- timeout / error isolation

## 5. 설계 범위

## 5.1 D1 — Plugin registry model

### 핵심 모델

```ts
interface PluginCatalogEntry {
  key: string;
  displayName: string;
  version: string;
  capabilities: PluginCapability[];
  origin: "builtin" | "local_package" | "registry";
  installStatus: "installed" | "not_installed" | "error";
}

interface CompanyPluginBinding {
  companyId: string;
  pluginKey: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
```

### V1 저장 전략

- instance-level installed plugin registry
- company-level binding/config

로 분리한다.

## 5.2 D2 — Capability-specific extension points

### knowledge source

새 knowledge import source를 등록한다.

예:

- workspace sync 외 external repo mirror
- ticket/export ingest
- docs sync

### artifact exporter

issue documents / deliverables를 외부로 export한다.

예:

- markdown bundle
- PDF report
- JSON manifest

### preview deployer

deliverable preview를 외부 환경에 올린다.

예:

- static preview
- report site
- temporary artifact URL

### notifier

상태 변화나 approval을 외부 채널로 보낸다.

예:

- Slack
- generic webhook
- email bridge

### command contribution

global command composer에 새 action을 추가한다.

예:

- `Export report`
- `Deploy preview`
- `Sync docs`

## 5.3 D3 — UI manager

V1 UI는 full marketplace보다 한 단계 낮은 수준이면 충분하다.

1. installed plugin list
2. capability badges
3. per-company enable/disable
4. config editor
5. last error / last run

위치는:

- instance settings
- company settings

둘로 나누는 것이 맞다.

## 5.4 D4 — Governance / security / observability

plugin은 아래를 반드시 남긴다.

- activity log
- cost attribution
- company scope
- timeout / failure reason

plugin failure는 core issue state를 직접 망가뜨리지 못하고, **side effect failure**로만 남아야 한다.

## 6. 구현 순서

1. `builtin-only plugin registry`
2. `company plugin binding + config`
3. `notifier / artifact exporter` capability 먼저
4. `command contribution`
5. `registry/local package install`

이 순서가 맞는 이유는:

- install/uninstall보다 먼저 enable/config/observability가 중요하기 때문이다.

## 7. 테스트 시나리오

### 단위 테스트

- plugin manifest validation
- capability routing
- company binding resolution

### 통합 테스트

- notifier plugin enable/disable
- exporter plugin execution and artifact trace
- plugin failure isolation

### 운영 테스트

- disabled plugin은 action surface에 노출되지 않는다
- 회사 A enable / 회사 B disable가 동시에 유지된다
- plugin error는 issue core protocol을 오염시키지 않는다

## 8. 완료 기준

1. core protocol 변경 없이 capability plugin이 동작한다.
2. 회사별 enable/disable/config가 가능하다.
3. plugin 실행 흔적이 activity/cost/issue surface에 남는다.
4. notifier/exporter 정도의 first-party plugin 두 개를 올릴 수 있다.

## 9. 결론

`Batch D`는 지금 즉시 구현할 1순위는 아니다.  
하지만 장기적으로 `Squadrail`이 모든 integration을 core에 직접 넣지 않게 하려면 반드시 필요한 방향이다.

즉 plugin은:

- 지금 당장은 설계 우선
- core가 더 잠긴 뒤 실행

이 맞다.
