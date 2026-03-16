import { describe, it, expect } from "vitest";

/**
 * Tests the buildIssueTree logic used by IssuesList to group parent-child issues.
 */

interface MinimalIssue {
  id: string;
  parentId: string | null;
  title: string;
}

function buildIssueTree(issues: MinimalIssue[]): Array<{ issue: MinimalIssue; children: MinimalIssue[] }> {
  const childMap = new Map<string, MinimalIssue[]>();
  const roots: MinimalIssue[] = [];
  const issueById = new Map(issues.map((i) => [i.id, i]));

  for (const issue of issues) {
    if (issue.parentId && issueById.has(issue.parentId)) {
      const siblings = childMap.get(issue.parentId) ?? [];
      siblings.push(issue);
      childMap.set(issue.parentId, siblings);
    } else {
      roots.push(issue);
    }
  }

  return roots.map((root) => ({
    issue: root,
    children: childMap.get(root.id) ?? [],
  }));
}

describe("buildIssueTree", () => {
  it("returns flat list when no parent-child relationships exist", () => {
    const issues: MinimalIssue[] = [
      { id: "a", parentId: null, title: "A" },
      { id: "b", parentId: null, title: "B" },
    ];
    const tree = buildIssueTree(issues);
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(0);
    expect(tree[1].children).toHaveLength(0);
  });

  it("nests children under their parent", () => {
    const issues: MinimalIssue[] = [
      { id: "parent", parentId: null, title: "Parent" },
      { id: "child1", parentId: "parent", title: "Child 1" },
      { id: "child2", parentId: "parent", title: "Child 2" },
    ];
    const tree = buildIssueTree(issues);
    expect(tree).toHaveLength(1);
    expect(tree[0].issue.id).toBe("parent");
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children.map((c) => c.id)).toEqual(["child1", "child2"]);
  });

  it("treats orphaned children (parent not in list) as roots", () => {
    const issues: MinimalIssue[] = [
      { id: "orphan", parentId: "missing-parent", title: "Orphan" },
      { id: "root", parentId: null, title: "Root" },
    ];
    const tree = buildIssueTree(issues);
    expect(tree).toHaveLength(2);
    expect(tree[0].issue.id).toBe("orphan");
    expect(tree[1].issue.id).toBe("root");
  });

  it("handles empty input", () => {
    expect(buildIssueTree([])).toHaveLength(0);
  });

  it("supports multiple parent-child groups", () => {
    const issues: MinimalIssue[] = [
      { id: "p1", parentId: null, title: "Parent 1" },
      { id: "p2", parentId: null, title: "Parent 2" },
      { id: "c1", parentId: "p1", title: "Child of P1" },
      { id: "c2", parentId: "p2", title: "Child of P2" },
      { id: "c3", parentId: "p1", title: "Another child of P1" },
    ];
    const tree = buildIssueTree(issues);
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[1].children).toHaveLength(1);
  });

  it("does not include children as separate root entries", () => {
    const issues: MinimalIssue[] = [
      { id: "parent", parentId: null, title: "Parent" },
      { id: "child", parentId: "parent", title: "Child" },
    ];
    const tree = buildIssueTree(issues);
    const rootIds = tree.map((t) => t.issue.id);
    expect(rootIds).not.toContain("child");
  });
});
