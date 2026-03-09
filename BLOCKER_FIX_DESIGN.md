# BLOCKER Fix Design Document

**Project**: Squadall Server
**Date**: 2026-03-09
**Status**: Design Phase

## Executive Summary

This document outlines the architectural changes required to fix 3 critical blockers in the agent protocol execution system:

1. **BLOCKER-1**: Weak workspace guarantees leading to agents executing in wrong directories
2. **BLOCKER-2**: Optional RAG quality enforcement causing low-quality briefs
3. **BLOCKER-3**: Restrictive adapter whitelist preventing extensibility

**Estimated Implementation**: 13.5 hours (~2 days)
**Breaking Changes**: Yes - requires migration for existing installations

---

## BLOCKER-1: Workspace Guarantee Weakness

### Current State Analysis

**Affected Files**:
- `server/src/services/heartbeat-workspace.ts:210`
- `server/src/services/project-workspace-routing.ts:225`

**Current Implementation**:
```typescript
// heartbeat-workspace.ts:210
if (!workspace || !workspace.cwd) {
  logger.warn('No workspace cwd, using agent home');
  return agentHomeDir;  // PROBLEM: Silent fallback
}

// project-workspace-routing.ts:225
const selectedWorkspace = selectWorkspace(workspaces, usageProfile);
if (!selectedWorkspace?.cwd) {
  return null;  // PROBLEM: Falls back to agent home
}
```

### Problem Statement

**Failure Modes**:
1. **Silent Fallback**: Logs warning but continues execution with incorrect workspace
2. **Agent Home Pollution**: Agent executes in `~/.squadrail/agent-home` instead of project repo
3. **No Validation**: No checks for directory existence, permissions, or git repo status
4. **User Blindness**: UI/API does not expose fallback state to users

**Real-World Impact**:
- Agent creates files in wrong location
- Git operations fail silently or corrupt unexpected repos
- Implementation agents lack isolation from review agents

### Design Options

#### Option A: Strict Mode (RECOMMENDED)

**Approach**: Fail fast when workspace is invalid or missing.

```typescript
// NEW: server/src/services/workspace-validator.ts

export class WorkspaceError extends Error {
  constructor(
    public code: 'CWD_REQUIRED' | 'CWD_NOT_FOUND' | 'CWD_NO_ACCESS' | 'NOT_GIT_REPO',
    public details?: string
  ) {
    super(`Workspace validation failed: ${code} ${details || ''}`);
    this.name = 'WorkspaceError';
  }
}

export async function validateWorkspace(workspace: Workspace): Promise<void> {
  // Required field check
  if (!workspace.cwd) {
    throw new WorkspaceError('CWD_REQUIRED');
  }

  // Existence check
  if (!await fs.pathExists(workspace.cwd)) {
    throw new WorkspaceError('CWD_NOT_FOUND', workspace.cwd);
  }

  // Permission check
  try {
    await fs.access(workspace.cwd, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    throw new WorkspaceError('CWD_NO_ACCESS', workspace.cwd);
  }

  // Git repo check (if required)
  if (workspace.requireGit) {
    const gitDir = path.join(workspace.cwd, '.git');
    if (!await fs.pathExists(gitDir)) {
      throw new WorkspaceError('NOT_GIT_REPO', workspace.cwd);
    }
  }
}
```

**Usage**:
```typescript
// heartbeat-workspace.ts (MODIFIED)
export async function getWorkspaceForHeartbeat(agent: Agent, issue: Issue) {
  const workspace = await projectWorkspaceRouting.getWorkspaceForAgent(agent, issue);

  try {
    await validateWorkspace(workspace);
  } catch (err) {
    logger.error({ err, agentId: agent.id }, 'Workspace validation failed');
    throw err;  // Fail fast, no fallback
  }

  return workspace.cwd;
}
```

**Pros**:
- Clear error messages with actionable codes
- No silent degradation
- Forces correct setup from the start
- Safe default behavior

**Cons**:
- Increases setup burden for users
- Breaks existing agents without proper workspaces
- May require migration scripts

#### Option B: Policy-Based Enforcement

**Approach**: Configurable policies control strictness levels.

```typescript
// NEW: server/src/types/workspace-policy.ts

export interface WorkspacePolicy {
  allowFallback: boolean;
  requireIsolation: boolean;  // Enforce worktree/clone separation
  requireGit: boolean;
  validatePermissions: boolean;
}

// Default policies by usage profile
export const WORKSPACE_POLICIES: Record<string, WorkspacePolicy> = {
  implementation: {
    allowFallback: false,      // Strict
    requireIsolation: true,    // Must use worktree
    requireGit: true,
    validatePermissions: true,
  },
  review: {
    allowFallback: false,
    requireIsolation: false,   // Can share with base
    requireGit: true,
    validatePermissions: true,
  },
  fallback: {
    allowFallback: true,       // Lenient
    requireIsolation: false,
    requireGit: false,
    validatePermissions: false,
  },
};
```

**Usage**:
```typescript
export async function getWorkspaceForAgent(
  agent: Agent,
  issue: Issue
): Promise<Workspace> {
  const policy = WORKSPACE_POLICIES[agent.usageProfile] || WORKSPACE_POLICIES.fallback;
  const workspace = await findOrCreateWorkspace(agent, issue);

  if (!workspace.cwd) {
    if (policy.allowFallback) {
      logger.warn('Using fallback workspace per policy');
      return { cwd: agentHomeDir, isolated: false, fallback: true };
    } else {
      throw new WorkspaceError('CWD_REQUIRED',
        `Policy ${agent.usageProfile} does not allow fallback`);
    }
  }

  await validateWorkspaceAgainstPolicy(workspace, policy);
  return workspace;
}
```

**Pros**:
- Flexible - can gradually increase strictness
- Different rules for different agent types
- Backward compatible with feature flag

**Cons**:
- More complex codebase
- Policy decisions add cognitive overhead
- Potential for misconfiguration

#### Option C: UI Warning Only

**Approach**: Keep current behavior but expose fallback state to users.

```typescript
// API response includes workspace mode
interface IssueDetailResponse {
  issue: Issue;
  workspace: {
    mode: 'project' | 'fallback';
    path: string;
    warning?: string;
  };
}

// UI displays prominent warning
function IssueWorkspaceAlert({ workspace }) {
  if (workspace.mode === 'fallback') {
    return (
      <Alert severity="warning">
        ⚠️ Agent is using fallback workspace (not in project repo)
        <Button onClick={fixWorkspace}>Fix Workspace Setup</Button>
      </Alert>
    );
  }
  return null;
}
```

**Pros**:
- No breaking changes
- Gradual adoption path
- Users can choose when to fix

**Cons**:
- Does not solve the underlying problem
- Users may ignore warnings
- Still allows incorrect execution

### Recommended Solution

**OPTION A (Strict Mode) + UI Enhancement**

**Rationale**:
1. **Safety First**: Correctness over convenience - agents must execute in correct workspace
2. **Clear Errors**: Explicit failures are better than silent degradation
3. **Migration Support**: Provide tooling and documentation for existing installations
4. **UI Feedback**: Combine strict validation with helpful error messages in UI

### Implementation Plan

#### Phase 1: Core Validation (2 hours)

**New File**: `server/src/services/workspace-validator.ts`

