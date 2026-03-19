import path from "node:path";
import { access, readFile, readdir } from "node:fs/promises";

async function listFilesRecursive(rootPath) {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(entryPath);
      }
      return [entryPath];
    }),
  );
  return files.flat();
}

export function resolveCloseWakeRoots(homeRoot) {
  return [
    path.join(homeRoot, "instances"),
    path.join(homeRoot, "home", "instances"),
  ];
}

function hasCloseWakeReason(content) {
  return (
    content.includes("SQUADRAIL_WAKE_REASON=issue_ready_for_closure")
    || content.includes("wakeReason: issue_ready_for_closure")
    || content.includes("\"wakeReason\":\"issue_ready_for_closure\"")
  );
}

function hasIssueReference(content, issueId) {
  if (!issueId) return true;
  return (
    content.includes(issueId)
    || content.includes(`- issueId: ${issueId}`)
    || content.includes(`\"issueId\":\"${issueId}\"`)
  );
}

export async function findCloseWakeEvidence(homeRoot, issueId) {
  for (const rootPath of resolveCloseWakeRoots(homeRoot)) {
    try {
      await access(rootPath);
    } catch {
      continue;
    }

    const candidateFiles = (await listFilesRecursive(rootPath))
      .filter((filePath) => filePath.endsWith(".sh") || filePath.endsWith(".jsonl"));

    for (const filePath of candidateFiles) {
      const content = await readFile(filePath, "utf8").catch(() => "");
      if (!content) continue;
      if (hasCloseWakeReason(content) && hasIssueReference(content, issueId)) {
        return { matched: true, path: filePath };
      }
    }
  }

  return { matched: false, path: null };
}
