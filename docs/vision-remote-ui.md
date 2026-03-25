# Vision: Remote Command Center (Companion UI)

## Goal
To build a zero-friction, mobile-friendly "Remote Command Center" for the Autonomous Engineering OS, serving strictly as a companion to the local machine-based workflow.

## Core Philosophy
*   **Companion, Not Replacement:** The heavy lifting (coding, deep architecture, multi-file merging) stays on the local machine (CLI/IDE). The Remote UI is for oversight, triage, and high-level steering.
*   **Solo First:** Designed for a single developer controlling their autonomous agents. Team features are out of scope for Phase 1 & 2.
*   **Zero-Friction Access:** Must not require complex local tunneling (ngrok/Cloudflare) or custom auth layers if avoidable.

## Phase 1: The Telegram Native Integration
**Focus:** Chat-ops and basic oversight.
*   **Chat Interface:** Use standard Telegram bot chat for natural language commands (e.g., `/status`, `sweep bugs`).
*   **Rich Notifications:** Push alerts for CI failures, autonomous loop completion, or requests for human approval.
*   **Simple Approvals:** Inline Telegram buttons for quick actions (e.g., [Approve Patch] [Reject] [Escalate]).

## Phase 2: The Telegram Mini App (TMA) Dashboard
**Focus:** Visual oversight and Kanban management.
*   **Embedded Web View:** Launch a Riot.js-powered dashboard directly inside Telegram.
*   **Live Kanban:** View and drag-and-drop tickets across lanes.
*   **Metrics & Health:** Visual charts of AI token usage, success rates, and active system errors.
*   **Light Triage:** Ability to tap a bug, read the generated context pack, and trigger a specific agent to fix it.