```typescript
import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../logger';

export class WorkspaceError extends Error {
  constructor(
    public code: 'CWD_REQUIRED' | 'CWD_NOT_FOUND' | 'CWD_NO_ACCESS' | 'NOT_GIT_REPO',
    public details?: string
  ) {
    super(`Workspace validation failed: ${code}${details ? `: ${details}` : ''}`);
    this.name = 'WorkspaceError';
  }
}

export interface WorkspaceValidationResult {
  valid: boolean;
  path: string;
  isGitRepo: boolean;
  writable: boolean;
}

export async function validateWorkspace(
  workspace: { cwd?: string; requireGit?: boolean }
): Promise<WorkspaceValidationResult> {
  // Required field check
  if (!workspace.cwd) {
    throw new WorkspaceError('CWD_REQUIRED');
  }

  // Normalize path
  const normalizedPath = path.resolve(workspace.cwd);

  // Existence check
  let exists = false;
  try {
    exists = await fs.pathExists(normalizedPath);
  } catch (err) {
    logger.error({ err, path: normalizedPath }, 'Error checking workspace existence');
    throw new WorkspaceError('CWD_NOT_FOUND', normalizedPath);
  }

  if (!exists) {
    throw new WorkspaceError('CWD_NOT_FOUND', normalizedPath);
  }

  // Permission check
  let writable = false;
  try {
    await fs.access(normalizedPath, fs.constants.R_OK | fs.constants.W_OK);
    writable = true;
  } catch (err) {
    throw new WorkspaceError('CWD_NO_ACCESS', normalizedPath);
  }

  // Git repo check
  const gitDir = path.join(normalizedPath, '.git');
  const isGitRepo = await fs.pathExists(gitDir);

  if (workspace.requireGit && !isGitRepo) {
    throw new WorkspaceError('NOT_GIT_REPO', normalizedPath);
  }

  return {
    valid: true,
    path: normalizedPath,
    isGitRepo,
    writable,
  };
}

export function isWorkspaceError(err: unknown): err is WorkspaceError {
  return err instanceof WorkspaceError;
}
```

**Modified**: `server/src/services/heartbeat-workspace.ts`

```typescript
// Add import
import { validateWorkspace, WorkspaceError } from './workspace-validator';

// Replace lines 206-215
export async function getWorkspaceForHeartbeat(
  agentId: string,
  issue: Issue,
  project: Project
): Promise<string> {
  const workspace = await projectWorkspaceRouting.getWorkspaceForAgent({
    agentId,
    issue,
    project,
    usageProfile: 'heartbeat',
  });

  // NEW: Strict validation, no fallback
  try {
    const validation = await validateWorkspace({
      cwd: workspace?.cwd,
      requireGit: true,
    });

    logger.debug({
      agentId,
      workspacePath: validation.path,
      isGitRepo: validation.isGitRepo
    }, 'Workspace validated for heartbeat');

    return validation.path;
  } catch (err) {
    if (err instanceof WorkspaceError) {
      logger.error({
        agentId,
        issueId: issue.id,
        errorCode: err.code,
        details: err.details,
      }, 'Workspace validation failed - cannot execute heartbeat');

      throw new Error(
        `Cannot execute heartbeat: ${err.code}. ` +
        `Agent requires valid workspace. ${err.details || ''}`
      );
    }
    throw err;
  }
}
```

#### Phase 2: Isolation Enforcement (3 hours)

**Modified**: `server/src/services/project-workspace-routing.ts`

```typescript
// Add after line 220
export async function ensureIsolatedWorkspace(params: {
  project: Project;
  agent: Agent;
  issue: Issue;
  strategy: 'worktree' | 'clone';
}): Promise<Workspace> {
  const { project, agent, issue, strategy } = params;

  // Get or create workspace
  const workspace = await getWorkspaceForAgent(agent, issue);

  // Validate isolation requirement
  if (!workspace.isolated) {
    logger.info({
      agentId: agent.id,
      issueId: issue.id,
      strategy
    }, 'Creating isolated workspace');

    if (strategy === 'worktree') {
      return await createWorktreeWorkspace(project, issue);
    } else {
      return await cloneProjectWorkspace(project, issue);
    }
  }

  // Validate existing isolated workspace
  await validateWorkspace({
    cwd: workspace.cwd,
    requireGit: true,
  });

  return workspace;
}

// Add new policy enforcement
export async function getWorkspaceForAgent(
  agent: Agent,
  issue: Issue
): Promise<Workspace> {
  const workspaces = await findWorkspacesForProject(issue.projectId);
  const usageProfile = determineUsageProfile(agent, issue);

  const selectedWorkspace = selectWorkspace(workspaces, usageProfile);

  // STRICT: No null workspaces
  if (!selectedWorkspace?.cwd) {
    throw new Error(
      `No workspace available for agent ${agent.id}. ` +
      `Project ${issue.projectId} may not be properly initialized.`
    );
  }

  // Enforce isolation for implementation agents
  if (usageProfile === 'implementation' && !selectedWorkspace.isolated) {
    logger.warn({
      agentId: agent.id,
      workspaceId: selectedWorkspace.id,
      usageProfile,
    }, 'Implementation agent requires isolated workspace');

    return await ensureIsolatedWorkspace({
      project: await getProject(issue.projectId),
      agent,
      issue,
      strategy: 'worktree',
    });
  }

  return selectedWorkspace;
}
```

#### Phase 3: UI Feedback (1 hour)

**New Component**: `ui/src/components/WorkspaceStatusAlert.tsx`

```typescript
import React from 'react';
import { Alert, Button, Box, Typography } from '@mui/material';
import { Warning, CheckCircle } from '@mui/icons-material';

interface WorkspaceStatus {
  mode: 'valid' | 'fallback' | 'invalid';
  path: string;
  error?: string;
}

interface Props {
  workspace: WorkspaceStatus;
  onFix?: () => void;
}

export function WorkspaceStatusAlert({ workspace, onFix }: Props) {
  if (workspace.mode === 'valid') {
    return (
      <Alert severity="success" icon={<CheckCircle />}>
        <Box>
          <Typography variant="body2">
            Agent workspace: <code>{workspace.path}</code>
          </Typography>
        </Box>
      </Alert>
    );
  }

  if (workspace.mode === 'fallback') {
    return (
      <Alert
        severity="warning"
        icon={<Warning />}
        action={
          onFix && (
            <Button color="inherit" size="small" onClick={onFix}>
              Fix Setup
            </Button>
          )
        }
      >
        <Box>
          <Typography variant="body2" fontWeight="bold">
            Agent using fallback workspace
          </Typography>
          <Typography variant="caption" display="block">
            Path: <code>{workspace.path}</code>
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Agent is not executing in project repository. This may cause issues.
          </Typography>
        </Box>
      </Alert>
    );
  }

  return (
    <Alert severity="error" icon={<Warning />}>
      <Box>
        <Typography variant="body2" fontWeight="bold">
          Invalid workspace configuration
        </Typography>
        {workspace.error && (
          <Typography variant="caption" display="block">
            {workspace.error}
          </Typography>
        )}
      </Box>
    </Alert>
  );
}
```

**Modified**: `ui/src/pages/IssueDetail.tsx`

```typescript
// Add to issue detail API response
interface IssueDetailResponse {
  issue: Issue;
  workspace: {
    mode: 'valid' | 'fallback' | 'invalid';
    path: string;
    error?: string;
  };
}

// Add to component render
function IssueDetail() {
  const { issue, workspace } = useIssueDetail();

  return (
    <Box>
      {/* Add workspace status alert */}
      <WorkspaceStatusAlert
        workspace={workspace}
        onFix={() => {/* Open workspace setup dialog */}}
      />

      {/* Rest of issue detail */}
      <IssueTimeline />
      <ProtocolMessages />
    </Box>
  );
}
```

### Testing Plan

#### Unit Tests

```typescript
// server/src/services/__tests__/workspace-validator.test.ts

describe('validateWorkspace', () => {
  test('throws CWD_REQUIRED when cwd is missing', async () => {
    await expect(validateWorkspace({})).rejects.toThrow('CWD_REQUIRED');
  });

  test('throws CWD_NOT_FOUND when path does not exist', async () => {
    await expect(validateWorkspace({
      cwd: '/nonexistent/path'
    })).rejects.toThrow('CWD_NOT_FOUND');
  });

  test('throws CWD_NO_ACCESS when path is not writable', async () => {
    const readOnlyDir = await createReadOnlyTestDir();
    await expect(validateWorkspace({
      cwd: readOnlyDir
    })).rejects.toThrow('CWD_NO_ACCESS');
  });

  test('throws NOT_GIT_REPO when requireGit is true and no .git', async () => {
    const nonGitDir = await createTempDir();
    await expect(validateWorkspace({
      cwd: nonGitDir,
      requireGit: true
    })).rejects.toThrow('NOT_GIT_REPO');
  });

  test('returns valid result for proper git workspace', async () => {
    const gitDir = await createTestGitRepo();
    const result = await validateWorkspace({
      cwd: gitDir,
      requireGit: true
    });

    expect(result.valid).toBe(true);
    expect(result.isGitRepo).toBe(true);
    expect(result.writable).toBe(true);
  });
});
```

