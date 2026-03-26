/**
 * Side-Effect Analysis for dynamic AI codelets.
 * Predicts which files and database tables will be affected.
 */

export function analyzeCodeletSideEffects(code) {
  const effects = {
    files: [],
    tables: [],
    risk: "low"
  };

  // 1. Detect File System access
  const fsMatches = code.matchAll(/(?:writeFile|rm|mkdir|appendFile|unlink)\s*\(\s*["'`](.+?)["'`]/g);
  for (const match of fsMatches) {
    effects.files.push(match[1]);
    effects.risk = "high";
  }

  // 2. Detect DB Table access
  const tableMatches = code.matchAll(/(?:FROM|INTO|UPDATE)\s+([a-zA-Z0-9_]+)/gi);
  for (const match of tableMatches) {
    effects.tables.push(match[1].toLowerCase());
    if (["entities", "notes", "claims", "files"].includes(match[1].toLowerCase())) {
      effects.risk = "medium";
    }
  }

  // 3. Item 44: Malicious Code Detection
  const maliciousPatterns = [
    /\b(rm\s+-rf|process\.kill|child_process|exec\s*\()/,
    /\b(eval\s*\(|new\s+Function|http\.get|https\.request|fetch\s*\()/,
    /\b(\/etc\/passwd|\/etc\/shadow|~\/\.ssh)/
  ];
  for (const pattern of maliciousPatterns) {
    if (pattern.test(code)) {
      effects.risk = "critical";
      effects.isMalicious = true;
    }
  }

  return effects;
  }

  export function formatSideEffects(effects) {
  if (effects.isMalicious) {
    return "CRITICAL: Malicious code detected! Execution BLOCKED.";
  }
  const parts = [`Risk Level: ${effects.risk.toUpperCase()}`];
  if (effects.files.length) parts.push(`Files: ${effects.files.join(", ")}`);
  if (effects.tables.length) parts.push(`Tables: ${effects.tables.join(", ")}`);
  
  return parts.join(" | ");
}
