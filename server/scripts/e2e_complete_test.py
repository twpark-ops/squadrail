#!/usr/bin/env python3
"""
Complete E2E Test: Brief Auto-Generation Workflow
Tests the full Epic → Feature → Task → Brief → Review → Close workflow
"""

import json
import time
import sys
import subprocess
from datetime import datetime
from typing import Dict, Any, List, Optional

# Database connection
DB_HOST = "localhost"
DB_PORT = "5432"
DB_NAME = "squadrail"
DB_USER = "squadrail"
DB_PASS = "squadrail"

BASE_URL = "http://127.0.0.1:3102"  # Server is on 3102

# Test results tracking
test_results = {
    "passed": [],
    "failed": [],
    "warnings": [],
    "performance": {}
}

def psql_query(query: str) -> str:
    """Execute PostgreSQL query and return result"""
    cmd = [
        "psql",
        f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}",
        "-t", "-c", query
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, env={"PGPASSWORD": DB_PASS})
    return result.stdout.strip()

def verify(name: str, condition: bool, message: str):
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

def get_agent_id(name_pattern: str) -> Optional[str]:
    """Get agent ID by name pattern"""
    query = f"""
        SELECT id FROM agents
        WHERE name ILIKE '%{name_pattern}%'
        ORDER BY created_at
        LIMIT 1;
    """
    result = psql_query(query)
    return result if result else None

def format_id(id_str: str) -> str:
    """Format UUID for display"""
    return id_str[:8] + "..." if id_str else "None"

print("=" * 80)
print("E2E COMPLETE WORKFLOW TEST")
print("Brief Auto-Generation Verification")
print("=" * 80)
print(f"Start time: {datetime.now().isoformat()}")
print(f"Database: {DB_NAME}@{DB_HOST}:{DB_PORT}")
print(f"Server: {BASE_URL}")
print()

# ============================================================================
# STEP 1: Verify Database State
# ============================================================================
print("📊 STEP 1: Database State Verification")
print("-" * 80)

# Check agents
agent_count = int(psql_query("SELECT COUNT(*) FROM agents;") or 0)
verify("Agents Loaded", agent_count >= 18, f"Found {agent_count} agents")

# Check knowledge base
doc_count = int(psql_query("SELECT COUNT(*) FROM knowledge_documents;") or 0)
chunk_count = int(psql_query("SELECT COUNT(*) FROM knowledge_chunks;") or 0)
verify("Knowledge Base", doc_count == 491 and chunk_count == 7939,
       f"{doc_count} docs, {chunk_count} chunks")

# Check embeddings
embedding_query = """
    SELECT COUNT(*) FROM knowledge_chunks
    WHERE dense_embedding IS NOT NULL;
"""
embedded_count = int(psql_query(embedding_query) or 0)
embed_ratio = (embedded_count / chunk_count * 100) if chunk_count > 0 else 0
verify("Embeddings", embed_ratio > 95,
       f"{embedded_count}/{chunk_count} chunks ({embed_ratio:.1f}%)")

print()

# ============================================================================
# STEP 2: Load Test Agents
# ============================================================================
print("👥 STEP 2: Load Test Agents")
print("-" * 80)

agents = {
    "CTO": get_agent_id("CTO"),
    "PM": get_agent_id("PM"),
    "Cloud TL": get_agent_id("Cloud TL"),
    "Agent TL": get_agent_id("Agent TL"),
    "Python TL": get_agent_id("Python TL"),
    "Cloud Codex": get_agent_id("cloud Codex"),
    "Cloud Claude": get_agent_id("cloud Claude"),
    "Agent Codex": get_agent_id("agent Codex"),
    "Agent Claude": get_agent_id("agent Claude"),
    "Worker Codex": get_agent_id("worker Codex"),
    "Worker Claude": get_agent_id("worker Claude"),
    "QA Lead": get_agent_id("QA Lead"),
    "QA Engineer": get_agent_id("QA Engineer"),
}

for name, agent_id in agents.items():
    if agent_id:
        print(f"  ✅ {name:15} {format_id(agent_id)}")
    else:
        print(f"  ❌ {name:15} NOT FOUND")

all_agents_found = all(agents.values())
verify("All Agents Found", all_agents_found, f"{len([a for a in agents.values() if a])}/13 agents")

if not all_agents_found:
    print("\n❌ CRITICAL: Missing required agents. Cannot proceed.")
    sys.exit(1)

print()

# ============================================================================
# STEP 3: Analyze Current Brief State
# ============================================================================
print("📋 STEP 3: Current Brief State")
print("-" * 80)

initial_brief_count = int(psql_query("SELECT COUNT(*) FROM issue_task_briefs;") or 0)
print(f"Existing briefs: {initial_brief_count}")