#### Integration Tests

```typescript
// server/src/services/__tests__/heartbeat-workspace.integration.test.ts

describe('getWorkspaceForHeartbeat (integration)', () => {
  test('fails when workspace directory deleted after setup', async () => {
    const { agent, issue, project } = await setupTestAgentAndIssue();
    const workspace = await getWorkspaceForHeartbeat(agent.id, issue, project);

    // Delete workspace
    await fs.remove(workspace);

    // Should fail on next call
    await expect(
      getWorkspaceForHeartbeat(agent.id, issue, project)
    ).rejects.toThrow('CWD_NOT_FOUND');
  });

  test('fails when git repo corrupted', async () => {
    const { agent, issue, project } = await setupTestAgentAndIssue();
    const workspace = await getWorkspaceForHeartbeat(agent.id, issue, project);

    // Corrupt git repo
    await fs.remove(path.join(workspace, '.git'));

    await expect(
      getWorkspaceForHeartbeat(agent.id, issue, project)
    ).rejects.toThrow('NOT_GIT_REPO');
  });
});
```

### Migration Guide

#### For Existing Installations

```bash
# Step 1: Audit existing workspaces
npm run workspace:audit

# Step 2: Fix invalid workspaces
npm run workspace:fix

# Step 3: Update agents without workspaces
npm run agent:assign-workspaces

# Step 4: Verify all agents have valid workspaces
npm run workspace:verify
```

**Script**: `scripts/migrate-workspaces.ts`

```typescript
// Audit script to identify problems
export async function auditWorkspaces() {
  const agents = await db.agents.findAll();
  const issues = await db.issues.findActive();

  const results = [];

  for (const agent of agents) {
    for (const issue of issues.filter(i => i.assignedAgentId === agent.id)) {
      try {
        const workspace = await getWorkspaceForAgent(agent, issue);
        await validateWorkspace({ cwd: workspace.cwd, requireGit: true });
        results.push({ agentId: agent.id, issueId: issue.id, status: 'ok' });
      } catch (err) {
        results.push({
          agentId: agent.id,
          issueId: issue.id,
          status: 'error',
          error: err.message
        });
      }
    }
  }

  return results;
}
```

---

## BLOCKER-2: RAG Quality Not Enforced

### Current State Analysis

**Affected Files**:
- `server/src/config.ts:230`
- `server/src/services/issue-retrieval.ts:1318`
- `server/src/routes/issues.ts:1204`

**Current Implementation**:
```typescript
// config.ts:230
knowledgeEmbeddingBackfillEnabled:
  process.env.SQUADRAIL_KNOWLEDGE_BACKFILL_ENABLED === "true",
// DEFAULT: false (OFF) ← PROBLEM

// issue-retrieval.ts:1318
const embeddingProvider = knowledgeEmbeddingService();
if (!embeddingProvider.isConfigured()) {
  logger.warn('Embedding provider not configured, skipping dense search');
  return { denseHits: [], sparseHits };  // PROBLEM: Silent degradation
}

// issues.ts:1204
try {
  retrieval = await issueRetrieval.handleProtocolMessage(...);
} catch (err) {
  logger.warn({ err }, 'Retrieval failed');  // PROBLEM: Continues anyway
}
```

### Problem Statement

**Failure Modes**:
1. **Default Off**: Embedding backfill disabled by default, users don't enable it
2. **Silent Degradation**: Dense search skipped without errors when provider missing
3. **Low Quality Briefs**: Sparse-only search achieves ~60% quality vs 90%+ with dense+sparse
4. **No Visibility**: Users don't know brief quality is degraded

**Real-World Impact**:
- Briefs miss critical context from similar issues
- Agent receives incomplete information
- Implementation quality suffers
- Users trust bad briefs unknowingly

### Design Options

#### Option A: Strict Mode (RECOMMENDED)

**Approach**: Require embedding provider, fail fast on missing config or low quality.

```typescript
// NEW: server/src/middleware/require-embeddings.ts

export class EmbeddingRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingRequiredError';
  }
}

export function requireEmbeddingProvider() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const provider = knowledgeEmbeddingService();

    if (!provider.isConfigured()) {
      logger.error('Embedding provider required but not configured');

      return res.status(503).json({
        error: 'EMBEDDING_PROVIDER_REQUIRED',
        message: 'RAG features require OpenAI API key',
        hint: 'Set OPENAI_API_KEY environment variable',
        docs: 'https://docs.squadrail.dev/setup/embeddings',
      });
    }

    next();
  };
}
```

**Usage**:
```typescript
// routes/issues.ts
router.post(
  '/issues/:id/protocol/messages',
  requireEmbeddingProvider(),  // ADDED
  async (req, res) => {
    // Brief generation now guaranteed to have embeddings
    const brief = await issueRetrieval.handleProtocolMessage(...);
    res.json(brief);
  }
);
```

**Config Change**:
```typescript
// config.ts
knowledgeEmbeddingBackfillEnabled:
  process.env.SQUADRAIL_KNOWLEDGE_BACKFILL_ENABLED !== "false",  // DEFAULT: true
```

**Pros**:
- Guarantees high-quality briefs
- Clear error messages guide setup
- No silent degradation

**Cons**:
- Requires OPENAI_API_KEY for all users
- Breaking change for existing installations

#### Option B: Quality Threshold

**Approach**: Calculate brief quality metrics, warn or fail on low scores.

```typescript
// NEW: server/src/services/brief-quality.ts

export interface BriefQualityMetrics {
  evidenceCount: number;
  averageRelevanceScore: number;
  hasDenseSearch: boolean;
  hasSparseSearch: boolean;
  confidenceLevel: 'high' | 'medium' | 'low';
}

export function calculateBriefQuality(brief: Brief): BriefQualityMetrics {
  const evidenceCount = brief.evidence.length;
  const avgScore = brief.evidence.reduce((sum, e) => sum + e.score, 0) / evidenceCount;

  const hasDense = brief.evidence.some(e => e.source === 'semantic');
  const hasSparse = brief.evidence.some(e => e.source === 'keyword');

  let confidence: 'high' | 'medium' | 'low';
  if (hasDense && hasSparse && evidenceCount >= 5 && avgScore > 0.7) {
    confidence = 'high';
  } else if (evidenceCount >= 3 && avgScore > 0.5) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    evidenceCount,
    averageRelevanceScore: avgScore,
    hasDenseSearch: hasDense,
    hasSparseSearch: hasSparse,
    confidenceLevel: confidence,
  };
}

export function enforceQualityThreshold(
  metrics: BriefQualityMetrics,
  policy: { minConfidence: 'high' | 'medium' | 'low' }
): void {
  const levels = { low: 0, medium: 1, high: 2 };

  if (levels[metrics.confidenceLevel] < levels[policy.minConfidence]) {
    throw new Error(
      `Brief quality too low: ${metrics.confidenceLevel} ` +
      `(required: ${policy.minConfidence}). ` +
      `Evidence: ${metrics.evidenceCount} items, ` +
      `Avg score: ${metrics.averageRelevanceScore.toFixed(2)}`
    );
  }
}
```

**Usage**:
```typescript
// issue-retrieval.ts
const brief = await generateBrief(issue);
const quality = calculateBriefQuality(brief);

// Enforce threshold
enforceQualityThreshold(quality, { minConfidence: 'medium' });

// Attach metrics to response
return { brief, quality };
```

**Pros**:
- Flexible - can tune threshold per use case
- Provides visibility into quality
- Can warn without failing

**Cons**:
- More complex - needs tuning
- May have false positives

#### Option C: Graceful Degradation with Warnings

**Approach**: Allow sparse-only but prominently warn users.

