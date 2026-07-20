#!/usr/bin/env node
// concurrency-guard.mjs — verrou d'exclusion mutuelle de l'orchestrateur (ADR 0004 / #264 Option A, #290/#298).
//
// Problème résolu : deux runs `continue multiplyz` qui se recouvrent → merges parallèles,
// clôtures d'épic prématurées, worktrees/branches écrasés, revue bloquante contournée (#290, 3 collisions réelles).
//
// ── DEUX verrous, deux portées (honnête, #164 — ne pas sur-revendiquer) ─────────────────────────
// 1. **Verrou `agent-*` (build)** — un build de story tourne dans un worktree `.claude/worktrees/agent-*`
//    VERROUILLÉ (git worktree lock ; `.git/worktrees/<name>/locked` porte « claude agent <name> (pid NNNNN …) »).
//    Tout verrou dont le pid est VIVANT appartient à un AUTRE run → collision. Un verrou à pid MORT est
//    ORPHELIN → STALE (nettoyage explicite par l'orchestrateur). **Comportement inchangé depuis #264.**
// 2. **Verrou de SESSION pleine-durée (#298)** — `.session-lock.json` (gitignoré), posé par `acquire` au
//    démarrage du run et rafraîchi par `heartbeat`. Il couvre la fenêtre que le verrou `agent-*` ne voit
//    PAS : planning → choix de story → **merge** → rétro (entre deux builds, aucun worktree n'est verrouillé).
//
// Le verdict global = BLOCKED si l'UN des deux bloque ; sinon STALE si des orphelins `agent-*` restent ;
// sinon CLEAR. Le verrou de session **s'ajoute** au verdict `agent-*`, il ne le remplace pas.
//
// ── Ce que ce guard n'est PAS ────────────────────────────────────────────────────────────────────
// Ce n'est **pas** un « anti-collision garanti ». Les deux verrous sont **consultatifs** : aucun verrou
// noyau, pas de `flock`, aucune sérialisation imposée. Un run qui n'appelle pas le guard n'est pas
// contraint, et deux `acquire` exactement simultanés peuvent se croiser (course résiduelle assumée).
// Le verrou de session est **FAIL-OPEN strict** : tout état incertain (pid indéterminable/mort, heartbeat
// périmé, âge > plafond, fichier corrompu) → CLEAR. Pire cas d'un bug = comportement d'aujourd'hui
// (une collision non empêchée), jamais un deadlock où tous les runs cèdent à jamais. Cf. `session-lock.mjs`.
//
// ── Usage ───────────────────────────────────────────────────────────────────────────────────────
//   node concurrency-guard.mjs                 # check (défaut) : scanne agent-* + lock de session
//   node concurrency-guard.mjs acquire         # pose le lock de session (au démarrage du run, après le check)
//   node concurrency-guard.mjs heartbeat       # rafraîchit `heartbeatAt` (à chaque frontière de story)
//   node concurrency-guard.mjs release         # retire le lock de session (sortie propre)
//   node concurrency-guard.mjs acquire --note="epic 8"
//
// Env (⚙️ + injection) : SESSION_LOCK_TTL_MIN · SESSION_LOCK_MAX_AGE_MIN · SESSION_LOCK_MAX_ANCESTOR_DEPTH
//                        SESSION_LOCK_PATH (chemin du lock) · SESSION_LOCK_PID (pid propriétaire explicite).
//
// Sortie : JSON sur stdout + une ligne humaine sur stderr. Codes de sortie :
//   0 = CLEAR (rien de vivant ; ok pour démarrer)
//   0 = STALE (orphelins `agent-*` à nettoyer ; ok pour démarrer APRÈS nettoyage — liste dans `.stale`)
//   3 = BLOCKED (un build `agent-*` VIVANT ou une SESSION vivante d'un autre run → yield)
//   3 = `acquire` refusé (une session étrangère vivante détient déjà le lock)
//
// Pur stdlib, zéro dépendance. Ne tue jamais un process, ne supprime jamais un worktree
// (le nettoyage des orphelins reste une action explicite de l'orchestrateur, tracée).

import { readdirSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateSessionLock,
  loadSessionLock,
  planSessionLockAction,
  readSessionLockConfig,
  resolveGuardOwnerPid,
} from "./session-lock.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// .claude/skills/orchestrate → racine repo = ../../..
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const GIT_WORKTREES_DIR = join(REPO_ROOT, ".git", "worktrees");
const SESSION_LOCK_PATH = process.env.SESSION_LOCK_PATH ?? join(HERE, ".session-lock.json");

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

