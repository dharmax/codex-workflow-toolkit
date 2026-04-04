<!-- Responsibility: Define project-specific audit extensions. Scope: Fixture coverage for allowlist rules. -->
# Audit Extensions

This project customizes the baseline workflow audit with a narrow allowlist.

```ai-workflow-audit
{
  "allowlists": [
    {
      "id": "legacy-todo-allowlist",
      "include": ["src/legacy"],
      "extensions": [".ts"],
      "ruleIds": ["no-source-todo"]
    }
  ]
}
```
