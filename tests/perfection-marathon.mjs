import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Perfection Marathon Runner
 * Executes 40+ diverse queries with linguistic variations to stress-test the AI shell.
 */

const QUERIES = [
  // 1. Status & Summary
  ["status", "what's the project status?", "give me a status update"],
  ["summary", "project summary", "tell me about the project"],
  ["list tickets", "show active tickets", "what are the tickets?"],
  
  // 2. Sync & Refresh
  ["sync", "refresh index", "reindex everything"],
  ["sync then summary", "refresh then show status", "sync and give me a summary"],
  
  // 3. Search & Discovery
  ["find router", "search for routing logic", "where is the router located?"],
  ["search for 'parser'", "find all parser logic", "investigate parsing"],
  
  // 4. Ticket Management
  ["ticket TKT-001", "show me ticket 1", "extract ticket 001"],
  ["next", "what's next?", "what should i work on?"],
  ["add bug: router is slow", "create bug for router speed", "BUG: router latency is high"],
  ["add todo: write tests for fuzzy", "create task: fuzzy tests", "TODO: implement fuzzy test suite"],
  ["decompose TKT-001", "break down ticket 1", "split ticket 1 into subtasks"],
  
  // 5. Diagnostics & Health
  ["doctor", "check system health", "diagnostics"],
  ["audit architecture", "check wiring", "is the design clean?"],
  ["metrics", "usage stats", "how are models performing?"],
  ["reprofile", "rescan models", "refresh capability matrix"],
  
  // 6. Ideation & Planning (RFCs)
  ["ideate plugin system", "RFC: plugin architecture", "scope out a new plugin system"],
  ["ideate distributed state", "RFC: distributed sync engine", "how should we handle remote state?"],
  
  // 7. Advanced / Dynamic
  ["forge script to count files", "write codelet to list all symbols", "create dynamic codelet for symbol count"],
  ["sync then find bugs then list tickets", "refresh then search bugs then show tickets"],
  ["search sync then extract ticket 1", "find sync logic and show ticket 1"],
  
  // 8. Fuzzy / Junior Logic
  ["fixit!", "anything to fix?", "help me find debt"],
  ["revisit router", "audit the routing service", "check router for inconsistencies"],
  ["find all TODOs", "where are the markers?", "show me all technical debt"],
  
  // 9. Config & Provider
  ["show config", "config get", "what is my current config?"],
  ["set-provider-key google", "set gemini key", "update google api key"],
  
  // 10. Help & Meta
  ["help", "what can you do?", "show command list"],
  ["who am i?", "show model info", "what model is planning this?"],
  ["perfection audit", "find inconsistencies", "check project for perfection gaps"]
];

async function runQuery(text) {
  return new Promise((resolve) => {
    const cli = spawn("./cli/ai-workflow.mjs", ["shell", text, "--plan-only", "--json"], {
      env: { ...process.env, NO_COLOR: "1" }
    });
    let stdout = "";
    let stderr = "";
    cli.stdout.on("data", (d) => stdout += d);
    cli.stderr.on("data", (d) => stderr += d);
    cli.on("close", (code) => {
      resolve({ text, code, stdout, stderr });
    });
  });
}

async function main() {
  console.log("🚀 Starting Perfection Marathon...");
  const results = [];
  
  for (const group of QUERIES) {
    for (const variant of group) {
      process.stdout.write(`Testing: "${variant}"... `);
      const res = await runQuery(variant);
      try {
        const parsed = JSON.parse(res.stdout);
        const ok = parsed.plan && (parsed.plan.actions?.length > 0 || parsed.plan.kind === "reply" || parsed.plan.kind === "exit");
        console.log(ok ? "✅" : "❌ (Empty Plan)");
        results.push({ variant, ok, plan: parsed.plan });
      } catch (e) {
        console.log("❌ (JSON Error)");
        results.push({ variant, ok: false, error: e.message, raw: res.stdout });
      }
    }
  }
  
  console.log("\n--- Marathon Summary ---");
  const failed = results.filter(r => !r.ok);
  console.log(`Total: ${results.length} | Passed: ${results.length - failed.length} | Failed: ${failed.length}`);
  
  if (failed.length > 0) {
    console.log("\nFailed Queries:");
    failed.forEach(f => console.log(`- "${f.variant}": ${f.error || "Bad Action Mapping"}`));
  }
}

main().catch(console.error);
