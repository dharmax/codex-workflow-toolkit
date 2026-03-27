<!-- Responsibility: Track the shell UX and NL-to-action Definition of Done for status/readiness and "make it ready" flows.
Scope: Covers the specific failures surfaced in the playground interaction and the required fixes/tests. -->

# Shell Readiness DOD Checklist

- [x] Combined status + readiness questions return a combined answer instead of only the readiness half.
- [x] Shell phrasing avoids awkward output like "Not ready for beta readiness."
- [x] Shell replies do not leak protocol-only terms such as `Status: complete` into conversational answers.
- [x] Shell readiness answers summarize blockers in human language instead of dumping protocol structure.
- [x] "make it ready" maps to concrete follow-up execution work instead of shallow ticket extraction.
- [x] Continuation from a previous readiness answer reuses blocker evidence to pick the next actionable ticket.
- [x] Internal planner/assertion/recovery chatter is suppressed for the guided assistant-first flow.
- [x] The shell can carry structured readiness payloads forward across turns.
- [x] Tests cover the combined status/readiness flow.
- [x] Tests cover the "make it ready" continuation flow.
- [x] The flow is exercised against the playground project.
