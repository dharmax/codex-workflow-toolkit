<!-- Responsibility: Define the machine-enforced baseline workflow and code policy for initialized projects.
Scope: Project-specific exceptions and stricter local rules belong in additional `ai-workflow-audit` blocks, not in this baseline explanation text. -->
# Enforcement

This file defines the strict default audit baseline for initialized projects.

Rules in the fenced `ai-workflow-audit` block are active immediately.
If a project needs a narrower exception, edit this file or add a later markdown block in another guidance doc with a more specific rule.
If a rule's failure text should be identical to the pattern text, omit `message`; the audit engine will use the pattern as the default finding text.

```ai-workflow-audit
{
  "headers": [
    {
      "id": "responsibility-headers",
      "include": ["AGENTS.md", "CONTRIBUTING.md", "execution-protocol.md", "enforcement.md", "project-guidelines.md", "kanban-archive.md"],
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
  "requiredPatterns": [
    {
      "id": "stop-on-aiwf-failure",
      "include": ["AGENTS.md", "execution-protocol.md", "project-guidelines.md", "templates/AGENTS.md", "templates/execution-protocol.md", "templates/project-guidelines.md"],
      "extensions": [".md"],
      "pattern": "If `ai-workflow` fails, stop, identify root cause, and either fix it or report the blocker before continuing."
    },
    {
      "id": "stop-on-incidental-bug",
      "include": ["AGENTS.md", "execution-protocol.md", "project-guidelines.md", "templates/AGENTS.md", "templates/execution-protocol.md", "templates/project-guidelines.md"],
      "extensions": [".md"],
      "pattern": "If you discover a bug while working on something else, stop and tell the operator unless they explicitly asked for full-batch triage."
    },
    {
      "id": "prefer-cheapest-capable-model-route",
      "include": ["AGENTS.md", "execution-protocol.md", "project-guidelines.md", "README.md", "docs/MANUAL.md", "knowledge.md", "templates/AGENTS.md", "templates/execution-protocol.md", "templates/project-guidelines.md", "templates/knowledge.md"],
      "extensions": [".md"],
      "pattern": "Prefer the cheapest capable model route when the tool can use it; if it is unavailable, say so instead of silently widening the fallback."
    },
    {
      "id": "prefer-ai-workflow-first",
      "include": ["AGENTS.md", "execution-protocol.md", "project-guidelines.md", "README.md", "docs/MANUAL.md", "knowledge.md", "templates/AGENTS.md", "templates/execution-protocol.md", "templates/project-guidelines.md", "templates/knowledge.md"],
      "extensions": [".md"],
      "pattern": "Use `ai-workflow` first for project status, ticket lookup, projections, and guideline extraction; fall back to raw shell search/read only when the workflow tool cannot answer."
    }
  ],
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

- Add tighter rules in later `ai-workflow-audit` blocks inside project guidance docs.
- Keep exceptions narrow and path-scoped.
- Prefer explicit rule messages that tell contributors what to do instead.
