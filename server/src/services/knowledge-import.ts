import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Db } from "@squadrail/db";
import { logActivity } from "./activity-log.js";
import { knowledgeEmbeddingService } from "./knowledge-embeddings.js";
import { knowledgeService } from "./knowledge.js";
import { projectService } from "./projects.js";

const runtimeRequire = createRequire(import.meta.url);

const DEFAULT_ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".md",
  ".mdx",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
]);

const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  ".serena",
]);

const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_MAX_FILES = 100;
const DEFAULT_CHUNK_LINE_COUNT = 120;
const DEFAULT_CHUNK_OVERLAP = 20;
const DEFAULT_MARKDOWN_CHUNK_LINE_COUNT = 80;
const DEFAULT_SECRET_FILE_PATTERNS = [
  /^\.env(\..+)?$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /\.(pem|key|p12|pfx)$/i,
];
const SECRET_CONTENT_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|access[_-]?key|secret(?:[_-]?key)?|password|token)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
];

type WorkspaceDocumentDescriptor = {
  sourceType: string;
  language: string;
  title: string;
  tags: string[];
  metadata: Record<string, unknown>;
};

type WorkspaceChunkInput = {
  chunkIndex: number;
  headingPath: string | null;
  symbolName: string | null;
  tokenCount: number;
  textContent: string;
  searchText: string;
  metadata: Record<string, unknown>;
};

type AstSymbolChunk = {
  symbolName: string | null;
  symbolKind: string;
  lineStart: number;
  lineEnd: number;
  exported: boolean;
};

type StructuredSymbolChunk = AstSymbolChunk & {
  parser: string;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function inferLanguageFromPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".py":
      return "python";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    case ".java":
      return "java";
    case ".kt":
      return "kotlin";
    case ".swift":
      return "swift";
    case ".rb":
      return "ruby";
    case ".php":
      return "php";
    case ".md":
    case ".mdx":
      return "markdown";
    case ".json":
      return "json";
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".toml":
      return "toml";
    case ".sql":
      return "sql";
    case ".sh":
    case ".bash":
    case ".zsh":
      return "shell";
    default:
      return ext.replace(/^\./, "") || "text";
  }
}

function isMarkdownLanguage(language: string) {
  return language === "markdown";
}

function isCodeLanguage(language: string) {
  return !["markdown", "json", "yaml", "toml", "text"].includes(language);
}

function isTypeScriptFamilyLanguage(language: string) {
  return language === "typescript" || language === "javascript";
}

function isTestFilePath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const base = path.posix.basename(normalized);
  return (
    normalized.includes("/__tests__/")
    || normalized.includes("/tests/")
    || normalized.includes("/test/")
    || /\.(test|spec)\.[a-z0-9]+$/i.test(base)
    || /_test\.[a-z0-9]+$/i.test(base)
    || /^test_[a-z0-9_.-]+\.[a-z0-9]+$/i.test(base)
  );
}

function classifyMarkdownSourceType(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const base = path.posix.basename(normalized);
  if (normalized.includes("/adr/") || /^adr[-_ ]?\d+/i.test(base)) return "adr";
  if (
    normalized.includes("/prd/")
    || normalized.includes("/requirements/")
    || normalized.includes("/product/")
    || base.includes("prd")
  ) {
    return "prd";
  }
  if (
    normalized.includes("/runbook/")
    || normalized.includes("/playbook/")
    || normalized.includes("/ops/")
    || normalized.includes("/operations/")
  ) {
    return "runbook";
  }
  if (normalized.includes("/qa/") || normalized.includes("/test-plan/") || base.includes("test-plan")) {
    return "test_report";
  }
  return "runbook";
}

export function classifyWorkspaceDocument(input: {
  relativePath: string;
  content: string;
  language?: string;
}) {
  const normalized = input.relativePath.replace(/\\/g, "/");
  const language = input.language ?? inferLanguageFromPath(normalized);
  const segments = normalized.split("/").filter(Boolean);
  const fileName = path.posix.basename(normalized);
  const parentDir = segments.length > 1 ? segments[segments.length - 2] : "";
  const isTestFile = isTestFilePath(normalized);
  const sourceType = isMarkdownLanguage(language)
    ? classifyMarkdownSourceType(normalized)
    : isTestFile
      ? "test_report"
      : "code";
  const tags = Array.from(new Set([
    language,
    sourceType,
    ...(isTestFile ? ["test"] : []),
    ...segments.slice(0, Math.min(segments.length, 4)),
    parentDir,
    fileName.replace(/\.[^.]+$/, ""),
  ].filter(Boolean)));

  return {
    sourceType,
    language,
    title: fileName,
    tags,
    metadata: {
      pathSegments: segments,
      fileName,
      parentDir: parentDir || null,
      isTestFile,
      isLatestForScope: true,
      tags,
    },
  } satisfies WorkspaceDocumentDescriptor;
}