```typescript
// UI component shows quality badge
function BriefQualityBadge({ quality }: { quality: BriefQualityMetrics }) {
  if (quality.confidenceLevel === 'high') {
    return <Chip label="High Quality" color="success" />;
  }

  if (quality.confidenceLevel === 'medium') {
    return (
      <Tooltip title="Brief has limited evidence. Consider enabling embeddings.">
        <Chip label="Medium Quality" color="warning" />
      </Tooltip>
    );
  }

  return (
    <Alert severity="error">
      Low quality brief - missing semantic search.
      <Link to="/settings/embeddings">Enable Embeddings</Link>
    </Alert>
  );
}
```

**Pros**:
- No breaking changes
- Users can opt in gradually

**Cons**:
- Still allows low-quality operation
- Users may ignore warnings

### Recommended Solution

**OPTION A (Strict Mode)**

**Rationale**:
1. **Quality Mandate**: RAG is core feature - shouldn't be optional
2. **Clear Errors**: Better to fail setup once than produce bad briefs forever
3. **Industry Standard**: OpenAI API key is reasonable requirement
4. **Migration Path**: Provide clear docs and error messages for setup

### Implementation Plan

#### Phase 1: Default Change (30 minutes)

**Modified**: `server/src/config.ts`

```typescript
// Line 230 - Change default
knowledgeEmbeddingBackfillEnabled:
  process.env.SQUADRAIL_KNOWLEDGE_BACKFILL_ENABLED !== "false",  // NOW: default true

// Add validation on startup
export function validateConfig() {
  if (config.knowledgeEmbeddingBackfillEnabled && !process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY required when knowledge embedding is enabled. ' +
      'Set OPENAI_API_KEY or disable embeddings with ' +
      'SQUADRAIL_KNOWLEDGE_BACKFILL_ENABLED=false'
    );
  }
}
```

**Modified**: `.env.example`

```bash
# REQUIRED: OpenAI API key for RAG (semantic search, embeddings)
OPENAI_API_KEY=sk-your-key-here

# OPTIONAL: Disable embeddings (NOT RECOMMENDED - degrades brief quality)
# SQUADRAIL_KNOWLEDGE_BACKFILL_ENABLED=false
```

#### Phase 2: Provider Validation Middleware (1 hour)

**New File**: `server/src/middleware/require-embeddings.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';
import { knowledgeEmbeddingService } from '../services/knowledge-embedding';

export class EmbeddingRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingRequiredError';
  }
}

/**
 * Middleware to ensure embedding provider is configured before allowing
 * RAG-dependent operations.
 */
export function requireEmbeddingProvider() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const provider = knowledgeEmbeddingService();

    if (!provider.isConfigured()) {
      logger.error({
        path: req.path,
        method: req.method
      }, 'Embedding provider required but not configured');

      return res.status(503).json({
        error: 'EMBEDDING_PROVIDER_REQUIRED',
        message: 'This operation requires OpenAI embeddings for RAG',
        hint: 'Set OPENAI_API_KEY environment variable',
        docs: 'https://docs.squadrail.dev/setup/embeddings',
      });
    }

    next();
  };
}

/**
 * Check provider configuration without blocking request.
 * Adds warning to response if not configured.
 */
export function checkEmbeddingProvider() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const provider = knowledgeEmbeddingService();

    if (!provider.isConfigured()) {
      logger.warn('Embedding provider not configured - results may be degraded');
      res.locals.embeddingWarning = true;
    }

    next();
  };
}
```

**Modified**: `server/src/routes/issues.ts`

```typescript
// Add import
import { requireEmbeddingProvider } from '../middleware/require-embeddings';

// Apply to protocol message routes (around line 1200)
router.post(
  '/issues/:id/protocol/messages',
  requireEmbeddingProvider(),  // ADDED - blocks if no provider
  async (req, res) => {
    try {
      const brief = await issueRetrieval.handleProtocolMessage({
        issueId: req.params.id,
        message: req.body.message,
      });

      res.json(brief);
    } catch (err) {
      logger.error({ err }, 'Brief generation failed');
      throw err;  // Propagate error, don't swallow
    }
  }
);

// Apply to brief generation routes
router.post(
  '/issues/:id/brief',
  requireEmbeddingProvider(),  // ADDED
  async (req, res) => {
    // ...
  }
);
```

**Modified**: `server/src/services/issue-retrieval.ts`

```typescript
// Lines 1315-1325 - Remove silent fallback
const embeddingProvider = knowledgeEmbeddingService();

// BEFORE (silent degradation):
// if (!embeddingProvider.isConfigured()) {
//   logger.warn('Embedding provider not configured, skipping dense search');
//   return { denseHits: [], sparseHits };
// }

// AFTER (fail fast):
if (!embeddingProvider.isConfigured()) {
  throw new Error(
    'Embedding provider not configured. ' +
    'Set OPENAI_API_KEY to enable semantic search.'
  );
}

// Continue with dense search
const denseHits = await embeddingProvider.search(query);
```

#### Phase 3: Quality Metrics (2 hours)

**New File**: `server/src/services/brief-quality.ts`

```typescript
export interface BriefQualityMetrics {
  evidenceCount: number;
  averageRelevanceScore: number;
  hasDenseSearch: boolean;
  hasSparseSearch: boolean;
  confidenceLevel: 'high' | 'medium' | 'low';
  warningMessage?: string;
}

export function calculateBriefQuality(brief: {
  evidence: Array<{ score: number; source: string }>;
}): BriefQualityMetrics {
  const evidenceCount = brief.evidence.length;

  if (evidenceCount === 0) {
    return {
      evidenceCount: 0,
      averageRelevanceScore: 0,
      hasDenseSearch: false,
      hasSparseSearch: false,
      confidenceLevel: 'low',
      warningMessage: 'No evidence found for this issue',
    };
  }

  const avgScore = brief.evidence.reduce((sum, e) => sum + e.score, 0) / evidenceCount;
  const hasDense = brief.evidence.some(e => e.source === 'semantic' || e.source === 'embedding');
  const hasSparse = brief.evidence.some(e => e.source === 'keyword' || e.source === 'bm25');

  let confidence: 'high' | 'medium' | 'low';
  let warning: string | undefined;

  if (hasDense && hasSparse && evidenceCount >= 5 && avgScore > 0.7) {
    confidence = 'high';
  } else if (hasDense && evidenceCount >= 3 && avgScore > 0.5) {
    confidence = 'medium';
    warning = 'Brief quality is acceptable but could be improved';
  } else if (evidenceCount >= 2) {
    confidence = 'low';
    warning = 'Low evidence count or relevance - brief may be incomplete';
  } else {
    confidence = 'low';
    warning = 'Very limited evidence - brief quality is poor';
  }

  return {
    evidenceCount,
    averageRelevanceScore: avgScore,
    hasDenseSearch: hasDense,
    hasSparseSearch: hasSparse,
    confidenceLevel: confidence,
    warningMessage: warning,
  };
}
```

**Modified**: `server/src/services/issue-retrieval.ts`

```typescript
// Add import
import { calculateBriefQuality } from './brief-quality';

// After generating brief (around line 1400)
export async function handleProtocolMessage(...) {
  const brief = await generateBriefInternal(...);

  // Calculate quality metrics
  const quality = calculateBriefQuality(brief);

  logger.info({
    issueId: brief.issueId,
    evidenceCount: quality.evidenceCount,
    avgScore: quality.averageRelevanceScore,
    confidence: quality.confidenceLevel,
  }, 'Brief generated');

  // Attach quality to brief
  return {
    ...brief,
    quality,
  };
}
```

**New Component**: `ui/src/components/BriefQualityBadge.tsx`

