export const SHELL_HUMAN_CORPUS = [
  {
    id: "BUG-SHELL-HUMAN-001",
    title: "Handle conversational project-status phrasing",
    summary: "Prompt: \"what's the status of this project?\" The shell should answer with project-grounded status instead of a generic planner fallback.",
    prompt: "what's the status of this project?",
    acceptableActionTypes: ["project_summary", "status_query"],
    replyPattern: /project|repo|status/i
  },
  {
    id: "BUG-SHELL-HUMAN-002",
    title: "Handle repo-state phrasing",
    summary: "Prompt: \"can you give me the state of the repo right now?\" The shell should map it to project status.",
    prompt: "can you give me the state of the repo right now?",
    acceptableActionTypes: ["project_summary", "status_query"],
    replyPattern: /repo|project|status/i
  },
  {
    id: "BUG-SHELL-HUMAN-003",
    title: "Handle codebase-health phrasing",
    summary: "Prompt: \"how is the codebase doing?\" The shell should answer with project-grounded status.",
    prompt: "how is the codebase doing?",
    acceptableActionTypes: ["project_summary", "status_query"],
    replyPattern: /codebase|project|status/i
  },
  {
    id: "BUG-SHELL-HUMAN-004",
    title: "Handle shell-quality questions",
    summary: "Prompt: \"how good is the shell?\" The shell should resolve the shell surface and answer directly.",
    prompt: "how good is the shell?",
    acceptableActionTypes: ["status_query"],
    replyPattern: /shell/i
  },
  {
    id: "BUG-SHELL-HUMAN-005",
    title: "Handle shell-assessment paraphrases",
    summary: "Prompt: \"what's up with the shell lately?\" The shell should inspect the shell surface rather than fail generically.",
    prompt: "what's up with the shell lately?",
    acceptableActionTypes: ["status_query"],
    replyPattern: /shell/i
  },
  {
    id: "BUG-SHELL-HUMAN-006",
    title: "Handle quoted shell feature existence questions",
    summary: "Prompt: \"do we have a feature called \\\"shell\\\"?\" The shell should resolve the shell surface or matching module.",
    prompt: "do we have a feature called \"shell\"?",
    acceptableActionTypes: ["status_query", "search"],
    replyPattern: /shell/i
  },
  {
    id: "BUG-SHELL-HUMAN-007",
    title: "Handle named-shell existence questions",
    summary: "Prompt: \"is there anything here named shell?\" The shell should resolve shell-related status or search results.",
    prompt: "is there anything here named shell?",
    acceptableActionTypes: ["status_query", "search"],
    replyPattern: /shell/i
  },
  {
    id: "BUG-SHELL-HUMAN-008",
    title: "Handle direct shell explainer questions",
    summary: "Prompt: \"tell me about the shell\" The shell should explain the shell surface without generic fallback.",
    prompt: "tell me about the shell",
    acceptableActionTypes: ["status_query"],
    replyPattern: /shell/i
  },
  {
    id: "BUG-SHELL-HUMAN-009",
    title: "Handle projections service explainers",
    summary: "Prompt: \"what is the projections service?\" The shell should mention projections directly and ground the answer in repo evidence.",
    prompt: "what is the projections service?",
    acceptableActionTypes: ["status_query"],
    replyPattern: /projections/i
  },
  {
    id: "BUG-SHELL-HUMAN-010",
    title: "Handle projections module paraphrases",
    summary: "Prompt: \"can you explain the projections module?\" The shell should explain projections instead of failing to parse.",
    prompt: "can you explain the projections module?",
    acceptableActionTypes: ["status_query"],
    replyPattern: /projections/i
  },
  {
    id: "BUG-SHELL-HUMAN-011",
    title: "Handle terminology explainers for claims",
    summary: "Prompt: \"what are claims?\" The shell should answer with the built-in terminology explanation.",
    prompt: "what are claims?",
    acceptableActionTypes: [],
    replyPattern: /claims/i
  },
  {
    id: "BUG-SHELL-HUMAN-012",
    title: "Handle workflow-surface explainers",
    summary: "Prompt: \"teach me about the workflow surface\" The shell should inspect workflow instead of replying generically.",
    prompt: "teach me about the workflow surface",
    acceptableActionTypes: ["status_query"],
    replyPattern: /workflow/i
  },
  {
    id: "BUG-SHELL-HUMAN-013",
    title: "Handle shell-usage tutorial requests",
    summary: "Prompt: \"how do I use you here?\" The shell should return usage guidance.",
    prompt: "how do I use you here?",
    acceptableActionTypes: [],
    replyPattern: /how do i use|summary|search|ticket|route/i
  },
  {
    id: "BUG-SHELL-HUMAN-014",
    title: "Handle request-for-examples prompts",
    summary: "Prompt: \"show me a few example prompts\" The shell should return example shell usage.",
    prompt: "show me a few example prompts",
    acceptableActionTypes: [],
    replyPattern: /example|summary|search|ticket|route/i
  },
  {
    id: "BUG-SHELL-HUMAN-015",
    title: "Handle capability prompts for repo work",
    summary: "Prompt: \"what can I ask you to do in this repo?\" The shell should explain capabilities instead of failing to route.",
    prompt: "what can I ask you to do in this repo?",
    acceptableActionTypes: [],
    replyPattern: /inspect project state|search code|ticket|workflow actions/i
  },
  {
    id: "BUG-SHELL-HUMAN-016",
    title: "Handle current-work phrasing",
    summary: "Prompt: \"what are we working on right now?\" The shell should resolve current work from workflow state.",
    prompt: "what are we working on right now?",
    acceptableActionTypes: ["status_query"],
    replyPattern: /ticket|current|progress|focus/i
  },
  {
    id: "BUG-SHELL-HUMAN-017",
    title: "Handle next-step phrasing",
    summary: "Prompt: \"what should I do next?\" The shell should suggest the next ticket or current focus.",
    prompt: "what should I do next?",
    acceptableActionTypes: [],
    replyPattern: /start with|ticket|active/i
  },
  {
    id: "BUG-SHELL-HUMAN-018",
    title: "Handle active-ticket phrasing",
    summary: "Prompt: \"which tickets are active right now?\" The shell should list active tickets.",
    prompt: "which tickets are active right now?",
    acceptableActionTypes: [],
    replyPattern: /tickets|active/i
  },
  {
    id: "BUG-SHELL-HUMAN-019",
    title: "Handle in-progress phrasing",
    summary: "Prompt: \"what's currently in progress?\" The shell should surface in-progress tickets or say none exist.",
    prompt: "what's currently in progress?",
    acceptableActionTypes: [],
    replyPattern: /in progress|no tickets in progress|current/i
  },
  {
    id: "BUG-SHELL-HUMAN-020",
    title: "Handle provider-health phrasing",
    summary: "Prompt: \"how are the AI providers looking?\" The shell should route to provider status.",
    prompt: "how are the AI providers looking?",
    acceptableActionTypes: ["provider_status"],
    replyPattern: /providers|available|configured/i
  },
  {
    id: "BUG-SHELL-HUMAN-021",
    title: "Handle connected-provider phrasing",
    summary: "Prompt: \"show me the connected providers\" The shell should return provider status.",
    prompt: "show me the connected providers",
    acceptableActionTypes: ["provider_status"],
    replyPattern: /providers|available|configured/i
  },
  {
    id: "BUG-SHELL-HUMAN-022",
    title: "Handle shell-planning route phrasing",
    summary: "Prompt: \"pick a model for shell planning\" The shell should route the shell-planning task.",
    prompt: "pick a model for shell planning",
    acceptableActionTypes: ["route"],
    replyPattern: /shell-planning|provider|model/i
  },
  {
    id: "BUG-SHELL-HUMAN-023",
    title: "Handle natural search phrasing",
    summary: "Prompt: \"search for router\" The shell should map naturally to project search.",
    prompt: "search for router",
    acceptableActionTypes: ["search"],
    replyPattern: /router/i
  },
  {
    id: "BUG-SHELL-HUMAN-024",
    title: "Handle conversational search requests",
    summary: "Prompt: \"can you find router for me?\" The shell should not fail on conversational search phrasing.",
    prompt: "can you find router for me?",
    acceptableActionTypes: ["search", "status_query"],
    replyPattern: /router/i
  },
  {
    id: "BUG-SHELL-HUMAN-025",
    title: "Handle doctor-help phrasing",
    summary: "Prompt: \"doctor help\" The shell should explain the doctor command locally.",
    prompt: "doctor help",
    acceptableActionTypes: [],
    replyPattern: /doctor|usage|diagnostics/i
  },
  {
    id: "BUG-SHELL-HUMAN-026",
    title: "Handle epic shorthand",
    summary: "Prompt: \"epic?\" The shell should answer the current epic state.",
    prompt: "epic?",
    acceptableActionTypes: [],
    replyPattern: /epic/i
  },
  {
    id: "BUG-SHELL-HUMAN-027",
    title: "Handle missing-topic epic creation prompts",
    summary: "Prompt: \"can you write an epic?\" The shell should ask for the topic instead of failing generically.",
    prompt: "can you write an epic?",
    acceptableActionTypes: [],
    replyPattern: /epic|topic|create epic/i
  },
  {
    id: "BUG-SHELL-HUMAN-028",
    title: "Handle compound project-and-next-step prompts",
    summary: "Prompt: \"tell me about this project and what I should tackle next\" The shell should ground the project and suggest next work.",
    prompt: "tell me about this project and what I should tackle next",
    acceptableActionTypes: [],
    replyPattern: /project|start with|ticket/i
  },
  {
    id: "BUG-SHELL-HUMAN-029",
    title: "Handle repo-assessment prompts",
    summary: "Prompt: \"what do you think about this repo?\" The shell should return a repo assessment grounded in current metadata.",
    prompt: "what do you think about this repo?",
    acceptableActionTypes: [],
    replyPattern: /repo|codebase|ticket|module/i
  },
  {
    id: "BUG-SHELL-HUMAN-030",
    title: "Handle workflow-health prompts",
    summary: "Prompt: \"is the workflow healthy?\" The shell should resolve workflow state rather than emitting a parser fallback.",
    prompt: "is the workflow healthy?",
    acceptableActionTypes: ["status_query"],
    replyPattern: /workflow/i
  },
  {
    id: "BUG-SHELL-HUMAN-031",
    title: "Handle projections existence questions",
    summary: "Prompt: \"do we have anything called projections?\" The shell should resolve projections by status or search.",
    prompt: "do we have anything called projections?",
    acceptableActionTypes: ["status_query", "search"],
    replyPattern: /projections/i
  },
  {
    id: "BUG-SHELL-HUMAN-032",
    title: "Handle workflow-status prompts",
    summary: "Prompt: \"what's the status of workflow?\" The shell should resolve the workflow surface.",
    prompt: "what's the status of workflow?",
    acceptableActionTypes: ["status_query"],
    replyPattern: /workflow/i
  }
];
