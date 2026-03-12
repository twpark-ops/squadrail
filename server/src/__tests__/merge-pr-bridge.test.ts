import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectMergePrBridgeRemote,
  syncMergePrBridge,
} from "../services/merge-pr-bridge.js";

describe("merge PR bridge remote detection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.SQUADRAIL_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.SQUADRAIL_GITLAB_TOKEN;
    delete process.env.GITLAB_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses GitHub HTTPS remotes", () => {
    const remote = detectMergePrBridgeRemote("https://github.com/acme/swiftsight.git");

    expect(remote).toEqual(
      expect.objectContaining({
        provider: "github",
        repoOwner: "acme",
        repoName: "swiftsight",
        repoPath: "acme/swiftsight",
        repoUrl: "https://github.com/acme/swiftsight",
      }),
    );
  });

  it("parses GitLab SSH remotes with nested groups", () => {
    const remote = detectMergePrBridgeRemote("git@gitlab.example.com:platform/backend/swiftsight.git");

    expect(remote).toEqual(
      expect.objectContaining({
        provider: "gitlab",
        repoOwner: "platform/backend",
        repoName: "swiftsight",
        repoPath: "platform/backend/swiftsight",
        repoUrl: "https://gitlab.example.com/platform/backend/swiftsight",
      }),
    );
  });

  it("returns null for unsupported remotes", () => {
    expect(detectMergePrBridgeRemote("https://bitbucket.org/acme/swiftsight.git")).toBeNull();
  });

  it("rejects sync for unsupported remotes", async () => {
    await expect(
      syncMergePrBridge({
        remoteUrl: "https://bitbucket.org/acme/swiftsight.git",
        baseBranch: "main",
        headBranch: "squadrail/clo-42",
        headSha: null,
        title: "CLO-42 unsupported bridge",
        body: "Unsupported remote",
        existing: null,
      }),
    ).rejects.toThrow("Unsupported PR bridge remote");
  });

  it("requires provider tokens before attempting a GitHub sync", async () => {
    await expect(
      syncMergePrBridge({
        remoteUrl: "https://github.com/acme/swiftsight.git",
        baseBranch: "main",
        headBranch: "squadrail/clo-42",
        headSha: null,
        title: "CLO-42 missing token",
        body: "Missing token",
        existing: null,
      }),
    ).rejects.toThrow("GitHub PR bridge requires SQUADRAIL_GITHUB_TOKEN or GITHUB_TOKEN");
  });

  it("syncs GitHub draft PRs and normalizes checks from API responses", async () => {
    process.env.SQUADRAIL_GITHUB_TOKEN = "github-token";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        number: 42,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 1042,
        number: 42,
        html_url: "https://github.com/acme/swiftsight/pull/42",
        title: "Draft: CLO-42 PR bridge",
        state: "open",
        draft: true,
        mergeable_state: "blocked",
        mergeable: false,
        comments: 3,
        review_comments: 2,
        head: {
          ref: "squadrail/clo-42",
          sha: "abc42",
        },
        base: {
          ref: "main",
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { state: "COMMENTED" },
        { state: "APPROVED" },
      ]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        check_runs: [
          {
            name: "pr-verify",
            status: "completed",
            conclusion: "success",
            details_url: "https://github.com/acme/swiftsight/actions/runs/1",
            output: {
              title: "PR verify passed",
            },
          },
          {
            name: "lint",
            status: "completed",
            conclusion: "failure",
            details_url: "https://github.com/acme/swiftsight/actions/runs/2",
            output: {
              summary: "Lint failed",
            },
          },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        statuses: [
          {
            context: "deploy-preview",
            state: "pending",
            description: "Preview deploy is running",
            target_url: "https://github.com/acme/swiftsight/deployments/1",
          },
          {
            context: "pr-verify",
            state: "success",
            description: "Duplicate context should dedupe",
            target_url: "https://github.com/acme/swiftsight/actions/runs/1",
          },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        contexts: ["deploy-preview"],
        checks: [{ context: "pr-verify" }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncMergePrBridge({
      remoteUrl: "https://github.com/acme/swiftsight.git",
      baseBranch: "main",
      headBranch: "squadrail/clo-42",
      headSha: null,
      title: "CLO-42 PR bridge",
      body: "Draft PR body",
      existing: null,
    });

    expect(result).toMatchObject({
      provider: "github",
      repoOwner: "acme",
      repoName: "swiftsight",
      number: 42,
      externalId: "1042",
      url: "https://github.com/acme/swiftsight/pull/42",
      state: "draft",
      mergeability: "blocked",
      headBranch: "squadrail/clo-42",
      baseBranch: "main",
      headSha: "abc42",
      reviewDecision: "approved",
      commentCount: 3,
      reviewCommentCount: 2,
    });
    expect(result.checks).toEqual([
      expect.objectContaining({
        name: "pr-verify",
        status: "success",
        required: true,
      }),
      expect.objectContaining({
        name: "lint",
        status: "failure",
        required: false,
      }),
      expect.objectContaining({
        name: "deploy-preview",
        status: "pending",
        required: true,
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("syncs GitLab merge requests and normalizes pipeline jobs", async () => {
    process.env.SQUADRAIL_GITLAB_TOKEN = "gitlab-token";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 700,
        iid: 7,
        web_url: "https://gitlab.example.com/platform/backend/swiftsight/-/merge_requests/7",
        title: "Draft: CLO-7 MR bridge",
        state: "opened",
        draft: true,
        detailed_merge_status: "ci_must_pass",
        source_branch: "squadrail/clo-7",
        target_branch: "main",
        diff_refs: {
          head_sha: "gitlabsha7",
        },
        head_pipeline: {
          id: 17,
        },
        blocking_discussions_resolved: true,
        user_notes_count: 5,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 700,
        iid: 7,
        web_url: "https://gitlab.example.com/platform/backend/swiftsight/-/merge_requests/7",
        title: "Draft: CLO-7 MR bridge",
        state: "opened",
        draft: true,
        detailed_merge_status: "ci_must_pass",
        source_branch: "squadrail/clo-7",
        target_branch: "main",
        diff_refs: {
          head_sha: "gitlabsha7",
        },
        head_pipeline: {
          id: 17,
        },
        blocking_discussions_resolved: true,
        user_notes_count: 5,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          name: "gitlab-ci",
          status: "success",
          stage: "test",
          web_url: "https://gitlab.example.com/pipelines/17/jobs/1",
        },
      ]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncMergePrBridge({
      remoteUrl: "git@gitlab.example.com:platform/backend/swiftsight.git",
      baseBranch: "main",
      headBranch: "squadrail/clo-7",
      headSha: null,
      title: "CLO-7 MR bridge",
      body: "Draft MR body",
      existing: {
        number: 7,
      },
    });

    expect(result).toMatchObject({
      provider: "gitlab",
      repoOwner: "platform/backend",
      repoName: "swiftsight",
      number: 7,
      externalId: "700",
      state: "draft",
      mergeability: "blocked",
      headBranch: "squadrail/clo-7",
      baseBranch: "main",
      headSha: "gitlabsha7",
      reviewDecision: "approved",
      commentCount: 5,
    });
    expect(result.checks).toEqual([
      expect.objectContaining({
        name: "gitlab-ci",
        status: "success",
        summary: "test",
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