```typescript
import React from 'react';
import { Chip, Tooltip, Alert, Box, Typography } from '@mui/material';
import { CheckCircle, Warning, Error as ErrorIcon } from '@mui/icons-material';

interface BriefQualityMetrics {
  evidenceCount: number;
  averageRelevanceScore: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  warningMessage?: string;
}

interface Props {
  quality: BriefQualityMetrics;
}

export function BriefQualityBadge({ quality }: Props) {
  if (quality.confidenceLevel === 'high') {
    return (
      <Tooltip title={`${quality.evidenceCount} evidence items, avg relevance ${quality.averageRelevanceScore.toFixed(2)}`}>
        <Chip
          label="High Quality"
          color="success"
          size="small"
          icon={<CheckCircle />}
        />
      </Tooltip>
    );
  }

  if (quality.confidenceLevel === 'medium') {
    return (
      <Tooltip title={quality.warningMessage || 'Acceptable quality'}>
        <Chip
          label="Medium Quality"
          color="warning"
          size="small"
          icon={<Warning />}
        />
      </Tooltip>
    );
  }

  return (
    <Alert severity="error" icon={<ErrorIcon />}>
      <Box>
        <Typography variant="body2" fontWeight="bold">
          Low quality brief
        </Typography>
        <Typography variant="caption" display="block">
          {quality.warningMessage || 'Limited evidence available'}
        </Typography>
        <Typography variant="caption" display="block">
          Evidence: {quality.evidenceCount} items,
          Avg relevance: {quality.averageRelevanceScore.toFixed(2)}
        </Typography>
      </Box>
    </Alert>
  );
}
```

**Modified**: `ui/src/components/BriefPanelV2.tsx`

```typescript
// Add import
import { BriefQualityBadge } from './BriefQualityBadge';

// Add to brief panel header
function BriefPanelV2({ brief }) {
  return (
    <Paper>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Typography variant="h6">Issue Brief</Typography>
        {brief.quality && <BriefQualityBadge quality={brief.quality} />}
      </Box>

      {/* Rest of brief content */}
    </Paper>
  );
}
```

### Testing Plan

#### Unit Tests

```typescript
// server/src/services/__tests__/brief-quality.test.ts

describe('calculateBriefQuality', () => {
  test('returns high confidence for dense+sparse with good scores', () => {
    const brief = {
      evidence: [
        { score: 0.85, source: 'semantic' },
        { score: 0.80, source: 'semantic' },
        { score: 0.75, source: 'keyword' },
        { score: 0.70, source: 'keyword' },
        { score: 0.65, source: 'semantic' },
      ],
    };

    const quality = calculateBriefQuality(brief);
    expect(quality.confidenceLevel).toBe('high');
    expect(quality.hasDenseSearch).toBe(true);
    expect(quality.hasSparseSearch).toBe(true);
  });

  test('returns low confidence for sparse-only', () => {
    const brief = {
      evidence: [
        { score: 0.60, source: 'keyword' },
        { score: 0.55, source: 'keyword' },
      ],
    };

    const quality = calculateBriefQuality(brief);
    expect(quality.confidenceLevel).toBe('low');
    expect(quality.hasDenseSearch).toBe(false);
  });
});
```

#### Integration Tests

```typescript
// server/src/routes/__tests__/issues.integration.test.ts

describe('POST /issues/:id/brief', () => {
  test('fails with 503 when OPENAI_API_KEY not set', async () => {
    delete process.env.OPENAI_API_KEY;

    const res = await request(app)
      .post('/issues/123/brief')
      .send({ message: 'Test' });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('EMBEDDING_PROVIDER_REQUIRED');
  });

  test('succeeds with quality metrics when provider configured', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';

    const res = await request(app)
      .post('/issues/123/brief')
      .send({ message: 'Test' });

    expect(res.status).toBe(200);
    expect(res.body.quality).toBeDefined();
    expect(res.body.quality.confidenceLevel).toBeOneOf(['high', 'medium', 'low']);
  });
});
```

### Migration Guide

#### For Existing Installations

```bash
# Step 1: Set OPENAI_API_KEY
export OPENAI_API_KEY=sk-your-key-here

# Step 2: Backfill embeddings for existing knowledge
npm run knowledge:backfill

# Step 3: Verify embedding service
curl http://localhost:3000/api/health/embeddings

# Step 4: Restart server
npm run start
```

**Temporary Override** (for testing only):
```bash
# If you must run without embeddings temporarily
export SQUADRAIL_KNOWLEDGE_BACKFILL_ENABLED=false
```

---

## BLOCKER-3: Restrictive Adapter Support

### Current State Analysis

**Affected Files**:
- `server/src/services/issue-protocol-execution.ts:296`

**Current Implementation**:
```typescript
// Lines 290-300
if (recipient.recipientType !== "agent") {
  return { kind: "notify_only" };
}

const agent = await agents.getById(recipient.agentId);

// PROBLEM: Hard-coded whitelist
if (!['claude_local', 'codex_local'].includes(agent.adapterType)) {
  logger.info({ agentId: agent.id, adapterType: agent.adapterType },
    'Skipping unsupported adapter');
  return { kind: "skip_unsupported_adapter" };
}
```

### Problem Statement

**Failure Modes**:
1. **Hard-coded Whitelist**: Only 2 adapters supported, adding new ones requires code changes
2. **Silent Skip**: Agents with unsupported adapters are skipped without user notification
3. **No Capability Declaration**: Adapters don't declare what features they support
4. **Poor Extensibility**: Cannot add new adapters without modifying core execution logic

**Real-World Impact**:
- New adapters (openclaw, cursor, etc.) cannot use protocol features
- Users assign agents with unsupported adapters and wonder why nothing happens
- No UI indication that adapter lacks capability

### Design Options

#### Option A: Fail Fast

**Approach**: Throw error immediately when unsupported adapter is used for protocol.

```typescript
if (!isSupportedForProtocol(agent.adapterType)) {
  logger.error({
    agentId: agent.id,
    adapterType: agent.adapterType
  }, 'Adapter does not support protocol execution');

  // Record protocol violation
  await recordProtocolViolation({
    code: 'UNSUPPORTED_ADAPTER',
    severity: 'high',
    agentId: agent.id,
    details: `Adapter ${agent.adapterType} cannot execute protocol messages`,
  });

  // Escalate to manager or user
  await escalateIssue(agent, 'ADAPTER_NOT_SUPPORTED');

  throw new Error(
    `Adapter ${agent.adapterType} does not support protocol execution. ` +
    `Reassign to agent with claude_local or codex_local adapter.`
  );
}
```

**Pros**:
- Clear immediate feedback
- Forces correct setup

**Cons**:
- Disruptive - breaks existing flows
- May be too strict for gradual rollout

#### Option B: Dynamic Capability Registry (RECOMMENDED)

**Approach**: Each adapter declares capabilities, system checks before dispatching.

```typescript
// NEW: server/src/adapters/capabilities.ts

export interface AdapterCapabilities {
  protocolDispatch: boolean;        // Can execute protocol messages
  heartbeatWakeup: boolean;          // Can wake on heartbeat
  workspaceIsolation: boolean;       // Supports isolated workspaces
  skillInjection: boolean;           // Supports dynamic skill injection
  streamingResponse: boolean;        // Supports streaming responses
  multimodalInput: boolean;          // Supports images, PDFs, etc.
}

export const ADAPTER_CAPABILITIES: Record<string, AdapterCapabilities> = {
  claude_local: {
    protocolDispatch: true,
    heartbeatWakeup: true,
    workspaceIsolation: true,
    skillInjection: true,
    streamingResponse: true,
    multimodalInput: true,
  },
  codex_local: {
    protocolDispatch: true,
    heartbeatWakeup: true,
    workspaceIsolation: true,
    skillInjection: true,
    streamingResponse: true,
    multimodalInput: false,
  },
  cursor: {
    protocolDispatch: false,  // Not yet implemented
    heartbeatWakeup: true,
    workspaceIsolation: false,
    skillInjection: false,
    streamingResponse: true,
    multimodalInput: false,
  },
  openclaw: {
    protocolDispatch: true,   // When implemented
    heartbeatWakeup: true,
    workspaceIsolation: true,
    skillInjection: false,
    streamingResponse: true,
    multimodalInput: false,
  },
};

export function getAdapterCapabilities(adapterType: string): AdapterCapabilities {
  return ADAPTER_CAPABILITIES[adapterType] || {
    // Default: no capabilities
    protocolDispatch: false,
    heartbeatWakeup: false,
    workspaceIsolation: false,
    skillInjection: false,
    streamingResponse: false,
    multimodalInput: false,
  };
}

export function canHandleProtocol(adapterType: string): boolean {
  return getAdapterCapabilities(adapterType).protocolDispatch;
}

export function requireCapability(
  adapterType: string,
  capability: keyof AdapterCapabilities
): void {
  const caps = getAdapterCapabilities(adapterType);
  if (!caps[capability]) {
    throw new Error(
      `Adapter ${adapterType} does not support ${capability}. ` +
      `Choose an adapter with this capability.`
    );
  }
}
```

