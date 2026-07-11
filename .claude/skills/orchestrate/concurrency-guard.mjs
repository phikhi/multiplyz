#!/usr/bin/env node
// concurrency-guard.mjs — verrou d'exclusion mutuelle au DÉMARRAGE de l'orchestrateur (ADR 0004 / issue #264, Option A).
//
// Problème résolu : deux runs `continue multiplyz` (cron) qui se recouvrent → merges parallèles,
// clôtures d'épic prématurées, worktrees/branches écrasés, tokens gâchés (#264, 2 collisions réelles).
//
// Portée (honnête — ne pas sur-revendiquer, cf. #164) : ce verrou empêche de DÉMARRER une story
// tant qu'un BUILD concurrent est verrouillé. Il réduit fortement le recouvrement mais ne couvre
// PAS la fenêtre planning/merge/clôture d'épic d'un autre run (main checkout, aucun lock agent-*) —
// full-exclusion pleine-durée = variante lockfile/flock (#264, follow-up).
//
// Principe : un build de story tourne dans un worktree `.claude/worktrees/agent-*` VERROUILLÉ
// (git worktree lock ; le fichier `.git/worktrees/<name>/locked` porte la raison
// « claude agent <name> (pid NNNNN start ...) »). Au DÉMARRAGE (avant que CE run n'ait spawn
// le moindre subagent), tout verrou `agent-*` dont le pid est VIVANT appartient forcément à un
// AUTRE run → collision → CE run doit s'abstenir de démarrer une story (yield).
//
// Un verrou dont le pid est MORT est ORPHELIN (run crashé/coupé) : il ne doit PAS bloquer
// indéfiniment → verdict STALE, l'orchestrateur le nettoie (`git worktree remove --force`) puis continue.
//
// Sortie : JSON sur stdout + une ligne humaine sur stderr. Codes de sortie :
//   0 = CLEAR (aucun verrou vivant ; ok pour démarrer)
//   0 = STALE (verrous morts à nettoyer ; ok pour démarrer APRÈS nettoyage — liste dans `.stale`)
//   3 = BLOCKED (au moins un verrou VIVANT d'un autre run → NE PAS démarrer de story, yield)
//
// Pur stdlib, zéro dépendance. Ne tue jamais un process, ne supprime jamais un worktree
// (le nettoyage des orphelins reste une action explicite de l'orchestrateur, tracée).

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// .claude/skills/orchestrate → racine repo = ../../..
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const GIT_WORKTREES_DIR = join(REPO_ROOT, ".git", "worktrees");

/** pid vivant ? signal 0 ne tue rien, teste juste l'existence + la permission. */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = process existe mais appartient à un autre user → vivant.
    return err && err.code === "EPERM";
  }
}

/** branche pointée par un worktree (pour le rapport). */
function worktreeBranch(wtGitDir) {
  try {
    const head = readFileSync(join(wtGitDir, "HEAD"), "utf8").trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return m ? m[1] : head.slice(0, 12);
  } catch {
    return null;
  }
}

function scan() {
  const locks = [];
  if (!existsSync(GIT_WORKTREES_DIR)) return locks;
  for (const name of readdirSync(GIT_WORKTREES_DIR)) {
    // Convention multiplyz : seuls les worktrees de build subagent sont `agent-*`.
    if (!name.startsWith("agent-")) continue;
    const wtGitDir = join(GIT_WORKTREES_DIR, name);
    const lockedFile = join(wtGitDir, "locked");
    if (!existsSync(lockedFile)) continue;
    let reason = "";
    try {
      reason = readFileSync(lockedFile, "utf8").trim();
    } catch {
      reason = "";
    }
    const pidMatch = reason.match(/pid\s+(\d+)/i);
    const pid = pidMatch ? Number(pidMatch[1]) : null;
    // pid non parsable = liveness INDÉTERMINABLE → fail-safe vers "vivant" (bloquer),
    // jamais "mort" : STALE conseille `remove --force`, on ne détruit pas un worktree
    // potentiellement vivant sur une raison de verrou inattendue.
    const pidUnknown = pid == null;
    locks.push({
      worktree: name,
      branch: worktreeBranch(wtGitDir),
      pid,
      pidUnknown,
      alive: pidUnknown || pidAlive(pid),
      reason,
    });
  }
  return locks;
}

const locks = scan();
const live = locks.filter((l) => l.alive);
const stale = locks.filter((l) => !l.alive);

let verdict, exitCode;
if (live.length > 0) {
  verdict = "BLOCKED";
  exitCode = 3;
} else if (stale.length > 0) {
  verdict = "STALE";
  exitCode = 0;
} else {
  verdict = "CLEAR";
  exitCode = 0;
}

const out = {
  verdict,
  live: live.map(({ worktree, branch, pid }) => ({ worktree, branch, pid })),
  stale: stale.map(({ worktree, branch, pid }) => ({ worktree, branch, pid })),
  advice:
    verdict === "BLOCKED"
      ? "Un AUTRE run orchestrateur est ACTIF (verrou vivant). NE PAS démarrer de story — yield + stop propre (ADR 0004 §1, #264 Option A)."
      : verdict === "STALE"
        ? "Verrou(s) ORPHELIN(s) (pid mort) : nettoyer via `git worktree remove --force .claude/worktrees/<name>` puis continuer."
        : "Aucun run concurrent — ok pour démarrer.",
};

process.stdout.write(JSON.stringify(out, null, 2) + "\n");

const human =
  verdict === "BLOCKED"
    ? `[lock] BLOCKED — run concurrent actif : ${live
        .map(
          (l) =>
            `${l.worktree}@${l.branch ?? "?"} (${l.pidUnknown ? "pid inconnu → fail-safe" : `pid ${l.pid} vivant`})`,
        )
        .join(", ")} → YIELD, ne pas démarrer de story.`
    : verdict === "STALE"
      ? `[lock] STALE — orphelin(s) à nettoyer : ${stale
          .map((l) => `${l.worktree}@${l.branch ?? "?"} (pid ${l.pid ?? "?"} mort)`)
          .join(", ")} → remove --force puis continuer.`
      : `[lock] CLEAR — aucun verrou agent-* vivant.`;
process.stderr.write(human + "\n");

process.exit(exitCode);
