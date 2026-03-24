/**
 * Responsibility: Shared routing fixture.
 * Scope: Provide a deterministic dependency target for the parser.
 */

export function routeWork(input) {
  if (!input) {
    return "idle";
  }

  return input.trim().toLowerCase();
}