**Usage**:
```typescript
// issue-protocol-execution.ts
import { canHandleProtocol, getAdapterCapabilities } from '../adapters/capabilities';

// Replace hard-coded check
const capabilities = getAdapterCapabilities(agent.adapterType);

if (!capabilities.protocolDispatch) {
  logger.warn({
    agentId: agent.id,
    adapterType: agent.adapterType,
    capabilities,
  }, 'Adapter does not support protocol dispatch');

  // Create system comment for visibility
  await createSystemComment(issue,
    `⚠️ Agent ${agent.name} (${agent.adapterType}) cannot auto-execute protocol. ` +
    `Manual intervention required or reassign to protocol-capable agent ` +
    `(claude_local, codex_local).`
  );

  return { kind: "skip_unsupported_adapter", reason: 'No protocol support' };
}
```

**Pros**:
- Declarative - easy to add new adapters
- Extensible - supports multiple capability dimensions
- Self-documenting - capabilities visible in code
- Graceful - skips unsupported but notifies user

**Cons**:
- Requires maintaining capability matrix
- Slightly more complex than boolean check

#### Option C: Adapter Interface with Runtime Check

**Approach**: Adapters implement interface methods, check at runtime.

```typescript
// Abstract adapter interface
interface IAdapter {
  canHandleProtocol(): Promise<boolean>;
  canWakeOnHeartbeat(): Promise<boolean>;
  // ... other capability checks
}

// Usage
const adapter = await getAdapterInstance(agent.adapterType);
if (!await adapter.canHandleProtocol()) {
  return { kind: "skip_unsupported_adapter" };
}
```

**Pros**:
- Dynamic - adapters can check runtime conditions
- Type-safe with TypeScript interfaces

**Cons**:
- Requires instantiating adapter just to check
- Slower than static lookup

### Recommended Solution

**OPTION B (Dynamic Capability Registry)**

**Rationale**:
1. **Extensibility**: Easy to add new adapters and capabilities
2. **Clarity**: Capabilities declared in single place
3. **Performance**: Static lookup, no runtime overhead
4. **Graceful Degradation**: Can skip with clear messaging
5. **UI Integration**: Can show capability matrix in agent selection

### Implementation Plan

#### Phase 1: Capability Registry (2 hours)

**New File**: `server/src/adapters/capabilities.ts`

```typescript
/**
 * Adapter capability declarations.
 *
 * Each adapter declares which features it supports.
 * This allows graceful degradation and clear error messages.
 */

export interface AdapterCapabilities {
  /** Can execute protocol messages automatically */
  protocolDispatch: boolean;

  /** Can wake up on heartbeat events */
  heartbeatWakeup: boolean;

  /** Supports isolated workspaces (worktree/clone) */
  workspaceIsolation: boolean;

  /** Supports dynamic skill injection */
  skillInjection: boolean;

  /** Supports streaming responses */
  streamingResponse: boolean;

  /** Supports multimodal input (images, PDFs) */
  multimodalInput: boolean;
}

/**
 * Capability matrix for all adapters.
 *
 * When adding a new adapter:
 * 1. Add entry here with supported capabilities
 * 2. Implement required adapter methods
 * 3. Update UI to show capabilities in agent creation
 */
export const ADAPTER_CAPABILITIES: Record<string, AdapterCapabilities> = {
  claude_local: {
    protocolDispatch: true,
    heartbeatWakeup: true,
    workspaceIsolation: true,
    skillInjection: true,
    streamingResponse: true,
    multimodalInput: true,
  },
  codex_local: {
    protocolDispatch: true,
    heartbeatWakeup: true,
    workspaceIsolation: true,
    skillInjection: true,
    streamingResponse: true,
    multimodalInput: false,  // Codex focused on code only
  },
  cursor: {
    protocolDispatch: false,  // Not yet implemented
    heartbeatWakeup: true,
    workspaceIsolation: false,
    skillInjection: false,
    streamingResponse: true,
    multimodalInput: false,
  },
  openclaw: {
    protocolDispatch: true,   // Planned
    heartbeatWakeup: true,
    workspaceIsolation: true,
    skillInjection: false,
    streamingResponse: true,
    multimodalInput: false,
  },
};

/**
 * Get capabilities for an adapter.
 * Returns default (all false) for unknown adapters.
 */
export function getAdapterCapabilities(adapterType: string): AdapterCapabilities {
  return ADAPTER_CAPABILITIES[adapterType] || {
    protocolDispatch: false,
    heartbeatWakeup: false,
    workspaceIsolation: false,
    skillInjection: false,
    streamingResponse: false,
    multimodalInput: false,
  };
}

/**
 * Check if adapter supports protocol dispatch.
 */
export function canHandleProtocol(adapterType: string): boolean {
  return getAdapterCapabilities(adapterType).protocolDispatch;
}

/**
 * Check if adapter supports heartbeat wakeup.
 */
export function canWakeOnHeartbeat(adapterType: string): boolean {
  return getAdapterCapabilities(adapterType).heartbeatWakeup;
}

/**
 * Require adapter to have specific capability.
 * Throws error if not supported.
 */
export function requireCapability(
  adapterType: string,
  capability: keyof AdapterCapabilities,
  context?: string
): void {
  const caps = getAdapterCapabilities(adapterType);

  if (!caps[capability]) {
    const supportedAdapters = Object.entries(ADAPTER_CAPABILITIES)
      .filter(([_, c]) => c[capability])
      .map(([type]) => type)
      .join(', ');

    throw new Error(
      `Adapter ${adapterType} does not support ${capability}. ` +
      (context ? `${context}. ` : '') +
      `Supported adapters: ${supportedAdapters || 'none'}`
    );
  }
}

/**
 * Get all adapters that support a given capability.
 */
export function getAdaptersWithCapability(
  capability: keyof AdapterCapabilities
): string[] {
  return Object.entries(ADAPTER_CAPABILITIES)
    .filter(([_, caps]) => caps[capability])
    .map(([type]) => type);
}
```

#### Phase 2: Agent Validation (1 hour)

**Modified**: `server/src/services/agents.ts`

```typescript
// Add import
import {
  getAdapterCapabilities,
  requireCapability
} from '../adapters/capabilities';

// Add validation when creating agent
export async function createAgent(params: {
  name: string;
  adapterType: string;
  usageProfile: string;
  // ...
}): Promise<Agent> {
  const { adapterType, usageProfile } = params;

  // Validate adapter capabilities match usage profile requirements
  if (usageProfile === 'implementation' || usageProfile === 'review') {
    // These profiles require protocol dispatch
    try {
      requireCapability(adapterType, 'protocolDispatch',
        `Usage profile ${usageProfile} requires protocol dispatch`);
    } catch (err) {
      throw new Error(
        `Cannot create ${usageProfile} agent with ${adapterType} adapter: ${err.message}`
      );
    }
  }

  // Create agent
  const agent = await db.agents.create(params);

  // Attach capabilities to response
  const capabilities = getAdapterCapabilities(adapterType);

  logger.info({
    agentId: agent.id,
    adapterType,
    capabilities,
  }, 'Created agent with capabilities');

  return { ...agent, capabilities };
}
```

**Modified**: `server/src/services/issue-protocol-execution.ts`

