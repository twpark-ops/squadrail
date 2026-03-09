# Squadrail UI 최적화 구현 가이드

## 개요

**목표**: 팀원들이 일하는 것이 **잘 보이고** **한눈에 알아보기 쉬운** 대시보드 구현

**핵심 원칙**:
1. 3초 안에 "Who's doing what" 파악
2. 실시간 agent activity 최상단 배치
3. 정보 과부하 방지
4. 명확한 시각적 계층

## 구현된 컴포넌트

### 1. DashboardOptimized.tsx
**위치**: `/home/taewoong/company-project/squadall/ui/src/pages/DashboardOptimized.tsx`

**개선사항**:
- Hero 섹션: 60px 타이틀 (기존 48px에서 증가)
- Live Agents 패널을 Protocol Queues 위로 이동
- 메트릭 카드 간격 확대 (gap-4 → gap-6)
- Protocol Queues를 2열 레이아웃으로 변경 (3열에서 개선)
- Recovery 섹션을 접을 수 있게 변경
- 차트는 제거하거나 하단으로 이동

**적용 방법**:
```tsx
// App.tsx에서 기존 Dashboard import를 교체
import { DashboardOptimized as Dashboard } from "./pages/DashboardOptimized";

// 또는 라우트에서 직접 교체
<Route path="dashboard" element={<DashboardOptimized />} />
```

### 2. AgentCardEnhanced.tsx
**위치**: `/home/taewoong/company-project/squadall/ui/src/components/AgentCardEnhanced.tsx`

**개선사항**:
- 48px 대형 아바타
- 현재 작업 중인 이슈 표시
- Active 상태일 때 gradient 헤더
- 더 명확한 상태 표시 (pulse animation)

**OrgChart.tsx에 통합**:
```tsx
// OrgChart.tsx의 card rendering 섹션 교체
import { AgentCardEnhanced } from "../components/AgentCardEnhanced";

// 기존:
<div className="agent-card">...</div>

// 개선:
<AgentCardEnhanced
  agent={agent}
  currentTask={currentTask}
  isActive={isActive}
  position={{ x: node.x, y: node.y }}
  width={CARD_W}
  height={CARD_H}
  onClick={() => navigate(`/agents/${agent.id}`)}
/>
```

### 3. IssueDetailLayout.tsx
**위치**: `/home/taewoong/company-project/squadall/ui/src/components/IssueDetailLayout.tsx`

**개선사항**:
- 명확한 3-column 구조 (25% - 50% - 25%)
- 모바일 반응형 (세로 스택)
- SectionCard 재사용 가능 컴포넌트
- PropertyRow 간결한 속성 표시

**IssueDetail.tsx에 통합**:
```tsx
import { IssueDetailLayout, SectionCard, PropertyRow } from "../components/IssueDetailLayout";

return (
  <IssueDetailLayout
    left={
      <>
        <SectionCard title="Brief">
          <BriefPanelV2 issue={issue} />
        </SectionCard>
        <SectionCard title="Related Issues">
          {/* 관련 이슈 목록 */}
        </SectionCard>
      </>
    }
    center={
      <>
        <SectionCard title="Description">
          <MarkdownBody content={issue.description} />
        </SectionCard>
        <SectionCard title="Protocol Timeline">
          <ActivityTimelineV2 events={protocolEvents} />
        </SectionCard>
        <SectionCard title="Comments">
          <CommentThread issueId={issue.id} />
        </SectionCard>
      </>
    }
    right={
      <>
        <SectionCard title="Properties">
          <PropertyRow label="Status" value={<StatusBadge status={issue.status} />} />
          <PropertyRow label="Priority" value={<PriorityIcon priority={issue.priority} />} />
          <PropertyRow label="Assignee" value={<Identity name={assignee.name} />} />
        </SectionCard>
        <SectionCard title="Quick Actions">
          {/* 버튼들 */}
        </SectionCard>
      </>
    }
  />
);
```

## 단계별 마이그레이션

### Phase 1: Dashboard 개선 (1-2시간)
```bash
# 1. DashboardOptimized를 테스트 라우트로 추가
# App.tsx
<Route path="dashboard-v2" element={<DashboardOptimized />} />

# 2. 브라우저에서 /dashboard-v2 접속하여 확인

# 3. 문제없으면 기존 Dashboard 교체
<Route path="dashboard" element={<DashboardOptimized />} />
```

### Phase 2: OrgChart 강화 (2-3시간)
```bash
# 1. AgentCardEnhanced import 추가
# OrgChart.tsx
import { AgentCardEnhanced } from "../components/AgentCardEnhanced";

# 2. 현재 작업 중인 이슈 정보를 가져오는 쿼리 추가
const { data: activeRuns } = useQuery({
  queryKey: queryKeys.liveRuns(selectedCompanyId!),
  queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
});

# 3. 기존 card div를 AgentCardEnhanced로 교체

# 4. 테스트 및 조정
```

