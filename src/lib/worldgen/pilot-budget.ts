import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Explicit user-authorized cumulative ceiling; original plans and reservations stay immutable. */
export function pilotCeilingEur(directory: string): number {
  let ceiling = 5;
  for (const [file, previous, next] of [
    ["budget-authorization.json", 5, 10],
    ["budget-authorization-30.json", 10, 30],
    ["budget-authorization-40.json", 30, 40],
  ] as const) {
    const path = join(directory, file);
    if (!existsSync(path)) continue;
    const authorization = JSON.parse(readFileSync(path, "utf8"));
    if (
      authorization.version !== 1 ||
      ceiling !== previous ||
      authorization.previousCeilingEur !== previous ||
      authorization.ceilingEur !== next ||
      authorization.scope !== "cumulative-pilot" ||
      authorization.authorizedByUser !== true
    )
      throw new Error("Autorisation budgétaire du pilote invalide.");
    ceiling = next;
  }
  return ceiling;
}
