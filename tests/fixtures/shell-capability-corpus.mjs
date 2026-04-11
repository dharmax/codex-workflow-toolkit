export const SHELL_CAPABILITY_CORPUS = [
  {
    id: "BUG-SHELL-HUMAN-033",
    title: "Handle paragraph debugging requests",
    summary: "Prompt: \"I'm debugging a modal overlay issue. Escape no longer closes the dialog and I want the safest investigation plan. Figure out what files are likely involved.\" The shell should classify bug-hunting work from a paragraph and point to relevant repo targets.",
    prompt: "I'm debugging a modal overlay issue. Escape no longer closes the dialog and I want the safest investigation plan. Figure out what files are likely involved.",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "bug-hunting",
    replyPattern: /modal|overlay|bug hunting|dialog/i
  },
  {
    id: "BUG-SHELL-HUMAN-034",
    title: "Handle review-oriented regression prompts",
    summary: "Prompt: \"Please review the shell changes and tell me where the riskiest regressions probably are before I touch anything.\" The shell should classify this as review work from natural language.",
    prompt: "Please review the shell changes and tell me where the riskiest regressions probably are before I touch anything.",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "review",
    replyPattern: /shell|review|regression/i
  },
  {
    id: "BUG-SHELL-HUMAN-035",
    title: "Handle refactor-plan paragraphs",
    summary: "Prompt: \"I need a refactor plan for provider routing so we can simplify fallbacks without breaking local-first behavior.\" The shell should classify refactoring work and search relevant areas.",
    prompt: "I need a refactor plan for provider routing so we can simplify fallbacks without breaking local-first behavior.",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "refactoring",
    replyPattern: /provider|routing|refactoring|fallback/i
  },
  {
    id: "BUG-SHELL-HUMAN-036",
    title: "Handle architecture-design paragraphs",
    summary: "Prompt: \"Design the safest architecture for Telegram remote control before we implement it.\" The shell should classify architecture/design work from a natural request.",
    prompt: "Design the safest architecture for Telegram remote control before we implement it.",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "architectural-design",
    replyPattern: /telegram|architecture|design/i
  },
  {
    id: "BUG-SHELL-HUMAN-037",
    title: "Handle risky-rollout prompts",
    summary: "Prompt: \"Help me plan a rollout for a risky shell mutation feature with guards and fallback.\" The shell should classify risky-planning work.",
    prompt: "Help me plan a rollout for a risky shell mutation feature with guards and fallback.",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "risky-planning",
    replyPattern: /shell|rollout|guard|fallback/i
  },
  {
    id: "BUG-SHELL-HUMAN-038",
    title: "Handle task-decomposition paragraphs",
    summary: "Prompt: \"Break down the work to make the shell understand long natural-language paragraphs about coding tasks.\" The shell should classify decomposition work.",
    prompt: "Break down the work to make the shell understand long natural-language paragraphs about coding tasks.",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "task-decomposition",
    replyPattern: /shell|paragraph|task decomposition|coding/i
  },
  {
    id: "BUG-SHELL-HUMAN-039",
    title: "Handle implementation-path prompts",
    summary: "Prompt: \"I need to implement a new overlay focus trap; what model path and repo areas would you use?\" The shell should classify code-generation work from a conversational paragraph.",
    prompt: "I need to implement a new overlay focus trap; what model path and repo areas would you use?",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "code-generation",
    replyPattern: /overlay|focus|code generation|model/i
  },
  {
    id: "BUG-SHELL-HUMAN-040",
    title: "Handle UI-layout paragraphs",
    summary: "Prompt: \"The UI layout around the dialog feels cramped on mobile. How would you approach the layout work?\" The shell should classify UI layout work.",
    prompt: "The UI layout around the dialog feels cramped on mobile. How would you approach the layout work?",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "ui-layout",
    replyPattern: /dialog|mobile|layout/i
  },
  {
    id: "BUG-SHELL-HUMAN-041",
    title: "Handle UI-styling paragraphs",
    summary: "Prompt: \"The styling of the shell demo looks rough. I want a better typography and color direction.\" The shell should classify styling work.",
    prompt: "The styling of the shell demo looks rough. I want a better typography and color direction.",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "ui-styling",
    replyPattern: /shell|styling|typography|color/i
  },
  {
    id: "BUG-SHELL-HUMAN-042",
    title: "Handle design-token paragraphs",
    summary: "Prompt: \"I need design tokens for shell/operator surfaces so colors and spacing stay coherent.\" The shell should classify design-token work.",
    prompt: "I need design tokens for shell/operator surfaces so colors and spacing stay coherent.",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "design-tokens",
    replyPattern: /shell|tokens|spacing|color/i
  },
  {
    id: "BUG-SHELL-HUMAN-043",
    title: "Handle prose-composition prompts",
    summary: "Prompt: \"Write a concise migration note for changing shell planner fallback behavior.\" The shell should classify prose-composition work.",
    prompt: "Write a concise migration note for changing shell planner fallback behavior.",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "prose-composition",
    replyPattern: /shell|migration|fallback|note/i
  },
  {
    id: "BUG-SHELL-HUMAN-044",
    title: "Handle operator-update summarization prompts",
    summary: "Prompt: \"Please summarize the current shell work into a short operator update.\" The shell should classify summarization work.",
    prompt: "Please summarize the current shell work into a short operator update.",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "summarization",
    replyPattern: /shell|operator|summary|update/i
  },
  {
    id: "BUG-SHELL-HUMAN-045",
    title: "Handle bug-hunting shipping paragraphs",
    summary: "Prompt: \"I need you to hunt bugs around projections and shell explainers before I ship this.\" The shell should classify bug-hunting work and preserve the projections/shell subject.",
    prompt: "I need you to hunt bugs around projections and shell explainers before I ship this.",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "bug-hunting",
    replyPattern: /projections|shell|bug hunting|ship/i
  },
  {
    id: "BUG-SHELL-HUMAN-046",
    title: "Handle architecture-audit paragraphs",
    summary: "Prompt: \"Audit the architecture around projections, routing, and shell fallback, then suggest the cleanest design direction.\" The shell should treat this as architecture/design work.",
    prompt: "Audit the architecture around projections, routing, and shell fallback, then suggest the cleanest design direction.",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "architectural-design",
    replyPattern: /projections|routing|shell|design/i
  },
  {
    id: "BUG-SHELL-HUMAN-047",
    title: "Handle review-plan paragraphs before refactors",
    summary: "Prompt: \"I'm about to refactor the modal dialog stack. Before I code, I want a review-oriented plan with likely hotspots and guardrails.\" The shell should classify review work and preserve modal/dialog context.",
    prompt: "I'm about to refactor the modal dialog stack. Before I code, I want a review-oriented plan with likely hotspots and guardrails.",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "review",
    replyPattern: /modal|dialog|review|guardrails/i
  },
  {
    id: "BUG-SHELL-HUMAN-048",
    title: "Handle long-form routing/debug paragraphs",
    summary: "Prompt: \"I have a long, messy request: the shell should read a paragraph about broken provider routing, propose a debugging angle, and point me at the most relevant files. How would you handle that?\" The shell should classify bug-hunting work and preserve provider-routing context.",
    prompt: "I have a long, messy request: the shell should read a paragraph about broken provider routing, propose a debugging angle, and point me at the most relevant files. How would you handle that?",
    acceptableActionTypes: ["route"],
    expectedTaskClass: "bug-hunting",
    replyPattern: /provider|routing|debug|files/i
  }
];
