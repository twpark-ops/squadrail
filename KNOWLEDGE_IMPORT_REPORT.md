# Knowledge Import 보고서

**날짜**: 2026-03-09
**프로젝트**: squadall (cloud-swiftsight organization)

## 실행 요약

작업을 시작했으나, **지식 베이스 import가 0건**으로 완료되었습니다. 인프라는 모두 준비되었지만, 실제 문서 import는 발생하지 않았습니다.

## 완료된 작업

### 1. ✅ pgvector Extension 설치

- **PostgreSQL 버전**: 17-alpine (Docker 컨테이너)
- **pgvector 버전**: 0.7.0
- **설치 위치**: Docker 컨테이너 `squadall-db-1`
- **HNSW 인덱스**: 생성 완료 (`knowledge_chunks_embedding_vector_hnsw_idx`)

```sql
ALTER TABLE knowledge_chunks ADD COLUMN embedding_vector vector(1536);
CREATE INDEX knowledge_chunks_embedding_vector_hnsw_idx
  ON knowledge_chunks USING hnsw (embedding_vector vector_cosine_ops);
```

### 2. ✅ Company 및 Project 생성

**Company**:
- **ID**: `d50277b5-c351-41c9-93be-425975c5f3f5`
- **Name**: cloud-swiftsight
- **Issue Prefix**: CLO

**Projects** (P0 순서대로):

| #  | Project Name              | Project ID                             | Status |
|----|---------------------------|----------------------------------------|--------|
| 1  | swiftsight-cloud          | 171b484b-a062-48e0-9d15-0185188a3463   | ✅      |
| 2  | swiftsight-agent          | 37b2024b-a8d1-41d4-8ec2-0ea41f411fff   | ✅      |
| 3  | swiftcl                   | 032e0480-a666-405c-a072-e97ea2675904   | ✅      |
| 4  | swiftsight-report-server  | 1cda3cf9-4d25-48bf-84f6-f1952bbd9e4b   | ✅      |
| 5  | swiftsight-worker         | f52ca7d2-2141-445a-921c-0d9439656d6e   | ✅      |

### 3. ✅ Project Workspaces 생성

모든 프로젝트에 primary workspace가 생성되었습니다:

- **swiftsight-cloud**: `/home/taewoong/workspace/cloud-swiftsight/swiftsight-cloud`
- **swiftsight-agent**: `/home/taewoong/workspace/cloud-swiftsight/swiftsight-agent`
- **swiftcl**: `/home/taewoong/workspace/cloud-swiftsight/swiftcl`
- **swiftsight-report-server**: `/home/taewoong/workspace/cloud-swiftsight/swiftsight-report-server`
- **swiftsight-worker**: `/home/taewoong/workspace/cloud-swiftsight/swiftsight-worker`

### 4. ⚠️ Knowledge Import 실행 (0 documents, 0 chunks)

| Project                   | Documents | Chunks | Time  | Status |
|---------------------------|-----------|--------|-------|--------|
| swiftsight-cloud          | 0         | 0      | 32s   | ✅     |
| swiftsight-agent          | 0         | 0      | 21s   | ✅     |
| swiftcl                   | 0         | 0      | 35s   | ✅     |
| swiftsight-report-server  | 0         | 0      | 16s   | ✅     |
| swiftsight-worker         | 0         | 0      | 23s   | ✅     |

**총 처리 시간**: 127초 (2분 7초)

## 문제점

### 주요 이슈: Import가 0건

API 호출은 모두 201 (Created) 성공 응답을 받았지만, 실제로 문서가 import되지 않았습니다.

**가능한 원인**:

1. **파일 필터링 로직**: import 서비스가 특정 파일 패턴만 처리하도록 설정되어 있을 수 있음
2. **OPENAI_API_KEY 문제**: 환경변수는 설정되어 있으나, API 호출이 실패했을 가능성
3. **maxFiles 제한**: 기본값이 0 또는 매우 작은 값일 수 있음
4. **.gitignore 필터**: import 로직이 git-ignored 파일을 제외하고 있을 가능성
5. **워크스페이스 경로 불일치**: API에 전달된 workspace 경로가 실제 파일 위치와 다를 수 있음

## 환경 정보

- **Server**: http://127.0.0.1:3101 (embedded PostgreSQL, 포트 54329)
- **OPENAI_API_KEY**: 설정됨 (길이: 164자)
- **Deployment Mode**: local_trusted
- **데이터베이스**: embedded PostgreSQL (깨끗하게 재초기화됨)

## Retrieval Policies

**현재 상태**: 0개

Retrieval policies가 생성되지 않았습니다. 이는 bootstrap 과정의 일부로 수동 생성이 필요할 수 있습니다.

**예상 구조** (RAG_INDEX_PLAN.md 기준):

- `tech_lead`: brief 생성, review 등
- `engineer`: implementation 작업
- `reviewer`: code review
- `cto`: 전사 overview

## 다음 단계 (권장)

### 1. Import 서비스 로직 확인

```bash
# Import 서비스 코드에서 파일 필터링 로직 확인
grep -n "scan.*files\|filter.*files\|maxFiles" \
  /home/taewoong/company-project/squadall/server/src/services/knowledge-import.ts
```

### 2. 서버 로그 상세 분석

```bash
# Import 관련 로그 확인
tail -200 /tmp/claude-1000/-home-taewoong-company-project/tasks/bkwdqbitg.output | \
  grep -i "scan\|import\|file\|document"
```

### 3. 데이터베이스 직접 확인

embedded PostgreSQL 연결 정보를 확인하고 직접 쿼리:

```sql
SELECT COUNT(*) FROM knowledge_documents;
SELECT COUNT(*) FROM knowledge_chunks;
SELECT COUNT(*) FROM project_workspaces;
```

### 4. Retrieval Policies 생성

필요한 retrieval policies를 API를 통해 생성.

## 파일 경로

- **보고서**: `/home/taewoong/company-project/squadall/KNOWLEDGE_IMPORT_REPORT.md`
- **Project IDs**: `/tmp/project_ids.json`
- **Server 로그**: `/tmp/claude-1000/-home-taewoong-company-project/tasks/bkwdqbitg.output`

## 결론

**인프라 설정은 완료**되었으나, 실제 지식 베이스 데이터가 import되지 않았습니다.

**Bootstrap 완료 항목**:
- ✅ pgvector extension 설치 및 HNSW 인덱스 생성
- ✅ Company 생성 (cloud-swiftsight)
- ✅ 5개 Projects 생성 (P0 순서)
- ✅ Project workspaces 생성 (모든 프로젝트)

**미완료 항목**:
- ❌ Knowledge documents import (0건)
- ❌ Knowledge chunks 생성 (0건)
- ❌ Retrieval policies 설정 (0건)

Import 서비스의 파일 스캔 로직, 필터링 설정, 또는 API 파라미터를 확인하고 조정해야 합니다.

---

**Generated**: 2026-03-09 16:54 KST