```typescript
// Add import
import { canHandleProtocol, getAdapterCapabilities } from '../adapters/capabilities';

// Replace hard-coded check (around line 296)
const agent = await agents.getById(recipient.agentId);
const capabilities = getAdapterCapabilities(agent.adapterType);

// BEFORE (hard-coded):
// if (!['claude_local', 'codex_local'].includes(agent.adapterType)) {
//   return { kind: "skip_unsupported_adapter" };
// }

// AFTER (capability-based):
if (!capabilities.protocolDispatch) {
  logger.warn({
    agentId: agent.id,
    adapterType: agent.adapterType,
    capabilities,
  }, 'Agent adapter does not support protocol dispatch');

  // Create visible comment for user
  await createSystemComment(issue,
    `⚠️ **Agent ${agent.name} cannot execute automatically**\n\n` +
    `Adapter \`${agent.adapterType}\` does not support protocol auto-dispatch.\n` +
    `Please reassign to an agent with protocol support (claude_local, codex_local) ` +
    `or manually execute this step.`
  );

  return {
    kind: "skip_unsupported_adapter",
    reason: `Adapter ${agent.adapterType} lacks protocol dispatch capability`,
    suggestedAdapters: ['claude_local', 'codex_local'],
  };
}

// Continue with protocol execution
logger.info({ agentId: agent.id }, 'Dispatching protocol message to agent');
```

#### Phase 3: UI Integration (1 hour)

**New Component**: `ui/src/components/AdapterCapabilityBadge.tsx`

```typescript
import React from 'react';
import { Chip, Tooltip, Box, Typography } from '@mui/material';
import { CheckCircle, Cancel } from '@mui/icons-material';

interface AdapterCapabilities {
  protocolDispatch: boolean;
  heartbeatWakeup: boolean;
  workspaceIsolation: boolean;
  skillInjection: boolean;
  streamingResponse: boolean;
  multimodalInput: boolean;
}

interface Props {
  adapterType: string;
  capabilities: AdapterCapabilities;
  highlightCapability?: keyof AdapterCapabilities;
}

export function AdapterCapabilityBadge({
  adapterType,
  capabilities,
  highlightCapability
}: Props) {
  const capabilityLabels: Record<keyof AdapterCapabilities, string> = {
    protocolDispatch: 'Protocol',
    heartbeatWakeup: 'Heartbeat',
    workspaceIsolation: 'Isolation',
    skillInjection: 'Skills',
    streamingResponse: 'Streaming',
    multimodalInput: 'Multimodal',
  };

  const tooltipContent = (
    <Box>
      <Typography variant="caption" fontWeight="bold">
        {adapterType} Capabilities:
      </Typography>
      {Object.entries(capabilities).map(([key, value]) => (
        <Box key={key} display="flex" alignItems="center" gap={0.5}>
          {value ? <CheckCircle fontSize="small" /> : <Cancel fontSize="small" />}
          <Typography variant="caption">
            {capabilityLabels[key as keyof AdapterCapabilities]}
          </Typography>
        </Box>
      ))}
    </Box>
  );

  // Show status of highlighted capability
  if (highlightCapability) {
    const hasCapability = capabilities[highlightCapability];
    return (
      <Tooltip title={tooltipContent}>
        <Chip
          label={capabilityLabels[highlightCapability]}
          color={hasCapability ? 'success' : 'error'}
          size="small"
          icon={hasCapability ? <CheckCircle /> : <Cancel />}
        />
      </Tooltip>
    );
  }

  // Show overall capability count
  const enabledCount = Object.values(capabilities).filter(Boolean).length;
  const totalCount = Object.keys(capabilities).length;

  return (
    <Tooltip title={tooltipContent}>
      <Chip
        label={`${enabledCount}/${totalCount} capabilities`}
        color={enabledCount === totalCount ? 'success' : 'warning'}
        size="small"
      />
    </Tooltip>
  );
}
```

**Modified**: `ui/src/components/NewAgentDialog.tsx`

```typescript
// Add import
import { AdapterCapabilityBadge } from './AdapterCapabilityBadge';

// Add to adapter selection
function AdapterSelector({ value, onChange, usageProfile }) {
  const adapters = [
    { type: 'claude_local', name: 'Claude Local' },
    { type: 'codex_local', name: 'Codex Local' },
    { type: 'cursor', name: 'Cursor' },
    { type: 'openclaw', name: 'OpenClaw' },
  ];

  // Fetch capabilities from API
  const { data: capabilitiesMap } = useQuery('/api/adapters/capabilities');

  return (
    <FormControl>
      <InputLabel>Adapter Type</InputLabel>
      <Select value={value} onChange={onChange}>
        {adapters.map(adapter => {
          const caps = capabilitiesMap?.[adapter.type];
          const isCompatible = usageProfile === 'implementation'
            ? caps?.protocolDispatch
            : true;

          return (
            <MenuItem
              key={adapter.type}
              value={adapter.type}
              disabled={!isCompatible}
            >
              <Box display="flex" justifyContent="space-between" width="100%">
                <Typography>{adapter.name}</Typography>
                {caps && (
                  <AdapterCapabilityBadge
                    adapterType={adapter.type}
                    capabilities={caps}
                    highlightCapability={usageProfile === 'implementation' ? 'protocolDispatch' : undefined}
                  />
                )}
              </Box>
              {!isCompatible && (
                <Typography variant="caption" color="error">
                  Not compatible with {usageProfile} profile
                </Typography>
              )}
            </MenuItem>
          );
        })}
      </Select>
    </FormControl>
  );
}
```

**New API Route**: `server/src/routes/adapters.ts`

```typescript
import express from 'express';
import { ADAPTER_CAPABILITIES } from '../adapters/capabilities';

const router = express.Router();

/**
 * GET /api/adapters/capabilities
 * Returns capability matrix for all adapters.
 */
router.get('/capabilities', async (req, res) => {
  res.json(ADAPTER_CAPABILITIES);
});

/**
 * GET /api/adapters/:type/capabilities
 * Returns capabilities for specific adapter.
 */
router.get('/:type/capabilities', async (req, res) => {
  const { type } = req.params;
  const capabilities = ADAPTER_CAPABILITIES[type];

  if (!capabilities) {
    return res.status(404).json({
      error: 'ADAPTER_NOT_FOUND',
      message: `Adapter ${type} not found`,
    });
  }

  res.json(capabilities);
});

export default router;
```

### Testing Plan

#### Unit Tests

```typescript
// server/src/adapters/__tests__/capabilities.test.ts

describe('Adapter Capabilities', () => {
  test('canHandleProtocol returns true for claude_local', () => {
    expect(canHandleProtocol('claude_local')).toBe(true);
  });

  test('canHandleProtocol returns false for cursor', () => {
    expect(canHandleProtocol('cursor')).toBe(false);
  });

  test('requireCapability throws for unsupported capability', () => {
    expect(() => {
      requireCapability('cursor', 'protocolDispatch');
    }).toThrow('does not support protocolDispatch');
  });

  test('getAdaptersWithCapability returns correct adapters', () => {
    const adapters = getAdaptersWithCapability('protocolDispatch');
    expect(adapters).toContain('claude_local');
    expect(adapters).toContain('codex_local');
    expect(adapters).not.toContain('cursor');
  });
});
```

#### Integration Tests

```typescript
// server/src/services/__tests__/issue-protocol-execution.integration.test.ts