/** `ps -o ppid=,comm= -p <pid>` → { ppid, command } | null (process inexistant / ps indisponible). */
function readProcess(pid) {
  let out;
  try {
    out = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  const match = out.trim().match(/^(\d+)\s+(.+)$/);
  if (!match) return null;
  return { ppid: Number(match[1]), command: match[2].trim() };
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

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

const ACTIONS = new Set(["check", "acquire", "heartbeat", "release"]);
const argv = process.argv.slice(2);
const action = argv.find((a) => ACTIONS.has(a)) ?? "check";
const noteArg = argv.find((a) => a.startsWith("--note="));
const note = noteArg ? noteArg.slice("--note=".length) : null;

const config = readSessionLockConfig(process.env);
const owner = resolveGuardOwnerPid({
  env: process.env,
  selfPid: process.pid,
  readProcess,
  maxAncestorDepth: config.maxAncestorDepth,
});

const loaded = loadSessionLock({
  lockPath: SESSION_LOCK_PATH,
  readFile: (p) => readFileSync(p, "utf8"),
  fileExists: (p) => existsSync(p),
});

const session = evaluateSessionLock({
  lock: loaded.lock,
  loadReason: loaded.reason,
  nowMs: Date.now(),
  ownerPid: owner.pid,
  pidAlive,
  ttlMin: config.ttlMin,
  maxAgeMin: config.maxAgeMin,
});

const sessionReport = {
  verdict: session.verdict,
  reason: session.reason,
  lockPath: SESSION_LOCK_PATH,
  ownerPid: owner.pid,
  pidSource: owner.source,
  selfPid: process.pid,
  ttlMin: config.ttlMin,
  maxAgeMin: config.maxAgeMin,
  lock: loaded.lock,
};

if (action === "check") {
  const locks = scan();
  const live = locks.filter((l) => l.alive);
  const stale = locks.filter((l) => !l.alive);
  const sessionBlocked = session.verdict === "BLOCKED";

  let verdict, exitCode;
  if (live.length > 0 || sessionBlocked) {
    verdict = "BLOCKED";
    exitCode = 3;
  } else if (stale.length > 0) {
    verdict = "STALE";
    exitCode = 0;
  } else {
    verdict = "CLEAR";
    exitCode = 0;
  }

  const advice =
    verdict === "BLOCKED"
      ? "Un AUTRE run orchestrateur est ACTIF (build agent-* vivant et/ou session vivante). NE PAS démarrer de story — yield + stop propre (ADR 0004 §1, #264/#290)."
      : verdict === "STALE"
        ? "Verrou(s) ORPHELIN(s) (pid mort) : nettoyer via `git worktree remove --force .claude/worktrees/<name>` puis continuer."
        : "Aucun run concurrent détecté — ok pour démarrer (verrou consultatif + fail-open : absence de blocage ne PROUVE pas l'absence de concurrent).";

  const out = {
    verdict,
    action,
    live: live.map(({ worktree, branch, pid }) => ({ worktree, branch, pid })),
    stale: stale.map(({ worktree, branch, pid }) => ({ worktree, branch, pid })),
    session: sessionReport,
    advice,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");

  const sessionSuffix = sessionBlocked
    ? `session pid ${loaded.lock?.pid ?? "?"} vivante`
    : `session ${session.reason}`;
  const human =
    verdict === "BLOCKED"
      ? `[lock] BLOCKED — run concurrent actif : ${
          live.length > 0
            ? live
                .map(
                  (l) =>
                    `${l.worktree}@${l.branch ?? "?"} (${l.pidUnknown ? "pid inconnu → fail-safe" : `pid ${l.pid} vivant`})`,
                )
                .join(", ")
            : sessionSuffix
        } → YIELD, ne pas démarrer de story.`
      : verdict === "STALE"
        ? `[lock] STALE — orphelin(s) à nettoyer : ${stale
            .map((l) => `${l.worktree}@${l.branch ?? "?"} (pid ${l.pid ?? "?"} mort)`)
            .join(", ")} → remove --force puis continuer.`
        : `[lock] CLEAR — aucun verrou agent-* vivant, ${sessionSuffix}.`;
  process.stderr.write(human + "\n");
  process.exit(exitCode);
}

// acquire / heartbeat / release
const plan = planSessionLockAction({
  action,
  lock: loaded.lock,
  evaluation: session,
  ownerPid: owner.pid,
  pidSource: owner.source,
  nowIso: new Date().toISOString(),
  host: hostname(),
  note,
});

if (plan.op === "write") {
  writeFileSync(SESSION_LOCK_PATH, JSON.stringify(plan.record, null, 2) + "\n", "utf8");
} else if (plan.op === "remove") {
  rmSync(SESSION_LOCK_PATH, { force: true });
}

// `acquire` refusé par une session étrangère vivante = même sémantique que BLOCKED (yield).
const exitCode = action === "acquire" && plan.outcome === "blocked" ? 3 : 0;

process.stdout.write(
  JSON.stringify(
    {
      verdict: plan.outcome === "blocked" ? "BLOCKED" : "OK",
      action,
      outcome: plan.outcome,
      op: plan.op,
      record: plan.record ?? null,
      session: sessionReport,
    },
    null,
    2,
  ) + "\n",
);
process.stderr.write(
  `[lock] ${action} → ${plan.outcome} (pid ${owner.pid ?? "?"} via ${owner.source}, ${SESSION_LOCK_PATH})\n`,
);
process.exit(exitCode);
