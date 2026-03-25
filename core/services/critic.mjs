import { withWorkflowStore } from "./sync.mjs";

/**
 * Architectural Critic
 * Audits the codebase for structural smells using hard DB facts.
 */

export async function auditArchitecture(projectRoot) {
  return withWorkflowStore(projectRoot, async (store) => {
    const findings = [];

    // 1. Detect Circular Dependencies (Direct A -> B and B -> A)
    const circular = detectCircularDependencies(store);
    findings.push(...circular);

    // 2. Detect Leaky Abstractions (UI -> DB/IO directly)
    const leaky = detectLeakyAbstractions(store);
    findings.push(...leaky);

    // 3. Detect Zombie Code (Unused symbols)
    const zombie = detectZombieCode(store);
    findings.push(...zombie);

    return findings;
  });
}

function detectCircularDependencies(store) {
  const deps = getModuleDependencies(store);
  const circular = [];

  for (const [a, aDeps] of Object.entries(deps)) {
    for (const b of aDeps) {
      if (deps[b]?.has(a) && a !== b) {
        circular.push({
          type: "circular-dependency",
          severity: "high",
          subject: `${a} <-> ${b}`,
          summary: `Mutual dependency detected between modules ${a} and ${b}.`
        });
      }
    }
  }
  return circular;
}

function getModuleDependencies(store) {
  const query = `
    SELECT DISTINCT
      ma.name as from_module,
      mb.name as to_module
    FROM architectural_graph ga
    JOIN symbols sa ON ga.subject_id = sa.file_path
    JOIN claims c ON sa.id = c.subject_id
    JOIN symbols sb ON c.object_id = sb.id
    JOIN architectural_graph gb ON sb.file_path = gb.subject_id
    JOIN modules ma ON ga.object_id = ma.id
    JOIN modules mb ON gb.object_id = mb.id
    WHERE ga.predicate = 'belongs_to' AND gb.predicate = 'belongs_to' AND c.predicate = 'calls'
  `;
  
  const rows = store.db.prepare(query).all();
  const deps = {};
  for (const row of rows) {
    deps[row.from_module] = deps[row.from_module] ?? new Set();
    deps[row.from_module].add(row.to_module);
  }
  return deps;
}

function detectLeakyAbstractions(store) {
  // Heuristic: UI module directly calling DB/IO symbols
  const query = `
    SELECT DISTINCT
      ma.name as from_module,
      mb.name as to_module,
      ga.subject_id as file_path
    FROM architectural_graph ga
    JOIN symbols sa ON ga.subject_id = sa.file_path
    JOIN claims c ON sa.id = c.subject_id
    JOIN symbols sb ON c.object_id = sb.id
    JOIN architectural_graph gb ON sb.file_path = gb.subject_id
    JOIN modules ma ON ga.object_id = ma.id
    JOIN modules mb ON gb.object_id = mb.id
    WHERE ga.predicate = 'belongs_to' AND gb.predicate = 'belongs_to' AND c.predicate = 'calls'
      AND ma.name LIKE 'ui/%' AND mb.name LIKE '%/db%'
  `;
  
  const rows = store.db.prepare(query).all();
  return rows.map(row => ({
    type: "leaky-abstraction",
    severity: "medium",
    subject: row.file_path,
    summary: `UI component in ${row.from_module} directly calls low-level logic in ${row.to_module}. Should use an adapter.`
  }));
}

function detectZombieCode(store) {
  // Symbols that are exported but never called by anything
  const query = `
    SELECT name, file_path
    FROM symbols
    WHERE exported = 1
      AND id NOT IN (SELECT DISTINCT object_id FROM claims WHERE predicate = 'calls')
      AND id NOT IN (SELECT DISTINCT object_id FROM architectural_graph)
  `;
  
  const rows = store.db.prepare(query).all();
  // Filter out known entry points if possible, or just report as potential zombie
  return rows.slice(0, 10).map(row => ({
    type: "zombie-code",
    severity: "low",
    subject: `${row.file_path}:${row.name}`,
    summary: `Symbol ${row.name} is exported but appears unused in the architectural graph.`
  }));
}