### Phase 3: Issue Detail 간소화 (3-4시간)
```bash
# 1. IssueDetailLayout을 점진적으로 적용
# 먼저 한 섹션만 테스트

# 2. 전체 레이아웃 교체
# 기존 2,000+ 줄 파일을 구조화된 레이아웃으로 분리

# 3. 반응형 테스트 (모바일, 태블릿, 데스크톱)

# 4. 성능 확인 (React DevTools Profiler)
```

## 디자인 토큰 체크리스트

모든 새 컴포넌트는 다음을 따라야 합니다:

### Colors
- [ ] `bg-card` / `bg-background` / `bg-muted`
- [ ] `text-foreground` / `text-muted-foreground`
- [ ] `border-border`
- [ ] Status colors: `blue-500`, `red-500`, `emerald-500`, `yellow-500`

### Spacing
- [ ] Section gaps: `space-y-10` (40px)
- [ ] Card gaps: `gap-6` (24px)
- [ ] Padding: `p-6` (24px) or `p-4` (16px)
- [ ] Compact: `gap-3` (12px), `gap-2` (8px)

### Typography
- [ ] Hero: `text-5xl` or `text-6xl` (60px)
- [ ] Section: `text-2xl` (24px)
- [ ] Card title: `text-base` (16px)
- [ ] Body: `text-sm` (14px)
- [ ] Meta: `text-xs` (12px)

### Borders & Shadows
- [ ] `rounded-xl` (12px)
- [ ] `border` (1px)
- [ ] `shadow-card` / `shadow-card-hover`
- [ ] `card-hover` class for transitions

## 성능 최적화 체크리스트

### 필수
- [ ] React.memo() for expensive components
- [ ] useMemo() for expensive computations
- [ ] useCallback() for event handlers
- [ ] Lazy loading for charts (React.lazy)
- [ ] Virtualization for long lists (100+ items)

### 권장
- [ ] Debounce real-time updates (15s)
- [ ] Pagination for large datasets
- [ ] Image optimization (WebP, lazy load)
- [ ] Code splitting by route

## 접근성 체크리스트

### 필수 (WCAG 2.1 AA)
- [ ] Color contrast: 4.5:1 minimum
- [ ] Keyboard navigation: Tab, Enter, Escape
- [ ] Focus indicators: visible outline
- [ ] ARIA labels: buttons, icons, dynamic content
- [ ] Semantic HTML: header, nav, main, section, article

### 권장
- [ ] Screen reader testing (NVDA, JAWS)
- [ ] Reduced motion support (prefers-reduced-motion)
- [ ] Skip to main content link
- [ ] Heading hierarchy (h1 → h2 → h3)

## 테스트 체크리스트

### 브라우저
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)

### 디바이스
- [ ] Desktop: 1920x1080, 1440x900
- [ ] Tablet: 768x1024 (iPad)
- [ ] Mobile: 375x667 (iPhone SE), 390x844 (iPhone 14)

### 테마
- [ ] Light mode
- [ ] Dark mode
- [ ] High contrast mode

## 트러블슈팅

### Q: 대시보드가 너무 길어요
**A**: Recovery Section을 기본적으로 접힌 상태로 설정하거나, 차트를 별도 페이지(/analytics)로 이동하세요.

### Q: Agent 카드에 현재 작업이 안 보여요
**A**: WebSocket 연결을 확인하세요. `/api/companies/:id/events/ws` 엔드포인트가 작동하는지 체크.

### Q: 모바일에서 레이아웃이 깨져요
**A**: Tailwind의 `lg:` 접두사가 제대로 적용되었는지 확인. 기본은 세로 스택, lg 이상에서 3열.

### Q: 성능이 느려요
**A**:
1. React DevTools Profiler로 느린 컴포넌트 찾기
2. 불필요한 리렌더링 방지 (React.memo)
3. 긴 리스트는 가상화 (react-window)
4. 차트는 lazy load

## 다음 단계

### 우선순위 1 (즉시)
- [ ] DashboardOptimized 적용
- [ ] 모바일 반응형 테스트
- [ ] 접근성 감사 (Lighthouse)

### 우선순위 2 (1주 내)
- [ ] AgentCardEnhanced를 OrgChart에 통합
- [ ] IssueDetailLayout 적용
- [ ] 성능 프로파일링

### 우선순위 3 (2주 내)
- [ ] 디자인 시스템 문서 팀 공유
- [ ] Storybook 설정 (컴포넌트 카탈로그)
- [ ] E2E 테스트 추가 (Playwright)

## 참고 자료

- **Design System**: `/home/taewoong/company-project/squadall/ui/DESIGN_SYSTEM.md`
- **Tailwind Docs**: https://tailwindcss.com
- **shadcn/ui**: https://ui.shadcn.com
- **Radix UI**: https://www.radix-ui.com
- **Framer Motion**: https://www.framer.com/motion

## 지원

문제가 발생하면:
1. 디자인 시스템 문서 확인
2. 기존 컴포넌트 참고 (MetricCardV2, QueueCardV2)
3. TypeScript 타입 에러는 `@squadrail/shared` 타입 정의 확인

---

**작성일**: 2026-03-09
**버전**: 1.0.0
**작성자**: Claude Code (Frontend Architect)
