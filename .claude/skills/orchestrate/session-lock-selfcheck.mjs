#!/usr/bin/env node
// session-lock-selfcheck.mjs — validation EMPIRIQUE du verrou de session (#298 AC6).
//
// Pourquoi ce script existe (#296 / #189) : `CLEAR` est le cas COURANT du guard. Une sortie CLEAR
// ne prouve RIEN — un verrou totalement inerte rend CLEAR lui aussi. Avant de croire le guard, il
// faut le voir dire **BLOCKED** sur un cas VIVANT CONNU, puis repasser CLEAR quand ce cas meurt.
// Les fixtures unitaires ne prouvent pas le chemin RÉEL (vrai `ps`, vrai fichier, vrai `process.kill`) :
// ce self-check exerce le binaire tel qu'il tourne en production d'orchestration.
//
// Trois étapes :
//   1. ANCÊTRIE (AC2)  — `acquire` sans pid injecté : le pid stocké doit être un ANCÊTRE, pas le pid
//                        du `node` éphémère ; un second appel (autre process éphémère) doit voir ce
//                        lock comme `self` — impossible si le pid stocké était l'éphémère (il serait mort).
//   2. BLOCKED (AC6)   — vrai process de fond + `acquire` en SON nom → `check` doit rendre BLOCKED (exit 3).
//   3. CLEAR (AC6)     — on tue ce process → `check` doit rendre CLEAR/`pid-dead` (fail-open).
//
// Le chemin du lock est redirigé vers un fichier TEMPORAIRE (`SESSION_LOCK_PATH`) pour ne jamais
// écraser le lock d'une session réelle en cours. Tout le reste est le chemin de production.
//
// Usage : node .claude/skills/orchestrate/session-lock-selfcheck.mjs
// Sortie : le détail de chaque étape ; exit 0 si tout est conforme, 1 sinon.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, "concurrency-guard.mjs");

const tmpDir = mkdtempSync(join(tmpdir(), "mz-session-lock-"));
const lockPath = join(tmpDir, ".session-lock.json");

const failures = [];

function check(label, condition, detail) {
  const status = condition ? "OK  " : "FAIL";
  console.log(`  [${status}] ${label}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!condition) failures.push(label);
}

function runGuard(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [GUARD, ...args], {
    encoding: "utf8",
    env: { ...process.env, SESSION_LOCK_PATH: lockPath, ...extraEnv },
  });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = null;
  }
  return { code: result.status, json, stderr: result.stderr.trim() };
}

/** Lance un process de fond RÉEL, ré-parenté à launchd (double fork) pour être reapé dès qu'il meurt. */
function spawnBackgroundSleeper() {
  const out = spawnSync(
    "sh",
    ["-c", `${process.execPath} -e 'setTimeout(() => {}, 600000)' >/dev/null 2>&1 & echo $!`],
    { encoding: "utf8" },
  );
  return Number(out.stdout.trim());
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitUntilDead(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    spawnSync("sleep", ["0.1"]);
  }
  return false;
}

console.log(`session-lock self-check — lock temporaire : ${lockPath}\n`);

try {
  // ── Étape 1 : le pid stocké SURVIT à l'invocation (AC2, ancêtrie réelle) ─────────────────────
  console.log("1. ANCÊTRIE — le pid stocké n'est pas celui du node éphémère");
  const acquired = runGuard(["acquire", "--note=selfcheck-ancestry"]);
  const record = acquired.json?.record ?? null;
  const selfPid = acquired.json?.session?.selfPid ?? null;

  check(
    "acquire réussi",
    acquired.json?.outcome === "acquired",
    `outcome=${acquired.json?.outcome}`,
  );
  check(
    "pid stocké ≠ pid du process éphémère du guard",
    record !== null && selfPid !== null && record.pid !== selfPid,
    `stocké=${record?.pid} éphémère=${selfPid}`,
  );
  check(
    "pid résolu par remontée d'ancêtres",
    record?.pidSource === "ancestor",
    `source=${record?.pidSource}`,
  );

  // Preuve décisive : un NOUVEAU process éphémère relit le lock. Si le pid stocké avait été
  // l'éphémère de l'étape précédente, il serait mort → `pid-dead`. Il rend `self` → il est vivant
  // ET c'est bien le process du run courant.
  const reread = runGuard(["check"]);
  check(
    "un second guard (autre process) voit ce lock comme `self` VIVANT",
    reread.json?.session?.reason === "self",
    `reason=${reread.json?.session?.reason}`,
  );

  const released = runGuard(["release"]);
  check(
    "release retire le lock",
    released.json?.outcome === "released",
    `outcome=${released.json?.outcome}`,
  );

  // ── Étape 2 : BLOCKED sur un process de fond RÉEL (AC6) ───────────────────────────────────────
  console.log("\n2. BLOCKED — verrou pris au nom d'un vrai process de fond vivant");
  const bgPid = spawnBackgroundSleeper();
  check(
    "process de fond lancé et vivant",
    Number.isInteger(bgPid) && isAlive(bgPid),
    `pid=${bgPid}`,
  );

  const foreignAcquire = runGuard(["acquire", "--note=selfcheck-foreign"], {
    SESSION_LOCK_PID: String(bgPid),
  });
  check(
    "acquire au nom du process de fond",
    foreignAcquire.json?.record?.pid === bgPid,
    `pid=${foreignAcquire.json?.record?.pid}`,
  );

  const blocked = runGuard(["check"]);
  check(
    "session.verdict = BLOCKED",
    blocked.json?.session?.verdict === "BLOCKED",
    `reason=${blocked.json?.session?.reason}`,
  );
  check(
    "verdict global = BLOCKED",
    blocked.json?.verdict === "BLOCKED",
    `verdict=${blocked.json?.verdict}`,
  );
  check("code de sortie = 3 (yield)", blocked.code === 3, `exit=${blocked.code}`);

  // ── Étape 3 : CLEAR dès que le process meurt (AC6, fail-open) ─────────────────────────────────
  console.log("\n3. CLEAR — le process meurt, le verrou se libère (fail-open)");
  process.kill(bgPid, "SIGKILL");
  check("process de fond effectivement mort", waitUntilDead(bgPid), `pid=${bgPid}`);

  const cleared = runGuard(["check"]);
  check(
    "session.verdict = CLEAR",
    cleared.json?.session?.verdict === "CLEAR",
    `verdict=${cleared.json?.session?.verdict}`,
  );
  check(
    "raison = pid-dead",
    cleared.json?.session?.reason === "pid-dead",
    `reason=${cleared.json?.session?.reason}`,
  );
  check("code de sortie = 0 (démarrage autorisé)", cleared.code === 0, `exit=${cleared.code}`);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log(
  failures.length === 0
    ? "\n✅ self-check OK — le verrou sait dire BLOCKED sur un vivant connu, et CLEAR dès qu'il meurt."
    : `\n❌ self-check ÉCHOUÉ (${failures.length}) : ${failures.join(" · ")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
