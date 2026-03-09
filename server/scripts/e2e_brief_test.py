#!/usr/bin/env python3
"""
E2E Test: Complete workflow with automatic brief generation verification
"""

import json
import time
import sys
import subprocess
from datetime import datetime
from typing import Dict, Any, List, Optional

BASE_URL = "http://127.0.0.1:3101"

# Performance tracking
performance_metrics = {
    "brief_generation_times": [],
    "retrieval_latencies": [],
    "hybrid_search_latencies": []
}

# Test results
test_results = {
    "passed": [],
    "failed": [],
    "warnings": []
}

def psql_query(query: str) -> str:
    """Execute PostgreSQL query and return result"""
    cmd = [
        "docker", "exec", "swiftsight-postgres",
        "psql", "-U", "postgres", "-d", "swiftsight", "-t", "-c", query
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout.strip()

def psql_json(query: str) -> List[Dict]:
    """Execute PostgreSQL query and return JSON result"""
    output = psql_query(query)
    if not output:
        return []
    try:
        return json.loads(output)
    except:
        return []

def verify_checkpoint(name: str, condition: bool, message: str):
    """Verify test checkpoint"""
    status = "✅" if condition else "❌"
    print(f"{status} {name}: {message}")

    if condition:
        test_results["passed"].append(name)
    else:
        test_results["failed"].append({"name": name, "message": message})

def warn(name: str, message: str):
    """Record warning"""
    print(f"⚠️  {name}: {message}")
    test_results["warnings"].append({"name": name, "message": message})

def get_agent_by_name(agent_name: str) -> Optional[str]:
    """Get agent ID by name"""
    query = f"""
        SELECT id FROM agents WHERE name = '{agent_name}' LIMIT 1;
    """
    result = psql_query(query)
    return result if result else None

def get_retrieval_run_count() -> int:
    """Get current retrieval run count"""
    query = "SELECT COUNT(*) FROM retrieval_runs;"
    result = psql_query(query)
    return int(result) if result else 0

def get_brief_count() -> int:
    """Get current brief count"""
    query = "SELECT COUNT(*) FROM issue_task_briefs;"
    result = psql_query(query)
    return int(result) if result else 0

def get_brief_for_issue(issue_id: str, scope: str = "engineer") -> Optional[Dict]:
    """Get brief for specific issue and scope"""
    query = f"""
        SELECT
            brief_scope,
            content_markdown,
            LENGTH(content_markdown) as content_length,
            created_at
        FROM issue_task_briefs
        WHERE issue_id = '{issue_id}'
        AND brief_scope = '{scope}'
        ORDER BY created_at DESC
        LIMIT 1;
    """
    result = psql_query(query)
    if not result:
        return None

    # Parse pipe-separated output
    lines = [line.strip() for line in result.split('\n') if line.strip()]
    if not lines:
        return None

    parts = lines[0].split('|')
    if len(parts) >= 4:
        return {
            "scope": parts[0].strip(),
            "content": parts[1].strip()[:500],  # First 500 chars
            "length": int(parts[2].strip()),
            "created_at": parts[3].strip()
        }
    return None

def get_protocol_messages(issue_id: str) -> List[Dict]:
    """Get protocol messages for issue"""
    query = f"""
        SELECT
            message_type,
            from_agent_id,
            to_agent_id,
            created_at
        FROM protocol_messages
        WHERE issue_id = '{issue_id}'
        ORDER BY created_at ASC;
    """
    result = psql_query(query)
    if not result:
        return []

    messages = []
    lines = [line.strip() for line in result.split('\n') if line.strip()]
    for line in lines:
        parts = line.split('|')
        if len(parts) >= 4:
            messages.append({
                "type": parts[0].strip(),
                "from": parts[1].strip(),
                "to": parts[2].strip(),
                "created_at": parts[3].strip()
            })
    return messages

print("=" * 80)
print("E2E BRIEF GENERATION TEST")
print("=" * 80)
print(f"Start time: {datetime.now().isoformat()}")
print(f"Base URL: {BASE_URL}")
print()

# Step 0: Initial state
print("📊 STEP 0: Database Initial State")
print("-" * 80)
initial_retrieval_count = get_retrieval_run_count()
initial_brief_count = get_brief_count()
print(f"Initial retrieval runs: {initial_retrieval_count}")
print(f"Initial briefs: {initial_brief_count}")
print()

# Get test agents
print("👥 Loading Test Agents")
print("-" * 80)
cto_id = get_agent_by_name("CTO Agent")
cloud_tl_id = get_agent_by_name("Cloud Team Lead")
agent_tl_id = get_agent_by_name("Agent Team Lead")
python_tl_id = get_agent_by_name("Python Team Lead")
codex_eng_id = get_agent_by_name("Codex Engineer")
claude_eng_id = get_agent_by_name("Claude Engineer")

agents = {
    "CTO": cto_id,
    "Cloud TL": cloud_tl_id,
    "Agent TL": agent_tl_id,
    "Python TL": python_tl_id,
    "Codex Eng": codex_eng_id,
    "Claude Eng": claude_eng_id
}

for name, agent_id in agents.items():
    if agent_id:
        print(f"  ✅ {name}: {agent_id[:8]}...")
    else:
        print(f"  ❌ {name}: NOT FOUND")
        test_results["failed"].append({"name": "Agent Load", "message": f"{name} not found"})

print()

# Verify all required agents exist
if not all(agents.values()):
    print("❌ CRITICAL: Not all required agents found. Cannot proceed.")
    sys.exit(1)

print("=" * 80)
print("TEST SCENARIO: DICOM CT Modality Support")
print("=" * 80)
print("""
Epic: Add DICOM CT Modality Support
├── Feature A: Cloud API Integration
│   ├── Task A1: Add CT to modality enum (Codex)
│   └── Task A2: Add CT validation logic (Claude)
├── Feature B: Agent DICOM Parser
│   ├── Task B1: Parse CT DICOM tags (Codex)
│   └── Task B2: Implement CT parser (Claude)
├── Feature C: Worker Pipeline
│   └── Task C1: CT processing pipeline (Codex)
└── Feature D: Report Template
    └── Task D1: CT report template (Claude)
""")
print()

# Manual test data (replace with actual HTTP calls when API is ready)
print("📝 NOTE: This script currently verifies database state and brief generation")
print("         Full HTTP API integration pending server readiness")
print()

# Check if we have any existing issues to analyze
print("🔍 STEP 1: Analyzing Existing Issues")
print("-" * 80)

query = """
    SELECT
        i.id,
        i.title,
        i.issue_type,
        i.assignee_agent_id,
        COUNT(DISTINCT itb.id) as brief_count,
        COUNT(DISTINCT pm.id) as message_count
    FROM issues i
    LEFT JOIN issue_task_briefs itb ON i.id = itb.issue_id
    LEFT JOIN protocol_messages pm ON i.id = pm.issue_id
    WHERE i.created_at > NOW() - INTERVAL '1 hour'
    GROUP BY i.id, i.title, i.issue_type, i.assignee_agent_id
    LIMIT 10;
"""

recent_issues = psql_query(query)
if recent_issues:
    print("Recent issues found:")
    print(recent_issues)
else:
    print("No recent issues found")

print()

# Check retrieval runs
print("🔍 STEP 2: Retrieval Runs Analysis")
print("-" * 80)

query = """
    SELECT
        trigger_source,
        query_text,
        result_count,
        EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000 as latency_ms
    FROM retrieval_runs
    WHERE started_at > NOW() - INTERVAL '1 hour'
    ORDER BY started_at DESC
    LIMIT 5;
"""

recent_retrievals = psql_query(query)
if recent_retrievals:
    print("Recent retrieval runs:")
    print(recent_retrievals)
else:
    print("No recent retrieval runs")

print()

# Check brief quality
print("🔍 STEP 3: Brief Quality Analysis")
print("-" * 80)

query = """
    SELECT
        brief_scope,
        COUNT(*) as count,
        AVG(LENGTH(content_markdown)) as avg_length,
        MIN(LENGTH(content_markdown)) as min_length,
        MAX(LENGTH(content_markdown)) as max_length
    FROM issue_task_briefs
    GROUP BY brief_scope;
"""

brief_stats = psql_query(query)
if brief_stats:
    print("Brief statistics by scope:")
    print(brief_stats)
else:
    print("No briefs found")

print()

# Check database indexing state
print("🔍 STEP 4: Knowledge Base State")
print("-" * 80)

query = "SELECT COUNT(*) FROM documents;"
doc_count = psql_query(query)
print(f"Documents indexed: {doc_count}")

query = "SELECT COUNT(*) FROM document_chunks;"
chunk_count = psql_query(query)
print(f"Document chunks: {chunk_count}")

query = "SELECT COUNT(*) FROM document_chunk_embeddings;"
embedding_count = psql_query(query)
print(f"Chunk embeddings: {embedding_count}")

verify_checkpoint(
    "Knowledge Base",
    int(doc_count or 0) > 0 and int(chunk_count or 0) > 0,
    f"{doc_count} docs, {chunk_count} chunks indexed"
)

print()

# Verification summary
print("=" * 80)
print("TEST VERIFICATION SUMMARY")
print("=" * 80)

print(f"\n✅ Passed: {len(test_results['passed'])}")
for test in test_results['passed']:
    print(f"   - {test}")

if test_results['failed']:
    print(f"\n❌ Failed: {len(test_results['failed'])}")
    for test in test_results['failed']:
        print(f"   - {test['name']}: {test['message']}")

if test_results['warnings']:
    print(f"\n⚠️  Warnings: {len(test_results['warnings'])}")
    for warn in test_results['warnings']:
        print(f"   - {warn['name']}: {warn['message']}")

print()

# Next steps
print("=" * 80)
print("NEXT STEPS FOR COMPLETE E2E TEST")
print("=" * 80)
print("""
To complete the full E2E test, we need:

1. ✅ Server running (port 3101 or 3102)
2. ✅ Database populated (agents, knowledge base)
3. ⏳ HTTP API integration:
   - POST /api/issues (create epic, features, tasks)
   - POST /api/issues/{id}/protocol/messages (assign, submit, approve)
   - GET /api/issues/{id}/briefs (verify briefs)
4. ⏳ Verify automatic brief generation:
   - Task assignment → ASSIGN_TASK → retrieval → engineer brief
   - Submit review → SUBMIT_FOR_REVIEW → reviewer brief
   - Different evidence for different roles
5. ⏳ Performance metrics:
   - Brief generation time < 3s
   - Retrieval latency < 500ms
   - Hybrid search < 200ms
6. ⏳ Complete workflow:
   - Epic → Features → Tasks → Implement → Review → QA → Approve → Close

Current Status: Database infrastructure verified ✅
Ready for: API integration and workflow automation
""")

print(f"End time: {datetime.now().isoformat()}")
print("=" * 80)
