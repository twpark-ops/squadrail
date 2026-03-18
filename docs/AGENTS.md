# AGENTS.md

이 파일은 `docs/` 트리 안에서 작업할 때 적용되는 문서 전용 규칙이다.
루트 `AGENTS.md`를 보완하며, 문서 구조와 Mintlify/MDX 제약만 다룬다.

## First Stops

- Top-level maps: `DESIGN.md`, `PLANS.md`, `PRODUCT_SENSE.md`, `RELIABILITY.md`, `SECURITY.md`
- Information architecture: `design-docs/docs-information-architecture-2026-03-18.md`
- Docs principles: `design-docs/core-beliefs.md`
- Docs site nav: `docs.json`

## Placement Rules

- New active execution plans go in `exec-plans/active/`
- Completed or superseded plans go in `exec-plans/completed/`
- New design docs go in `design-docs/`
- New product specs go in `product-specs/`
- Reference material goes in `references/`
- Generated output goes in `generated/`

## Templates

- Active plan: `exec-plans/active/_template.md`
- Product spec: `product-specs/_template.md`
- Design doc: `design-docs/_template.md`

## Nested Local Guides

- `design-docs/AGENTS.md`
- `product-specs/AGENTS.md`
- `exec-plans/AGENTS.md`

## Mintlify / MDX Rules

- Avoid raw angle-bracket email syntax like `<name@example.com>` in Markdown body or frontmatter values.
- Prefer `[label](https://...)` over raw autolink forms like `<https://...>`.
- Avoid raw `<->` and `<60%` style text in Markdown; rewrite or escape it.
- If you touch `docs.json` or top-level maps, run a Mintlify preview check.

## Validation

- Run `pnpm docs:check`
- Run `git diff --check`
- For nav or parsing-sensitive changes, run:
  - `cd docs && npx mintlify dev --port 3480`

## Editing Style

- Keep map documents short.
- Do not put long implementation detail into `DESIGN.md`, `PLANS.md`, `SECURITY.md`, or `RELIABILITY.md`.
- Update links when moving files. Prefer moving files only when their category is clear.