describe('Protocol Execution with Capabilities', () => {
  test('skips execution for unsupported adapter', async () => {
    const agent = await createAgent({
      name: 'Test Agent',
      adapterType: 'cursor',  // No protocol support
      usageProfile: 'implementation',
    });

    // Should fail due to capability check
    await expect(createAgent(...)).rejects.toThrow(
      'Usage profile implementation requires protocol dispatch'
    );
  });

  test('creates system comment when skipping unsupported adapter', async () => {
    // Create agent with non-protocol adapter (force creation)
    const agent = await db.agents.create({
      adapterType: 'cursor',
      // ...
    });

    const issue = await createIssue({ assignedAgentId: agent.id });

    // Attempt protocol execution
    const result = await executeProtocolStep(issue, agent);

    expect(result.kind).toBe('skip_unsupported_adapter');

    // Check system comment was created
    const comments = await getIssueComments(issue.id);
    expect(comments.some(c =>
      c.type === 'system' &&
      c.content.includes('cannot execute automatically')
    )).toBe(true);
  });
});
```

### Migration Guide

#### For Existing Installations

**No breaking changes** - existing agents continue to work.

**Optional enhancements**:

1. **Add capability checks to agent creation**:
```typescript
// Prevent creating incompatible agents
if (usageProfile === 'implementation') {
  requireCapability(adapterType, 'protocolDispatch');
}
```

2. **Audit existing agents**:
```bash
npm run agents:audit-capabilities
```

**Script**: `scripts/audit-agent-capabilities.ts`

```typescript
export async function auditAgentCapabilities() {
  const agents = await db.agents.findAll();

  const results = agents.map(agent => {
    const caps = getAdapterCapabilities(agent.adapterType);
    const issues = {
      noProtocol: agent.usageProfile === 'implementation' && !caps.protocolDispatch,
      noIsolation: agent.usageProfile === 'implementation' && !caps.workspaceIsolation,
    };

    return {
      agentId: agent.id,
      name: agent.name,
      adapterType: agent.adapterType,
      usageProfile: agent.usageProfile,
      capabilities: caps,
      issues,
    };
  });

  // Report agents with capability mismatches
  const problematic = results.filter(r =>
    r.issues.noProtocol || r.issues.noIsolation
  );

  if (problematic.length > 0) {
    console.log('⚠️ Agents with capability issues:');
    console.table(problematic);
  }

  return results;
}
```

---

## Cross-Cutting Concerns

### Error Handling Strategy

All three blockers share a common pattern: **fail fast with actionable errors**.

```typescript
// Standardized error response
interface BlockerError {
  code: string;
  message: string;
  hint: string;
  docs?: string;
}

// Example
{
  code: 'WORKSPACE_INVALID',
  message: 'Agent workspace /path/to/workspace does not exist',
  hint: 'Check project setup or recreate workspace',
  docs: 'https://docs.squadrail.dev/troubleshooting/workspaces'
}
```

### Logging Standards

```typescript
// Structured logging for all blockers
logger.error({
  blocker: 'WORKSPACE_INVALID',
  agentId: agent.id,
  issueId: issue.id,
  workspacePath: workspace.cwd,
  errorCode: 'CWD_NOT_FOUND',
}, 'Workspace validation failed');
```

### Monitoring & Alerts

```typescript
// Metrics to track blocker frequency
metrics.increment('blocker.workspace.invalid');
metrics.increment('blocker.rag.provider_missing');
metrics.increment('blocker.adapter.unsupported');

// Alert thresholds
if (blockerRate > 0.1) {
  alert('High blocker rate detected - check system health');
}
```

---

## Implementation Timeline

### Phase 1: Core Changes (Day 1)

**Morning (4 hours)**:
- BLOCKER-1: Workspace validation + enforcement
- BLOCKER-2: Default change + provider validation

**Afternoon (3 hours)**:
- BLOCKER-3: Capability registry + agent validation
- Testing: Unit tests for all three

**Deliverable**: Core validation logic working, tests passing

### Phase 2: Integration & UI (Day 2)

**Morning (3.5 hours)**:
- BLOCKER-1: UI workspace alerts
- BLOCKER-2: Quality metrics + badges
- BLOCKER-3: UI capability display

**Afternoon (3 hours)**:
- Integration tests
- Migration scripts
- Documentation updates

**Deliverable**: Full implementation with UI, ready for review

### Total Time Breakdown

```
BLOCKER-1: 6 hours
  - Validation: 2h
  - Enforcement: 3h
  - UI: 1h

BLOCKER-2: 3.5 hours
  - Config: 0.5h
  - Middleware: 1h
  - Metrics: 2h

BLOCKER-3: 4 hours
  - Registry: 2h
  - Validation: 1h
  - UI: 1h

TOTAL: 13.5 hours (~2 days)
```

---

## Risk Analysis

### Breaking Changes

1. **Workspace Requirement**:
   - **Risk**: Existing agents without valid workspaces fail
   - **Mitigation**: Migration script to validate/fix workspaces
   - **Rollback**: Feature flag to disable strict mode

2. **OPENAI_API_KEY Requirement**:
   - **Risk**: Installations without key cannot generate briefs
   - **Mitigation**: Clear error messages, setup docs
   - **Rollback**: Allow disabling with env var

3. **Adapter Validation**:
   - **Risk**: Agents with unsupported adapters cannot use protocol
   - **Mitigation**: Graceful skip with notifications
   - **Rollback**: No rollback needed (non-breaking)

### Deployment Strategy

```
1. Stage 1: Deploy with feature flags OFF
   - Validate deployment
   - Monitor metrics

2. Stage 2: Enable for canary group (10% users)
   - Monitor error rates
   - Collect feedback

3. Stage 3: Gradual rollout (50% → 100%)
   - Continue monitoring
   - Adjust thresholds

4. Stage 4: Make default, deprecate flags
   - Update docs
   - Remove old code paths
```

---

## Success Criteria

### BLOCKER-1: Workspace

**Metrics**:
- ✅ 0% agents executing in wrong workspace
- ✅ 100% workspace validation before execution
- ✅ <1% workspace setup errors

**Validation**:
- All heartbeats execute in correct workspace
- No files created in agent home
- UI shows workspace status accurately

### BLOCKER-2: RAG Quality

**Metrics**:
- ✅ 100% briefs have embeddings enabled
- ✅ Average brief quality ≥ 0.8
- ✅ 90%+ briefs have dense+sparse search

**Validation**:
- All protocol briefs include semantic search
- Quality badges display correctly
- Low-quality briefs caught before agent dispatch

### BLOCKER-3: Adapter Extensibility

**Metrics**:
- ✅ Capability registry covers all adapters
- ✅ 0% silent skips (all have notifications)
- ✅ UI shows capabilities on agent creation

**Validation**:
- New adapters can be added without code changes
- Unsupported adapters create visible comments
- Users cannot create incompatible agent configs

---

## Appendix: File Changes Summary

### New Files

```
server/src/services/workspace-validator.ts           (120 lines)
server/src/middleware/require-embeddings.ts          (60 lines)
server/src/services/brief-quality.ts                 (80 lines)
server/src/adapters/capabilities.ts                  (150 lines)
server/src/routes/adapters.ts                        (40 lines)
ui/src/components/WorkspaceStatusAlert.tsx           (70 lines)
ui/src/components/BriefQualityBadge.tsx              (80 lines)
ui/src/components/AdapterCapabilityBadge.tsx         (90 lines)
scripts/migrate-workspaces.ts                        (100 lines)
scripts/audit-agent-capabilities.ts                  (60 lines)
```

### Modified Files

```
server/src/config.ts                                 (+5 lines)
server/src/services/heartbeat-workspace.ts           (+20 lines)
server/src/services/project-workspace-routing.ts     (+40 lines)
server/src/services/issue-retrieval.ts               (+15 lines)
server/src/services/agents.ts                        (+25 lines)
server/src/services/issue-protocol-execution.ts      (+20 lines)
server/src/routes/issues.ts                          (+10 lines)
ui/src/pages/IssueDetail.tsx                         (+15 lines)
ui/src/components/BriefPanelV2.tsx                   (+10 lines)
ui/src/components/NewAgentDialog.tsx                 (+40 lines)
.env.example                                         (+5 lines)
```

**Total New Code**: ~850 lines
**Total Modified Code**: ~205 lines
**Total Impact**: ~1055 lines across 21 files

---

## Next Steps

1. **Review this design** with team
2. **Prioritize blockers** (recommendation: implement in order 1→2→3)
3. **Create implementation tasks** in issue tracker
4. **Assign engineers** to each blocker
5. **Set up feature flags** for gradual rollout
6. **Prepare migration docs** for users
7. **Schedule testing window** for validation

---

**END OF DESIGN DOCUMENT**