export function shouldIncludeWorkspacePath(input: {
  relativePath: string;
  allowedExtensions?: Set<string>;
  ignoredDirs?: Set<string>;
}) {
  const normalized = input.relativePath.split(path.sep).join("/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => (input.ignoredDirs ?? DEFAULT_IGNORED_DIRS).has(segment))) return false;
  const ext = path.extname(normalized).toLowerCase();
  return (input.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS).has(ext);
}

export function detectWorkspaceSecret(input: {
  relativePath: string;
  content: string;
}) {
  const normalizedPath = input.relativePath.split(path.sep).join("/");
  const baseName = path.posix.basename(normalizedPath);
  if (DEFAULT_SECRET_FILE_PATTERNS.some((pattern) => pattern.test(baseName))) {
    return {
      reason: "sensitive_file_name",
      pattern: baseName,
    };
  }

  for (const pattern of SECRET_CONTENT_PATTERNS) {
    const match = input.content.match(pattern);
    if (match) {
      return {
        reason: "sensitive_content",
        pattern: match[0].slice(0, 48),
      };
    }
  }

  return null;
}

function parseAllowedWorkspaceRoots() {
  return (process.env.SQUADRAIL_ALLOWED_WORKSPACE_ROOTS ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function resolveWorkspaceImportRoot(input: {
  cwd: string;
  allowedRoots?: string[];
}) {
  if (!path.isAbsolute(input.cwd)) {
    throw new Error("Workspace cwd must be an absolute path");
  }

  const resolvedRoot = await realpath(input.cwd);
  const stats = await stat(resolvedRoot);
  if (!stats.isDirectory()) {
    throw new Error("Workspace cwd must resolve to a directory");
  }

  const allowedRoots = input.allowedRoots ?? parseAllowedWorkspaceRoots();
  if (allowedRoots.length > 0) {
    const resolvedAllowedRoots = await Promise.all(
      allowedRoots.map((entry) => realpath(entry).catch(() => null)),
    );
    const normalizedAllowedRoots = resolvedAllowedRoots.filter((entry): entry is string => Boolean(entry));
    const allowed = normalizedAllowedRoots.some((allowedRoot) => {
      const relative = path.relative(allowedRoot, resolvedRoot);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    });
    if (!allowed) {
      throw new Error("Workspace cwd is outside allowed workspace roots");
    }
  }

  return resolvedRoot;
}

function estimateTokenCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function detectChunkSymbol(text: string) {
  const patterns = [
    /^\s*export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/m,
    /^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)/m,
    /^\s*export\s+(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=/m,
    /^\s*(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/m,
    /^\s*export\s+class\s+([A-Za-z0-9_]+)/m,
    /^\s*class\s+([A-Za-z0-9_]+)/m,
    /^\s*export\s+interface\s+([A-Za-z0-9_]+)/m,
    /^\s*interface\s+([A-Za-z0-9_]+)/m,
    /^\s*export\s+type\s+([A-Za-z0-9_]+)/m,
    /^\s*type\s+([A-Za-z0-9_]+)/m,
    /^\s*def\s+([A-Za-z0-9_]+)/m,
    /^\s*class\s+([A-Za-z0-9_]+)/m,
    /^\s*func\s+(?:\([^)]+\)\s*)?([A-Za-z0-9_]+)/m,
    /^\s*fn\s+([A-Za-z0-9_]+)/m,
    /^\s*struct\s+([A-Za-z0-9_]+)/m,
    /^\s*enum\s+([A-Za-z0-9_]+)/m,
    /^\s*protocol\s+([A-Za-z0-9_]+)/m,
    /^\s*extension\s+([A-Za-z0-9_]+)/m,
    /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|TABLE)\s+([A-Za-z0-9_]+)/im,
    /^\s*(?:function\s+)?([A-Za-z0-9_]+)\s*\(\)\s*\{/m,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

let cachedTypeScriptCompiler: any | undefined;

function getTypeScriptCompiler() {
  if (cachedTypeScriptCompiler !== undefined) return cachedTypeScriptCompiler;
  try {
    cachedTypeScriptCompiler = runtimeRequire("typescript");
  } catch {
    cachedTypeScriptCompiler = null;
  }
  return cachedTypeScriptCompiler;
}

function getTypeScriptScriptKind(relativePath: string, ts: any) {
  const ext = path.extname(relativePath).toLowerCase();
  switch (ext) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function extractTypeScriptVariableNames(declarationName: any, ts: any): string[] {
  if (!declarationName) return [];
  if (ts.isIdentifier(declarationName)) return [declarationName.text];
  if (ts.isObjectBindingPattern(declarationName) || ts.isArrayBindingPattern(declarationName)) {
    const names: string[] = [];
    for (const element of declarationName.elements ?? []) {
      if (ts.isBindingElement(element)) {
        names.push(...extractTypeScriptVariableNames(element.name, ts));
      }
    }
    return names;
  }
  return [];
}

export function extractTypeScriptTopLevelSymbols(input: {
  relativePath: string;
  content: string;
}) {
  const ts = getTypeScriptCompiler();
  if (!ts) return null;

  try {
    const sourceFile = ts.createSourceFile(
      input.relativePath,
      input.content,
      ts.ScriptTarget.Latest,
      true,
      getTypeScriptScriptKind(input.relativePath, ts),
    );
    const symbols: AstSymbolChunk[] = [];
    for (const statement of sourceFile.statements) {
      const modifiers = ts.canHaveModifiers?.(statement) ? ts.getModifiers(statement) ?? [] : [];
      const exported = modifiers.some((modifier: any) => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword);
      const start = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
      const end = sourceFile.getLineAndCharacterOfPosition(statement.getEnd()).line + 1;

      if (ts.isFunctionDeclaration(statement)) {
        symbols.push({
          symbolName: statement.name?.text ?? "default",
          symbolKind: "function",
          lineStart: start,
          lineEnd: end,
          exported,
        });
        continue;
      }
      if (ts.isClassDeclaration(statement)) {
        symbols.push({
          symbolName: statement.name?.text ?? "default",
          symbolKind: "class",
          lineStart: start,
          lineEnd: end,
          exported,
        });
        continue;
      }
      if (ts.isInterfaceDeclaration(statement)) {
        symbols.push({
          symbolName: statement.name?.text ?? null,
          symbolKind: "interface",
          lineStart: start,
          lineEnd: end,
          exported,
        });
        continue;
      }
      if (ts.isTypeAliasDeclaration(statement)) {
        symbols.push({
          symbolName: statement.name?.text ?? null,
          symbolKind: "type",
          lineStart: start,
          lineEnd: end,
          exported,
        });
        continue;
      }
      if (ts.isEnumDeclaration(statement)) {
        symbols.push({
          symbolName: statement.name?.text ?? null,
          symbolKind: "enum",
          lineStart: start,
          lineEnd: end,
          exported,
        });
        continue;
      }
      if (ts.isVariableStatement(statement)) {
        const names = statement.declarationList.declarations.flatMap((declaration: any) => (
          extractTypeScriptVariableNames(declaration.name, ts)
        ));
        if (names.length === 0) continue;
        for (const name of names) {
          symbols.push({
            symbolName: name,
            symbolKind: "variable",
            lineStart: start,
            lineEnd: end,
            exported,
          });
        }
      }
    }

    return symbols.length > 0 ? symbols : null;
  } catch {
    return null;
  }
}

function extractPythonTopLevelSymbols(lines: string[]) {
  const symbols: StructuredSymbolChunk[] = [];
  let decoratorStart: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (!trimmed) continue;
    if (indent === 0 && trimmed.startsWith("@")) {
      if (decoratorStart == null) decoratorStart = index + 1;
      continue;
    }
    const classMatch = indent === 0 ? trimmed.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)\b/) : null;
    if (classMatch?.[1]) {
      symbols.push({
        symbolName: classMatch[1],
        symbolKind: "class",
        lineStart: decoratorStart ?? index + 1,
        lineEnd: index + 1,
        exported: true,
        parser: "semantic_python",
      });
      decoratorStart = null;
      continue;
    }
    const defMatch = indent === 0 ? trimmed.match(/^(?:async\s+def|def)\s+([A-Za-z_][A-Za-z0-9_]*)\b/) : null;
    if (defMatch?.[1]) {
      symbols.push({
        symbolName: defMatch[1],
        symbolKind: "function",
        lineStart: decoratorStart ?? index + 1,
        lineEnd: index + 1,
        exported: true,
        parser: "semantic_python",
      });
      decoratorStart = null;
      continue;
    }
    if (indent === 0) {
      decoratorStart = null;
    }
  }

  return symbols;
}

function extractSqlTopLevelSymbols(lines: string[]) {
  const symbols: StructuredSymbolChunk[] = [];
  let current: StructuredSymbolChunk | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("--")) continue;

    if (!current) {
      const createMatch = trimmed.match(
        /^(?:create|alter)\s+(?:or\s+replace\s+)?(?:view|table|function|procedure|index|trigger|type)\s+([A-Za-z_][A-Za-z0-9_.]*)/i,
      );
      if (!createMatch?.[1]) continue;
      const statementType = trimmed.match(/^(create|alter)\s+(?:or\s+replace\s+)?([a-z]+)/i)?.[2] ?? "statement";
      current = {
        symbolName: createMatch[1],
        symbolKind: statementType.toLowerCase(),
        lineStart: index + 1,
        lineEnd: index + 1,
        exported: true,
        parser: "semantic_sql",
      };
    }

    current.lineEnd = index + 1;
    if (trimmed.endsWith(";")) {
      symbols.push(current);
      current = null;
    }
  }

  if (current) symbols.push(current);
  return symbols;
}

function finalizeStructuredSymbolLineEnds(lines: string[], symbols: StructuredSymbolChunk[]) {
  if (symbols.length === 0) return symbols;

  return symbols.map((symbol, index) => {
    const next = symbols[index + 1];
    let lineEnd = next ? next.lineStart - 1 : lines.length;
    while (lineEnd > symbol.lineStart && !(lines[lineEnd - 1] ?? "").trim()) {
      lineEnd -= 1;
    }
    return {
      ...symbol,
      lineEnd: Math.max(symbol.lineEnd, lineEnd),
    };
  });
}

function parseBraceLanguageTopLevelSymbol(line: string, language: string): StructuredSymbolChunk | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (language === "go") {
    const funcMatch = trimmed.match(/^func\s*(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (funcMatch?.[1]) {
      return {
        symbolName: funcMatch[1],
        symbolKind: "function",
        lineStart: 0,
        lineEnd: 0,
        exported: startsWithUppercase(funcMatch[1]),
        parser: "semantic_go",
      };
    }
    const typeMatch = trimmed.match(/^type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(struct|interface|map|chan|\[\]|func|\*)?/);
    if (typeMatch?.[1]) {
      return {
        symbolName: typeMatch[1],
        symbolKind: typeMatch[2] ? `type_${typeMatch[2].replace(/[^a-z]/gi, "")}` : "type",
        lineStart: 0,
        lineEnd: 0,
        exported: startsWithUppercase(typeMatch[1]),
        parser: "semantic_go",
      };
    }
    const valueMatch = trimmed.match(/^(?:const|var)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (valueMatch?.[1]) {
      return {
        symbolName: valueMatch[1],
        symbolKind: trimmed.startsWith("const") ? "const" : "variable",
        lineStart: 0,
        lineEnd: 0,
        exported: startsWithUppercase(valueMatch[1]),
        parser: "semantic_go",
      };
    }
    return null;
  }

  if (language === "rust") {
    const fnMatch = trimmed.match(/^(?:pub\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (fnMatch?.[1]) {
      return {
        symbolName: fnMatch[1],
        symbolKind: "function",
        lineStart: 0,
        lineEnd: 0,
        exported: trimmed.startsWith("pub "),
        parser: "semantic_rust",
      };
    }
    const typeMatch = trimmed.match(/^(?:pub\s+)?(struct|enum|trait|type)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (typeMatch?.[2]) {
      return {
        symbolName: typeMatch[2],
        symbolKind: typeMatch[1],
        lineStart: 0,
        lineEnd: 0,
        exported: trimmed.startsWith("pub "),
        parser: "semantic_rust",
      };
    }
    const implMatch = trimmed.match(/^(?:pub\s+)?impl(?:<[^>]+>)?\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (implMatch?.[1]) {
      return {
        symbolName: implMatch[1],
        symbolKind: "impl",
        lineStart: 0,
        lineEnd: 0,
        exported: trimmed.startsWith("pub "),
        parser: "semantic_rust",
      };
    }
    return null;
  }

  if (language === "java" || language === "kotlin") {
    const match = trimmed.match(/^(?:(?:public|private|protected|internal|open|abstract|final|sealed|data|static)\s+)*(class|interface|enum|object|record)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (!match?.[2]) return null;
    return {
      symbolName: match[2],
      symbolKind: match[1],
      lineStart: 0,
      lineEnd: 0,
      exported: /^(?:public|open)/.test(trimmed),
      parser: language === "java" ? "semantic_java" : "semantic_kotlin",
    };
  }

  if (language === "swift") {
    const match = trimmed.match(/^(?:(?:public|private|internal|open|final)\s+)*(class|struct|enum|protocol|extension|actor|func)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (!match?.[2]) return null;
    return {
      symbolName: match[2],
      symbolKind: match[1],
      lineStart: 0,
      lineEnd: 0,
      exported: /^(?:public|open)/.test(trimmed),
      parser: "semantic_swift",
    };
  }

  if (language === "php") {
    const match = trimmed.match(/^(?:(?:public|private|protected|abstract|final)\s+)*(class|interface|trait|function)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (!match?.[2]) return null;
    return {
      symbolName: match[2],
      symbolKind: match[1],
      lineStart: 0,
      lineEnd: 0,
      exported: true,
      parser: "semantic_php",
    };
  }

  if (language === "shell") {
    const match = trimmed.match(/^(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\))?\s*\{/);
    if (!match?.[1]) return null;
    return {
      symbolName: match[1],
      symbolKind: "function",
      lineStart: 0,
      lineEnd: 0,
      exported: false,
      parser: "semantic_shell",
    };
  }

  return null;
}

function extractBraceLanguageTopLevelSymbols(lines: string[], language: string) {
  const symbols: StructuredSymbolChunk[] = [];
  let braceDepth = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const currentDepth = braceDepth;
    if (currentDepth === 0) {
      const parsed = parseBraceLanguageTopLevelSymbol(line, language);
      if (parsed) {
        symbols.push({
          ...parsed,
          lineStart: index + 1,
          lineEnd: index + 1,
        });
      }
    }
    braceDepth = Math.max(0, braceDepth + countBraceDelta(line));
  }

  return symbols;
}

function extractRubyTopLevelSymbols(lines: string[]) {
  const symbols: StructuredSymbolChunk[] = [];
  let depth = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (depth === 0) {
      const match = trimmed.match(/^(class|module|def)\s+(?:self\.)?([A-Za-z_][A-Za-z0-9_!?=]*)\b/);
      if (match?.[2]) {
        symbols.push({
          symbolName: match[2],
          symbolKind: match[1],
          lineStart: index + 1,
          lineEnd: index + 1,
          exported: true,
          parser: "semantic_ruby",
        });
      }
    }

    if (/^(class|module|def|if|unless|case|begin|while|until|for)\b/.test(trimmed)) depth += 1;
    if (/^end\b/.test(trimmed)) depth = Math.max(0, depth - 1);
  }

  return symbols;
}

export function extractSemanticTopLevelSymbols(input: {
  relativePath: string;
  content: string;
  language: string;
}) {
  const lines = input.content.split(/\r?\n/);
  let symbols: StructuredSymbolChunk[] | null = null;
  if (input.language === "python") symbols = extractPythonTopLevelSymbols(lines);
  if (input.language === "sql") symbols = extractSqlTopLevelSymbols(lines);
  if (input.language === "ruby") symbols = extractRubyTopLevelSymbols(lines);
  if (["go", "rust", "java", "kotlin", "swift", "php", "shell"].includes(input.language)) {
    symbols = extractBraceLanguageTopLevelSymbols(lines, input.language);
  }
  if (!symbols) return null;
  return finalizeStructuredSymbolLineEnds(lines, symbols);
}

function extractImports(text: string) {
  const imports = uniqueNonEmpty((text.match(/^\s*(?:import|from|require|use|include)\b.+$/gm) ?? [])
    .slice(0, 12)
    .map((line) => line.trim()));
  return imports;
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

function stripQuotedLiterals(line: string) {
  return line
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "\"\"")
    .replace(/\/\*.*?\*\//g, " ");
}

function countBraceDelta(line: string) {
  const cleaned = stripQuotedLiterals(line)
    .replace(/\/\/.*$/g, "")
    .replace(/#.*$/g, "");
  const opens = (cleaned.match(/\{/g) ?? []).length;
  const closes = (cleaned.match(/\}/g) ?? []).length;
  return opens - closes;
}

function startsWithUppercase(value: string | null | undefined) {
  return typeof value === "string" && /^[A-Z]/.test(value);
}

function resolveStructuredChunkLineEnd(input: {
  lines: string[];
  current: StructuredSymbolChunk;
  next?: StructuredSymbolChunk | null;
}) {
  let lineEnd = input.next ? input.next.lineStart - 1 : input.lines.length;
  while (lineEnd > input.current.lineStart && !(input.lines[lineEnd - 1] ?? "").trim()) {
    lineEnd -= 1;
  }
  return Math.max(input.current.lineEnd, lineEnd);
}

function buildStructuredSymbolChunks(input: {
  relativePath: string;
  lines: string[];
  symbols: StructuredSymbolChunk[];
  imports: string[];
  baseMetadata: Record<string, unknown>;
  chunkKind: string;
}) {
  if (input.symbols.length === 0) return null;

  const chunks: WorkspaceChunkInput[] = [];
  let chunkIndex = 0;
  const firstLine = input.symbols[0]?.lineStart ?? 1;
  if (firstLine > 1) {
    const preambleText = input.lines.slice(0, firstLine - 1).join("\n").trimEnd();
    if (preambleText.trim().length > 0) {
      chunks.push({
        chunkIndex: chunkIndex++,
        headingPath: input.relativePath,
        symbolName: null,
        tokenCount: estimateTokenCount(preambleText),
        textContent: preambleText,
        searchText: [input.relativePath, ...input.imports, preambleText].filter(Boolean).join("\n"),
        metadata: {
          ...input.baseMetadata,
          lineStart: 1,
          lineEnd: firstLine - 1,
          chunkKind: "preamble",
          parser: input.symbols[0]?.parser ?? "structured",
        },
      });
    }
  }

  for (let index = 0; index < input.symbols.length; index += 1) {
    const current = input.symbols[index]!;
    const next = input.symbols[index + 1];
    const sliceStart = Math.max(0, current.lineStart - 1);
    const lineEnd = resolveStructuredChunkLineEnd({
      lines: input.lines,
      current,
      next,
    });
    const sliceEnd = lineEnd;
    const textContent = input.lines.slice(sliceStart, sliceEnd).join("\n").trimEnd();
    chunks.push({
      chunkIndex: chunkIndex++,
      headingPath: input.relativePath,
      symbolName: current.symbolName,
      tokenCount: estimateTokenCount(textContent),
      textContent,
      searchText: [
        input.relativePath,
        current.symbolName ?? "",
        current.symbolKind,
        ...input.imports,
        textContent,
      ].filter(Boolean).join("\n"),
        metadata: {
          ...input.baseMetadata,
          lineStart: current.lineStart,
          lineEnd,
          chunkKind: input.chunkKind,
          parser: current.parser,
          symbolKind: current.symbolKind,
          exported: current.exported,
        },
      });
  }

  return chunks;
}

function createLineWindowChunks(input: {
  relativePath: string;
  content: string;
  language: string;
  maxLines?: number;
  overlapLines?: number;
  baseMetadata?: Record<string, unknown>;
}) {
  const lines = input.content.split(/\r?\n/);
  const maxLines = Math.max(20, input.maxLines ?? DEFAULT_CHUNK_LINE_COUNT);
  const overlapLines = Math.max(0, Math.min(maxLines - 1, input.overlapLines ?? DEFAULT_CHUNK_OVERLAP));

  if (lines.length === 0) {
    return [{
      chunkIndex: 0,
      headingPath: input.relativePath,
      symbolName: null,
      tokenCount: 0,
      textContent: "",
      searchText: input.relativePath,
      metadata: {
        ...(input.baseMetadata ?? {}),
        language: input.language,
        lineStart: 1,
        lineEnd: 1,
      },
    }] satisfies WorkspaceChunkInput[];
  }

  const chunks: WorkspaceChunkInput[] = [];
  let cursor = 0;
  let chunkIndex = 0;
  while (cursor < lines.length) {
    const end = Math.min(lines.length, cursor + maxLines);
    const slice = lines.slice(cursor, end);
    const textContent = slice.join("\n").trimEnd();
    const symbolName = detectChunkSymbol(textContent);
    chunks.push({
      chunkIndex,
      headingPath: input.relativePath,
      symbolName,
      tokenCount: estimateTokenCount(textContent),
      textContent,
      searchText: [input.relativePath, symbolName ?? "", textContent].filter(Boolean).join("\n"),
      metadata: {
        ...(input.baseMetadata ?? {}),
        language: input.language,
        lineStart: cursor + 1,
        lineEnd: end,
      },
    });
    if (end >= lines.length) break;
    cursor = Math.max(end - overlapLines, cursor + 1);
    chunkIndex += 1;
  }

  return chunks;
}

function detectSymbolStarts(lines: string[]) {
  const patterns = [
    /^\s*export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/,
    /^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)/,
    /^\s*export\s+(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=/,
    /^\s*(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/,
    /^\s*export\s+class\s+([A-Za-z0-9_]+)/,
    /^\s*class\s+([A-Za-z0-9_]+)/,
    /^\s*export\s+interface\s+([A-Za-z0-9_]+)/,
    /^\s*interface\s+([A-Za-z0-9_]+)/,
    /^\s*export\s+type\s+([A-Za-z0-9_]+)/,
    /^\s*type\s+([A-Za-z0-9_]+)/,
    /^\s*def\s+([A-Za-z0-9_]+)/,
    /^\s*func\s+(?:\([^)]+\)\s*)?([A-Za-z0-9_]+)/,
    /^\s*fn\s+([A-Za-z0-9_]+)/,
    /^\s*struct\s+([A-Za-z0-9_]+)/,
    /^\s*enum\s+([A-Za-z0-9_]+)/,
    /^\s*protocol\s+([A-Za-z0-9_]+)/,
    /^\s*extension\s+([A-Za-z0-9_]+)/,
  ];
  const starts: Array<{ index: number; symbolName: string }> = [];
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        starts.push({ index, symbolName: match[1] });
        break;
      }
    }
  });
  return starts;
}

function chunkCodeFile(input: {
  relativePath: string;
  content: string;
  language: string;
}) {
  const lines = input.content.split(/\r?\n/);
  const imports = extractImports(lines.slice(0, Math.min(lines.length, 40)).join("\n"));
  const baseMetadata = {
    language: input.language,
    imports,
    isTestFile: isTestFilePath(input.relativePath),
  };
  const astSymbols = isTypeScriptFamilyLanguage(input.language)
    ? extractTypeScriptTopLevelSymbols({
      relativePath: input.relativePath,
      content: input.content,
    })
    : null;

  if (astSymbols && astSymbols.length > 0) {
    const chunks = buildStructuredSymbolChunks({
      relativePath: input.relativePath,
      lines,
      symbols: astSymbols.map((symbol) => ({
        ...symbol,
        parser: "typescript_ast",
      })),
      imports,
      baseMetadata,
      chunkKind: "ast_symbol",
    });
    if (chunks) return chunks;
  }

  const semanticSymbols = extractSemanticTopLevelSymbols({
    relativePath: input.relativePath,
    content: input.content,
    language: input.language,
  });
  if (semanticSymbols && semanticSymbols.length > 0) {
    const chunks = buildStructuredSymbolChunks({
      relativePath: input.relativePath,
      lines,
      symbols: semanticSymbols,
      imports,
      baseMetadata,
      chunkKind: "semantic_symbol",
    });
    if (chunks) return chunks;
  }

  const symbolStarts = detectSymbolStarts(lines);

  if (symbolStarts.length === 0) {
    return createLineWindowChunks({
      relativePath: input.relativePath,
      content: input.content,
      language: input.language,
      baseMetadata,
    });
  }

  const chunks: WorkspaceChunkInput[] = [];
  let chunkIndex = 0;

  const firstSymbolIndex = symbolStarts[0]?.index ?? 0;
  if (firstSymbolIndex > 0) {
    const preambleText = lines.slice(0, firstSymbolIndex).join("\n").trimEnd();
    if (preambleText.trim().length > 0) {
      chunks.push({
        chunkIndex: chunkIndex++,
        headingPath: input.relativePath,
        symbolName: null,
        tokenCount: estimateTokenCount(preambleText),
        textContent: preambleText,
        searchText: [input.relativePath, ...imports, preambleText].filter(Boolean).join("\n"),
        metadata: {
          ...baseMetadata,
          lineStart: 1,
          lineEnd: firstSymbolIndex,
          chunkKind: "preamble",
        },
      });
    }
  }

  for (let index = 0; index < symbolStarts.length; index += 1) {
    const current = symbolStarts[index]!;
    const next = symbolStarts[index + 1];
    const sliceStart = current.index;
    const sliceEnd = next ? next.index : lines.length;
    const sliceLines = lines.slice(sliceStart, sliceEnd);
    const textContent = sliceLines.join("\n").trimEnd();
    chunks.push({
      chunkIndex: chunkIndex++,
      headingPath: input.relativePath,
      symbolName: current.symbolName,
      tokenCount: estimateTokenCount(textContent),
      textContent,
      searchText: [input.relativePath, current.symbolName, ...imports, textContent].filter(Boolean).join("\n"),
      metadata: {
        ...baseMetadata,
        lineStart: sliceStart + 1,
        lineEnd: sliceEnd,
        chunkKind: "symbol",
        parser: "heuristic",
      },
    });
  }

  return chunks;
}

function chunkMarkdownFile(input: {
  relativePath: string;
  content: string;
  language: string;
}) {
  const lines = input.content.split(/\r?\n/);
  const sections: Array<{
    headingPath: string;
    lineStart: number;
    lineEnd: number;
    textContent: string;
  }> = [];
  const headingStack: Array<{ level: number; title: string }> = [];
  let sectionStart = 0;
  let currentHeadingPath = input.relativePath;

  const flushSection = (lineEndExclusive: number) => {
    const textContent = lines.slice(sectionStart, lineEndExclusive).join("\n").trimEnd();
    if (!textContent.trim()) return;
    sections.push({
      headingPath: currentHeadingPath,
      lineStart: sectionStart + 1,
      lineEnd: lineEndExclusive,
      textContent,
    });
  };

  lines.forEach((line, index) => {
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!headingMatch) return;
    flushSection(index);
    const level = headingMatch[1].length;
    const title = headingMatch[2].trim();
    while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= level) {
      headingStack.pop();
    }
    headingStack.push({ level, title });
    currentHeadingPath = [input.relativePath, ...headingStack.map((entry) => entry.title)].join(" > ");
    sectionStart = index;
  });
  flushSection(lines.length);

  if (sections.length === 0) {
    return createLineWindowChunks({
      relativePath: input.relativePath,
      content: input.content,
      language: input.language,
      maxLines: DEFAULT_MARKDOWN_CHUNK_LINE_COUNT,
      overlapLines: 10,
    });
  }

  return sections.flatMap((section, sectionIndex) => {
    const sectionLines = section.textContent.split(/\r?\n/);
    if (sectionLines.length <= DEFAULT_MARKDOWN_CHUNK_LINE_COUNT) {
      return [{
        chunkIndex: sectionIndex,
        headingPath: section.headingPath,
        symbolName: null,
        tokenCount: estimateTokenCount(section.textContent),
        textContent: section.textContent,
        searchText: [section.headingPath, section.textContent].join("\n"),
        metadata: {
          language: input.language,
          lineStart: section.lineStart,
          lineEnd: section.lineEnd,
          chunkKind: "section",
        },
      }] satisfies WorkspaceChunkInput[];
    }

    const nested = createLineWindowChunks({
      relativePath: input.relativePath,
      content: section.textContent,
      language: input.language,
      maxLines: DEFAULT_MARKDOWN_CHUNK_LINE_COUNT,
      overlapLines: 10,
      baseMetadata: {
        chunkKind: "section_window",
        parentHeadingPath: section.headingPath,
      },
    });
    return nested.map((chunk, nestedIndex) => ({
      ...chunk,
      chunkIndex: sectionIndex * 100 + nestedIndex,
      headingPath: section.headingPath,
      searchText: [section.headingPath, chunk.textContent].join("\n"),
      metadata: {
        ...chunk.metadata,
        lineStart: section.lineStart + Number(chunk.metadata.lineStart ?? 1) - 1,
        lineEnd: section.lineStart + Number(chunk.metadata.lineEnd ?? 1) - 1,
      },
    }));
  });
}

export function chunkWorkspaceFile(input: {
  relativePath: string;
  content: string;
  language: string;
  maxLines?: number;
  overlapLines?: number;
}): WorkspaceChunkInput[] {
  if (isMarkdownLanguage(input.language)) {
    return chunkMarkdownFile(input);
  }
  if (isCodeLanguage(input.language)) {
    return chunkCodeFile(input);
  }
  return createLineWindowChunks(input);
}

async function walkWorkspaceFiles(input: {
  cwd: string;
  maxFiles: number;
}) {
  const collected: string[] = [];

  async function visit(dir: string) {
    if (collected.length >= input.maxFiles) return;
    const entries = (await readdir(dir, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (collected.length >= input.maxFiles) break;
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(input.cwd, absolutePath);
      if (entry.isDirectory()) {
        if (!shouldIncludeWorkspacePath({ relativePath: path.join(relativePath, "index.ts") })) {
          const segments = relativePath.split(path.sep).filter(Boolean);
          if (segments.some((segment) => DEFAULT_IGNORED_DIRS.has(segment))) continue;
        }
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!shouldIncludeWorkspacePath({ relativePath })) continue;
      collected.push(absolutePath);
    }
  }

  await visit(input.cwd);
  return collected;
}

async function readWorkspaceTextFile(filePath: string) {
  const buffer = await readFile(filePath);
  if (buffer.byteLength > DEFAULT_MAX_FILE_BYTES) return null;
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

export function knowledgeImportService(db: Db) {
  const projects = projectService(db);
  const knowledge = knowledgeService(db);
  const embeddings = knowledgeEmbeddingService();

  return {
    async importProjectWorkspace(input: {
      projectId: string;
      workspaceId?: string;
      maxFiles?: number;
    }) {
      const providerInfo = embeddings.getProviderInfo();
      if (!providerInfo.available || !providerInfo.provider || !providerInfo.model) {
        throw new Error("Knowledge embedding provider is not configured");
      }

      const project = await projects.getById(input.projectId);
      if (!project) return null;

      const workspace =
        (input.workspaceId
          ? project.workspaces.find((entry) => entry.id === input.workspaceId)
          : project.primaryWorkspace)
        ?? null;
      if (!workspace?.cwd) {
        throw new Error("Project workspace does not have a local cwd");
      }

      const workspaceRoot = await resolveWorkspaceImportRoot({ cwd: workspace.cwd });

      const filePaths = await walkWorkspaceFiles({
        cwd: workspaceRoot,
        maxFiles: input.maxFiles ?? DEFAULT_MAX_FILES,
      });

      let importedFiles = 0;
      let skippedFiles = 0;
      const documents: Array<{
        documentId: string;
        path: string;
        chunkCount: number;
      }> = [];

      for (const filePath of filePaths) {
        const relativePath = path.relative(workspaceRoot, filePath).split(path.sep).join("/");
        const rawContent = await readWorkspaceTextFile(filePath);
        if (rawContent == null) {
          skippedFiles += 1;
          continue;
        }
        if (detectWorkspaceSecret({ relativePath, content: rawContent })) {
          skippedFiles += 1;
          continue;
        }

        const descriptor = classifyWorkspaceDocument({
          relativePath,
          content: rawContent,
        });
        const document = await knowledge.createDocument({
          companyId: project.companyId,
          sourceType: descriptor.sourceType,
          authorityLevel: "canonical",
          contentSha256: sha256(rawContent),
          rawContent,
          repoUrl: workspace.repoUrl,
          repoRef: workspace.repoRef,
          projectId: project.id,
          path: relativePath,
          title: descriptor.title,
          language: descriptor.language,
          metadata: {
            importSource: "workspace",
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            cwd: workspaceRoot,
            ...descriptor.metadata,
          },
        });
        if (!document) {
          skippedFiles += 1;
          continue;
        }

        await knowledge.deprecateSupersededDocuments({
          companyId: project.companyId,
          sourceType: descriptor.sourceType,
          path: relativePath,
          projectId: project.id,
          repoRef: workspace.repoRef,
          keepDocumentId: document.id,
          supersededByDocumentId: document.id,
        });

        const chunkInputs = chunkWorkspaceFile({
          relativePath,
          content: rawContent,
          language: descriptor.language,
        });
        const embeddingResult = await embeddings.generateEmbeddings(
          chunkInputs.map((chunk) => chunk.textContent),
        );
        const generatedAt = new Date().toISOString();

        const chunks = await knowledge.replaceDocumentChunks({
          companyId: project.companyId,
          documentId: document.id,
          chunks: chunkInputs.map((chunk, index) => ({
            ...chunk,
            embedding: embeddingResult.embeddings[index]!,
            metadata: {
              ...chunk.metadata,
              embeddingProvider: embeddingResult.provider,
              embeddingModel: embeddingResult.model,
              embeddingDimensions: embeddingResult.dimensions,
              embeddingOrigin: "workspace_import",
              embeddingGeneratedAt: generatedAt,
              tags: uniqueNonEmpty([
                ...descriptor.tags,
                ...(Array.isArray(chunk.metadata.tags) ? chunk.metadata.tags.filter((value): value is string => typeof value === "string") : []),
                chunk.symbolName ?? "",
              ]),
            },
            links: [
              {
                entityType: "project",
                entityId: project.id,
                linkReason: "workspace_import_project",
                weight: 1,
              },
              {
                entityType: "workspace",
                entityId: workspace.id,
                linkReason: "workspace_import_workspace",
                weight: 0.5,
              },
              {
                entityType: "path",
                entityId: relativePath,
                linkReason: "workspace_import_path",
                weight: 1.2,
              },
              ...(chunk.symbolName
                ? [{
                  entityType: "symbol",
                  entityId: chunk.symbolName,
                  linkReason: "workspace_import_symbol",
                  weight: 0.8,
                }]
                : []),
            ],
          })),
        });

        await knowledge.updateDocumentMetadata(document.id, {
          importSource: "workspace",
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          cwd: workspace.cwd,
          lastImportedAt: generatedAt,
          embeddingProvider: embeddingResult.provider,
          embeddingModel: embeddingResult.model,
          embeddingDimensions: embeddingResult.dimensions,
          embeddingOrigin: "workspace_import",
          embeddingGeneratedAt: generatedAt,
          embeddingChunkCount: chunks.length,
          embeddingTotalTokens: embeddingResult.usage.totalTokens,
          tags: descriptor.tags,
          isLatestForScope: true,
        });

        importedFiles += 1;
        documents.push({
          documentId: document.id,
          path: relativePath,
          chunkCount: chunks.length,
        });
      }

      await logActivity(db, {
        companyId: project.companyId,
        actorType: "system",
        actorId: "knowledge_workspace_import",
        action: "knowledge.workspace.imported",
        entityType: "project",
        entityId: project.id,
        details: {
          projectId: project.id,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          scannedFiles: filePaths.length,
          importedFiles,
          skippedFiles,
        },
      });

      return {
        projectId: project.id,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        cwd: workspace.cwd,
        scannedFiles: filePaths.length,
        importedFiles,
        skippedFiles,
        documents,
      };
    },
  };
}
