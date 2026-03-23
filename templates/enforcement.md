<!-- Responsibility: Define the machine-enforced baseline workflow and code policy for initialized projects.
Scope: Project-specific exceptions and stricter local rules belong in additional `codex-workflow-audit` blocks, not in this baseline explanation text. -->
# Enforcement

This file defines the strict default audit baseline for initialized projects.

Rules in the fenced `codex-workflow-audit` block are active immediately.
If a project needs a narrower exception, edit this file or add a later markdown block in another guidance doc with a more specific rule.

```codex-workflow-audit
{
  "headers": [
    {
      "id": "responsibility-headers",
      "include": ["src", "tests", "docs"],
      "extensions": [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".md", ".mdx", ".riot"],
      "exclude": ["docs/kanban.md"],
      "requiredNearTop": ["Responsibility:", "Scope:"],
      "maxLines": 24,
      "message": "Missing Responsibility/Scope header near the top of the file."
    }
  ],
  "forbiddenPatterns": [
    {
      "id": "no-fake-privacy",
      "include": ["src", "tests"],
      "extensions": [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".riot"],
      "pattern": "\\b(_[a-zA-Z]\\w*|__\\w+)\\s*[:=]",
      "message": "Use explicit names or real language privacy instead of underscore pseudo-private state."
    },
    {
      "id": "no-source-todo",
      "include": ["src"],
      "extensions": [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".riot", ".css"],
      "pattern": "\\b(?:TODO|FIXME)\\b",
      "message": "Do not leave TODO/FIXME markers in production source; ticket the work or finish it."
    },
    {
      "id": "no-native-title-tooltips",
      "include": ["src/ui"],
      "extensions": [".ts", ".tsx", ".js", ".jsx", ".riot"],
      "pattern": "<(button|a|div|span|img|input|label|textarea)[^>]*\\btitle\\s*=",
      "flags": "g",
      "message": "Use explicit tooltip contracts instead of native title attributes on UI surfaces."
    }
  ],
  "requiredPatterns": [],
  "forbiddenImports": [
    {
      "id": "no-engine-to-ui-imports",
      "include": ["src/engine"],
      "extensions": [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
      "targets": ["../ui", "../../ui", "../../../ui", "src/ui", "@/ui"],
      "message": "Engine-layer code must not import from UI-owned paths."
    }
  ]
}
```

## How To Extend

- Add tighter rules in later `codex-workflow-audit` blocks inside project guidance docs.
- Keep exceptions narrow and path-scoped.
- Prefer explicit rule messages that tell contributors what to do instead.