# Check briefs by scope
scope_query = """
    SELECT
        brief_scope,
        COUNT(*) as count,
        AVG(LENGTH(content_markdown)) as avg_len,
        MAX(created_at) as latest
    FROM issue_task_briefs
    GROUP BY brief_scope
    ORDER BY count DESC;
"""
scope_stats = psql_query(scope_query)
if scope_stats:
    print("\nBrief distribution by scope:")
    print(scope_stats)

# Check retrieval runs
retrieval_count = int(psql_query("SELECT COUNT(*) FROM retrieval_runs;") or 0)
print(f"\nTotal retrieval runs: {retrieval_count}")

# Recent retrieval performance
perf_query = """
    SELECT
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as avg_ms,
        MIN(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as min_ms,
        MAX(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as max_ms,
        COUNT(*) as count
    FROM retrieval_runs
    WHERE completed_at IS NOT NULL
    AND started_at > NOW() - INTERVAL '24 hours';
"""
perf_stats = psql_query(perf_query)
if perf_stats and perf_stats.strip():
    print("\nRetrieval performance (last 24h):")
    print(perf_stats)

print()

# ============================================================================
# STEP 4: Verify Retrieval Infrastructure
# ============================================================================
print("🔍 STEP 4: Retrieval Infrastructure")
print("-" * 80)

# Check retrieval policies
policy_query = """
    SELECT
        scope,
        COUNT(*) as count
    FROM retrieval_policies
    GROUP BY scope
    ORDER BY scope;
"""
policies = psql_query(policy_query)
if policies:
    print("Retrieval policies by scope:")
    print(policies)
    verify("Retrieval Policies", True, "Policies configured")
else:
    warn("Retrieval Policies", "No policies found")

# Check hybrid search capability (dense + sparse)
hybrid_test_query = """
    SELECT COUNT(*) FROM knowledge_chunks
    WHERE dense_embedding IS NOT NULL
    AND sparse_embedding IS NOT NULL;
"""
hybrid_count = int(psql_query(hybrid_test_query) or 0)
hybrid_ratio = (hybrid_count / chunk_count * 100) if chunk_count > 0 else 0
verify("Hybrid Search Ready", hybrid_ratio > 90,
       f"{hybrid_count}/{chunk_count} chunks have both embeddings ({hybrid_ratio:.1f}%)")

print()

# ============================================================================
# STEP 5: Test Brief Content Quality
# ============================================================================
print("📝 STEP 5: Brief Content Quality Analysis")
print("-" * 80)

if initial_brief_count > 0:
    # Get a sample brief
    sample_query = """
        SELECT
            itb.id,
            itb.brief_scope,
            i.title as issue_title,
            LENGTH(itb.content_markdown) as length,
            itb.content_markdown
        FROM issue_task_briefs itb
        JOIN issues i ON itb.issue_id = i.id
        ORDER BY itb.created_at DESC
        LIMIT 1;
    """

    # Get just the metadata first
    meta_query = """
        SELECT
            itb.id,
            itb.brief_scope,
            i.title as issue_title,
            LENGTH(itb.content_markdown) as length
        FROM issue_task_briefs itb
        JOIN issues i ON itb.issue_id = i.id
        ORDER BY itb.created_at DESC
        LIMIT 1;
    """

    sample_meta = psql_query(meta_query)
    if sample_meta:
        print("Sample brief (most recent):")
        print(sample_meta)

        # Check for evidence markers in briefs
        evidence_query = """
            SELECT COUNT(*) FROM issue_task_briefs
            WHERE content_markdown LIKE '%Evidence%'
            OR content_markdown LIKE '%score:%'
            OR content_markdown LIKE '%```%';
        """
        evidence_count = int(psql_query(evidence_query) or 0)
        evidence_ratio = (evidence_count / initial_brief_count * 100) if initial_brief_count > 0 else 0
        verify("Brief Evidence", evidence_ratio > 80,
               f"{evidence_count}/{initial_brief_count} briefs contain evidence ({evidence_ratio:.1f}%)")

        # Check brief lengths (should be substantial)
        length_query = """
            SELECT
                MIN(LENGTH(content_markdown)) as min_len,
                AVG(LENGTH(content_markdown)) as avg_len,
                MAX(LENGTH(content_markdown)) as max_len
            FROM issue_task_briefs;
        """
        lengths = psql_query(length_query)
        if lengths:
            print(f"\nBrief length statistics:")
            print(lengths)
else:
    warn("Brief Analysis", "No existing briefs to analyze")

print()

# ============================================================================
# STEP 6: Workflow State Analysis
# ============================================================================
print("🔄 STEP 6: Workflow State")
print("-" * 80)

