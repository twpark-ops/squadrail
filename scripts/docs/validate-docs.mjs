import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const docsRoot = path.join(repoRoot, "docs");

const allowedTopLevelDocsFiles = new Set([
  "AGENTS.md",
  "DESIGN.md",
  "FRONTEND.md",
  "PLANS.md",
  "PRODUCT_SENSE.md",
  "QUALITY_SCORE.md",
  "RELIABILITY.md",
  "SECURITY.md",
  "docs.json",
  "favicon.svg",
  "next-session-handoff.md",
  "review-findings-2026-03-18.md",
]);

const markdownFiles = [];

function walkMarkdown(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdown(fullPath);
      continue;
    }
    if (/\.(md|mdx)$/i.test(entry.name)) {
      markdownFiles.push(fullPath);
    }
  }
}

function collectMarkdownInputs() {
  for (const file of ["README.md", "ARCHITECTURE.md", "AGENTS.md"]) {
    const fullPath = path.join(repoRoot, file);
    if (fs.existsSync(fullPath)) {
      markdownFiles.push(fullPath);
    }
  }
  walkMarkdown(docsRoot);
}

function validateTopLevelDocsRoot() {
  const invalid = [];
  for (const entry of fs.readdirSync(docsRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      continue;
    }
    if (!allowedTopLevelDocsFiles.has(entry.name)) {
      invalid.push(entry.name);
    }
  }

  if (invalid.length > 0) {
    throw new Error(
      [
        "docs/ root contains unexpected files.",
        "Move plan/spec/design docs into subdirectories before merging.",
        ...invalid.map((name) => `- ${name}`),
      ].join("\n"),
    );
  }
}

function validateDocsJsonPages() {
  const docsJson = JSON.parse(
    fs.readFileSync(path.join(docsRoot, "docs.json"), "utf8"),
  );
  const pages = [];

  for (const tab of docsJson.navigation?.tabs ?? []) {
    for (const group of tab.groups ?? []) {
      for (const page of group.pages ?? []) {
        pages.push(page);
      }
    }
  }

  const missing = pages.filter((page) => {
    return !fs.existsSync(path.join(docsRoot, `${page}.md`)) &&
      !fs.existsSync(path.join(docsRoot, `${page}.mdx`));
  });

  if (missing.length > 0) {
    throw new Error(
      [
        "docs.json references missing pages.",
        ...missing.map((page) => `- ${page}`),
      ].join("\n"),
    );
  }
}

function validateMarkdownLinks() {
  const broken = [];
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;

  for (const file of markdownFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(linkPattern)) {
      let target = match[1].trim();
      if (
        target.length === 0 ||
        target.startsWith("http://") ||
        target.startsWith("https://") ||
        target.startsWith("mailto:") ||
        target.startsWith("#")
      ) {
        continue;
      }

      // Ignore Mintlify route links like /api/overview or /adapters/overview.
      if (target.startsWith("/") && !target.startsWith(repoRoot)) {
        continue;
      }

      target = target.split("#")[0];
      if (target.length === 0) {
        continue;
      }

      const resolved = target.startsWith("/")
        ? target
        : path.resolve(path.dirname(file), target);

      if (!fs.existsSync(resolved)) {
        broken.push(`${path.relative(repoRoot, file)} -> ${match[1]}`);
      }
    }
  }

  if (broken.length > 0) {
    throw new Error(
      [
        "Broken local markdown links detected.",
        ...broken.map((entry) => `- ${entry}`),
      ].join("\n"),
    );
  }
}

try {
  collectMarkdownInputs();
  validateTopLevelDocsRoot();
  validateDocsJsonPages();
  validateMarkdownLinks();
  console.log(`docs:check passed (${markdownFiles.length} markdown files)`);
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(1);
}
