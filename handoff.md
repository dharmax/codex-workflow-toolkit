# ai-workflow Handoff

## Current Reality

The shell is better than it was, but it is not yet at the required bar of "strong LLM assistant first, tools underneath."

What is already true:
- shell grounding and no-AI fallback are much stronger
- shell plans now expose an action graph
- the planner can now emit graph-shaped plans directly
- graph execution supports dependency ordering, explicit synthesize nodes, and node-level recovery attempts
- ticket/tool-dev flows are substantially more truthful than before

What is not yet good enough:
- long multi-turn shell behavior is still too shallow
- conditional and recursive planning for real feature/change work is still missing
- the shell does not yet reliably "re-issue itself better orders" until a goal is reached
- tool-result-conditioned branching is not implemented as a first-class graph concept

## Must-Have Goal

For feature requests and change requests, the shell must be able to:

1. decompose the request into an executable graph
2. run tools and inspect the results
3. conditionally re-plan from those results
4. issue more sophisticated follow-up orders to itself
5. continue until the goal is actually achieved or a real blocker is proven

This is especially important for tool-driven work such as:
- Playwright / browser inspection
- code search and context-pack
- verification commands
- ticket execution
- shell/tool-dev proving

The target behavior is not one-shot planning. It is iterative, conditional, self-directed execution with clear guardrails.

## Next Implementation Plan

### 1. Conditional Graph Nodes

Add first-class graph node types beyond plain action nodes:
- `action`
- `branch`
- `assert`
- `synthesize`
- `replan`

Each node should be able to carry:
- `id`
- `kind`
- `dependsOn`
- `condition`
- `status`
- `result`
- `failureMode`

Conditions must be able to inspect structured outputs from prior nodes.

Examples:
- if Playwright screenshot/text indicates modal still open, branch into a deeper UI investigation graph
- if search/context-pack results are too weak, branch into a sync + broader discovery graph
- if verification is red at baseline, branch into a "diagnose baseline first" graph instead of pretending ticket execution is ready

### 2. Recursive Self-Ordering

Add an explicit shell capability where the shell can produce a follow-up graph for itself after inspecting prior node results.

This should not be hidden magic. It should be represented in state as:
- initial graph
- observed node outputs
- replanning decision
- new graph fragment appended or substituted

This is the core requirement:
- the shell must be able to tell itself better, narrower, more sophisticated next orders based on what just happened

Examples:
- feature request -> inspect project -> infer likely files -> generate plan -> verify -> if verification fails, issue a focused diagnostic subgraph
- UI change -> run Playwright -> inspect textual/screenshot result -> if state mismatch persists, issue a deeper DOM/route/state investigation subgraph

### 3. Stronger AI Graph-Planning Prompt

Upgrade the AI planner prompt/examples so it prefers:
- graph plans over flat actions
- branch/assert/replan nodes for non-trivial tasks
- explicit verification and observation steps
- tool-result-conditioned continuation

The current prompt mentions graph nodes, but it is still too weak and too generic.

It needs concrete examples for:
- feature request
- bug investigation
- UI/playwright diagnosis
- setup/troubleshooting
- ticket execution with verification gating

### 4. Structured Node Results

Right now node execution mostly yields command output strings.

Upgrade node result handling so tools can emit structured results when possible:
- `summary`
- `structuredPayload`
- `evidence`
- `artifacts`
- `success/failure classification`

This is necessary for reliable branching.

For example:
- Playwright node should expose whether the expected text/element/state appeared
- route/provider checks should expose machine-readable status
- verification nodes should expose pass/fail/baseline-red/timeout distinctly

### 5. Multi-Turn Graph Continuation

The shell currently replans each turn too eagerly.

Add a continuation model where:
- the current graph can remain active across turns
- the user can say things like:
  - "continue"
  - "go deeper"
  - "branch on that"
  - "why did that fail?"
- the shell uses prior graph state instead of starting over

This must be visible and inspectable, not hidden state soup.

### 6. Better Final Synthesis

The final assistant response must be based on:
- the executed graph
- the node results
- the branch path that actually happened
- the remaining uncertainty/blockers

The shell should not merely rephrase one command output.
It should synthesize the graph outcome like a serious operator.

## Guardrails

The following must remain true while implementing the above:
- keep toolkit root and target project clearly separated in `tool-dev`
- do not let replanning silently mutate external repos in `tool-dev`
- do not mark work successful if verification is absent, red, or ambiguous
- keep graph state inspectable in `--json`
- keep the repo clean after each pass

## Suggested Order For The Next Clean Context

1. implement conditional node schema and validation
2. implement structured node-result envelopes
3. implement branch/assert/replan execution
4. strengthen AI graph-planning examples
5. add multi-turn graph continuation
6. add Playwright-conditioned test scenarios
7. dogfood on a real linked project until the shell feels like a strong assistant instead of a command router

## Verification Standard

Do not stop at unit tests only.

Required verification for the next pass:
- focused shell graph tests
- full `npm test`
- real linked-project shell checks
- at least one scenario where the shell:
  - issues an initial graph
  - inspects tool results
  - conditionally re-plans
  - continues toward the goal

## Clean Context Note

The repo is intentionally left clean at this handoff point.

Recent relevant commits:
- `37c9ef2` `Harden shell conversation evals and grounding`
- `3d2166a` `Add shell action graph execution`
- `33ead68` `Accept planner-defined shell graphs`

Resume from here by treating recursive, conditional shell execution as the primary target.