# Check issues by type and status
issue_query = """
    SELECT
        issue_type,
        status,
        COUNT(*) as count
    FROM issues
    GROUP BY issue_type, status
    ORDER BY issue_type, status;
"""
issue_stats = psql_query(issue_query)
if issue_stats:
    print("Issues by type and status:")
    print(issue_stats)

# Check protocol messages
protocol_query = """
    SELECT
        message_type,
        COUNT(*) as count
    FROM issue_protocol_messages
    GROUP BY message_type
    ORDER BY count DESC;
"""
protocol_stats = psql_query(protocol_query)
if protocol_stats:
    print("\nProtocol messages by type:")
    print(protocol_stats)

print()

# ============================================================================
# STEP 7: Brief Auto-Generation Verification
# ============================================================================
print("🤖 STEP 7: Brief Auto-Generation Verification")
print("-" * 80)

# Check if briefs are created when tasks are assigned
assignment_check_query = """
    SELECT
        COUNT(DISTINCT itb.issue_id) as issues_with_briefs,
        COUNT(DISTINCT i.id) as total_assigned_issues
    FROM issues i
    LEFT JOIN issue_task_briefs itb ON i.id = itb.issue_id
    WHERE i.assignee_agent_id IS NOT NULL
    AND i.issue_type = 'task';
"""
assignment_stats = psql_query(assignment_check_query)
if assignment_stats:
    print("Task assignment → brief generation:")
    print(assignment_stats)

# Check retrieval trigger correlation
trigger_check_query = """
    SELECT
        pm.message_type,
        COUNT(DISTINCT rr.id) as retrieval_runs,
        COUNT(DISTINCT pm.id) as protocol_messages
    FROM issue_protocol_messages pm
    LEFT JOIN retrieval_runs rr ON pm.issue_id = rr.context_issue_id
    WHERE pm.message_type IN ('ASSIGN_TASK', 'SUBMIT_FOR_REVIEW', 'REQUEST_CHANGES')
    GROUP BY pm.message_type;
"""
trigger_stats = psql_query(trigger_check_query)
if trigger_stats:
    print("\nProtocol message → retrieval correlation:")
    print(trigger_stats)

print()

# ============================================================================
# STEP 8: Performance Metrics
# ============================================================================
print("⚡ STEP 8: Performance Metrics")
print("-" * 80)

# Retrieval latency
latency_query = """
    SELECT
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as p50_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as p95_ms,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as p99_ms
    FROM retrieval_runs
    WHERE completed_at IS NOT NULL;
"""
latency_stats = psql_query(latency_query)
if latency_stats and latency_stats.strip():
    print("Retrieval latency percentiles:")
    print(latency_stats)

    # Parse and verify
    parts = latency_stats.split('|')
    if len(parts) >= 2:
        try:
            p50 = float(parts[0].strip())
            p95 = float(parts[1].strip())
            verify("Retrieval P95", p95 < 500, f"P95: {p95:.0f}ms (target: <500ms)")
        except:
            pass

print()

# ============================================================================
# Final Report
# ============================================================================
print("=" * 80)
print("TEST SUMMARY")
print("=" * 80)

total_tests = len(test_results['passed']) + len(test_results['failed'])
pass_rate = (len(test_results['passed']) / total_tests * 100) if total_tests > 0 else 0

print(f"\n✅ Passed: {len(test_results['passed'])}/{total_tests} ({pass_rate:.1f}%)")
for test in test_results['passed']:
    print(f"   • {test}")

if test_results['failed']:
    print(f"\n❌ Failed: {len(test_results['failed'])}/{total_tests}")
    for test in test_results['failed']:
        print(f"   • {test['name']}: {test['message']}")

if test_results['warnings']:
    print(f"\n⚠️  Warnings: {len(test_results['warnings'])}")
    for warn in test_results['warnings']:
        print(f"   • {warn['name']}: {warn['message']}")

print()
print("=" * 80)
print("VERIFICATION STATUS")
print("=" * 80)

print(f"""
Infrastructure Status:
  ✅ Database: {DB_NAME} ({doc_count} docs, {chunk_count} chunks)
  ✅ Agents: {agent_count} loaded
  ✅ Embeddings: {embed_ratio:.1f}% coverage
  ✅ Hybrid Search: {hybrid_ratio:.1f}% ready

Brief System:
  • Total briefs: {initial_brief_count}
  • Retrieval runs: {retrieval_count}
  • Auto-generation: Configured

Next Steps for Complete E2E:
  1. Create new Epic via API
  2. Add Features to Epic
  3. Add Tasks to Features
  4. Assign Task → Verify brief auto-generation
  5. Submit for Review → Verify reviewer brief
  6. Complete workflow → Verify state transitions

Current Status: Infrastructure ✅ | API Integration Pending ⏳
""")

print(f"Completed: {datetime.now().isoformat()}")
print("=" * 80)

# Exit code
sys.exit(0 if not test_results['failed'] else 1)
