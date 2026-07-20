// session-lock.mjs — logique PURE du verrou de session pleine-durée FAIL-OPEN (issue #298 / tracker #290).
//
// Ce module ne fait AUCUNE I/O : tout (lecture de fichier, `ps`, horloge, liveness de pid) est
// INJECTÉ par l'appelant (`concurrency-guard.mjs` en prod, fixtures en test). C'est un point
// d'injection RÉEL, pas un stub appelé en dur (#184) — le self-check owner-run s'en sert.
//
// ── Portée RÉELLE (honnête, #164 — ne pas sur-revendiquer) ───────────────────────────────────
// Ce verrou couvre la fenêtre **pleine-durée** d'un run orchestrateur : planning → choix de story
// → build → merge → rétro. C'est le gap que le verrou `agent-*` (worktrees de build verrouillés,
// `concurrency-guard.mjs`) ne voit PAS : entre deux builds, un run n'a aucun worktree verrouillé.
//
// Ce qu'il ne couvre PAS / ne garantit PAS :
//   - ce n'est **PAS** un « anti-collision garanti ». C'est un verrou **consultatif** (advisory) :
//     il ne prend aucun verrou noyau, n'utilise pas `flock`, et **ne sérialise rien** par lui-même ;
//     il informe un run qui le CONSULTE au démarrage qu'un autre run semble actif.
//   - deux `acquire` **exactement simultanés** peuvent se croiser (lecture-puis-écriture non atomique) :
//     fenêtre de course résiduelle assumée, non fermée par cette story.
//   - un run qui **n'appelle pas** le guard (tir manuel hors skill) n'est pas contraint.
//   - la liveness repose sur un **pid d'ancêtre** (cf. `resolveOwnerPid`) : si l'ancêtre n'est pas
//     résoluble, le verrou se dégrade en CLEAR (voir fail-open ci-dessous).
//   - **réutilisation de pid** : l'OS recycle les pids. Un lock abandonné dont le pid a été réattribué
//     à un process sans rapport rend `pidAlive()` vrai à tort → **faux BLOCKED**, borné par le TTL
//     puis par le plafond `MAX_AGE`. Non détectable ici (aucun jeton d'identité de process stocké).
//   - le pid propriétaire est le process `claude` du run, qui **SURVIT à la fin d'un run** (l'app
//     reste ouverte) : la liveness du pid ne détecte donc PAS un run terminé — ce sont le TTL et
//     `MAX_AGE` qui libèrent un lock abandonné, d'où leur calibration ci-dessous.
//
// ── FAIL-OPEN strict (principe non négociable, #290) ─────────────────────────────────────────
// Tout état INCERTAIN → **CLEAR** (le run démarre) : pas de lock, fichier illisible/corrompu, JSON
// invalide, pid absent/non entier, pid mort, `heartbeatAt` périmé, `startedAt` au-delà du plafond,
// horodatage illisible. **BLOCKED** exige la conjonction COMPLÈTE des trois gardes (pid vivant ET
// heartbeat frais ET âge sous plafond) sur un lock appartenant à un AUTRE run.
// Pire cas d'un bug ici = « le verrou n'a pas empêché une collision » = comportement d'AUJOURD'HUI
// (zéro régression), jamais un deadlock où tous les runs cèdent à jamais.

/**
 * ⚙️ Paramètres à CALIBRER — surchargeables par env (cf. `readSessionLockConfig`).
 *
 * Calibrés sur la cadence RÉELLE de l'orchestrateur, pas sur des valeurs de principe :
 *
 * - `ttlMin` : le plus long intervalle SANS TOUR de l'orchestrateur est un **build délégué à un
 *   subagent** — pendant ce temps le thread principal ne joue aucun tour et ne peut donc pas
 *   battre (observé : 20–60 min). 90 min = marge ~1,5× au-dessus du maximum observé, pour ne
 *   jamais faire expirer le lock d'un run LÉGITIMEMENT en cours.
 * - `maxAgeMin` : un run réel enchaîne plusieurs stories sur une fenêtre de quota de 5 h.
 *   360 min (6 h) = au-dessus d'une fenêtre pleine, pour ne pas déposséder un run vivant.
 *
 * Ces deux valeurs bornent la durée d'un lock FANTÔME (run terminé sans `release`, dont le
 * process propriétaire reste vivant). Résidu assumé, documenté en `SKILL.md` §1.0 : ces
 * plafonds achètent la sûreté du run légitime au prix d'une fenêtre de faux BLOCKED plus longue.
 */
export const SESSION_LOCK_DEFAULTS = Object.freeze({
  /** ⚙️ `SESSION_LOCK_TTL_MIN` — au-delà, le heartbeat est périmé → CLEAR (cœur de l'anti-deadlock). */
  ttlMin: 90,
  /** ⚙️ `SESSION_LOCK_MAX_AGE_MIN` — plafond DUR sur `startedAt`, même heartbeat frais → CLEAR. */
  maxAgeMin: 360,
  /** ⚙️ `SESSION_LOCK_MAX_ANCESTOR_DEPTH` — profondeur max de remontée d'ancêtres (`ps`). */
  maxAncestorDepth: 8,
});

/** Raisons émises dans le JSON du guard (contrat de sortie lu par l'orchestrateur). */
export const SESSION_LOCK_REASONS = Object.freeze({
  NO_LOCK: "no-lock",
  UNREADABLE: "lock-unreadable",
  CORRUPT: "lock-corrupt",
  PRESENT: "lock-present",
  PID_INDETERMINATE: "pid-indeterminate",
  SELF: "self",
  PID_DEAD: "pid-dead",
  HEARTBEAT_UNREADABLE: "heartbeat-unreadable",
  HEARTBEAT_EXPIRED: "heartbeat-expired",
  STARTED_UNREADABLE: "started-unreadable",
  MAX_AGE_EXCEEDED: "max-age-exceeded",
  LIVE: "live",
});

/**
 * Commandes considérées comme des enveloppes ÉPHÉMÈRES à traverser quand on remonte l'ancêtrie :
 * le guard est invoqué par un shell jetable, jamais par le process du run lui-même.
 */
export const SHELL_COMMANDS = Object.freeze([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "csh",
  "tcsh",
]);

const MS_PER_MIN = 60_000;

/** basename normalisé d'une commande `ps -o comm=` (darwin renvoie un chemin absolu, `-zsh` si login shell). */
function normalizeCommand(command) {
  if (typeof command !== "string") return "";
  const base = command.trim().split("/").pop();
  return (base.startsWith("-") ? base.slice(1) : base).toLowerCase();
}

/** true si la commande est un shell jetable (à traverser pendant la remontée d'ancêtres). */
export function isShellCommand(command) {
  return SHELL_COMMANDS.includes(normalizeCommand(command));
}

/** ISO 8601 → ms epoch, ou null si illisible (→ fail-open côté verdict). */
function parseInstant(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function readNumber(raw, fallback) {
  if (typeof raw !== "string") return fallback;
  if (raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return fallback;
  return parsed;
}

/** ⚙️ centralisés + surchargeables par env (tests + calibration). */
export function readSessionLockConfig(env) {
  return {
    ttlMin: readNumber(env.SESSION_LOCK_TTL_MIN, SESSION_LOCK_DEFAULTS.ttlMin),
    maxAgeMin: readNumber(env.SESSION_LOCK_MAX_AGE_MIN, SESSION_LOCK_DEFAULTS.maxAgeMin),
    maxAncestorDepth: readNumber(
      env.SESSION_LOCK_MAX_ANCESTOR_DEPTH,
      SESSION_LOCK_DEFAULTS.maxAncestorDepth,
    ),
  };
}

/**
 * Résout le pid du process du RUN (long-vivant), jamais celui du `node` ÉPHÉMÈRE qui exécute le guard.
 *
 * Le point dur d'AC2 : le guard vit quelques millisecondes. Stocker `process.pid` rendrait le lock
 * mort à l'instant où il est écrit → liveness toujours fausse → CLEAR permanent → mécanisme INERTE
 * (#127). On remonte donc l'ancêtrie (`ps -o ppid=,comm=`) en TRAVERSANT les shells jetables et on
 * retient le premier ancêtre non-shell (sur darwin : le process `claude` du run).
 *
 * @param {{startPid:number, readProcess:(pid:number)=>({ppid:number,command:string}|null), maxDepth?:number}} deps
 * @returns {number|null} pid de l'ancêtre long-vivant, ou null si indéterminable (→ fail-open).
 */
export function resolveOwnerPid({
  startPid,
  readProcess,
  maxDepth = SESSION_LOCK_DEFAULTS.maxAncestorDepth,
}) {
  const start = readProcess(startPid);
  if (!start) return null;
  let pid = start.ppid;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    // pid 1 = launchd/init : on a traversé toute l'ancêtrie sans candidat → indéterminable.
    if (!Number.isInteger(pid) || pid <= 1) return null;
    const info = readProcess(pid);
    if (!info) return null;
    if (!isShellCommand(info.command)) return pid;
    pid = info.ppid;
  }
  return null;
}

/**
 * Pid propriétaire effectif du guard : `SESSION_LOCK_PID` (injection explicite, utilisée par le
 * self-check owner-run et les scénarios de test) sinon remontée d'ancêtres.
 */
export function resolveGuardOwnerPid({ env, selfPid, readProcess, maxAncestorDepth }) {
  const raw = env.SESSION_LOCK_PID;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) return { pid: parsed, source: "env" };
    return { pid: null, source: "unresolved" };
  }
  const pid = resolveOwnerPid({ startPid: selfPid, readProcess, maxDepth: maxAncestorDepth });
  if (pid === null) return { pid: null, source: "unresolved" };
  return { pid, source: "ancestor" };
}

/** JSON du lock → objet, ou null (illisible/invalide/non-objet) → fail-open. */
export function parseSessionLockRecord(raw) {
  if (typeof raw !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null) return null;
  if (typeof parsed !== "object") return null;
  if (Array.isArray(parsed)) return null;
  return parsed;
}

/**
 * Charge le lock depuis le disque (I/O injectée).
 * @returns {{lock:object|null, reason:string}}
 */
export function loadSessionLock({ lockPath, readFile, fileExists }) {
  if (!fileExists(lockPath)) return { lock: null, reason: SESSION_LOCK_REASONS.NO_LOCK };
  let raw;
  try {
    raw = readFile(lockPath);
  } catch {
    return { lock: null, reason: SESSION_LOCK_REASONS.UNREADABLE };
  }
  const parsed = parseSessionLockRecord(raw);
  if (!parsed) return { lock: null, reason: SESSION_LOCK_REASONS.CORRUPT };
  return { lock: parsed, reason: SESSION_LOCK_REASONS.PRESENT };
}

/**
 * Verdict du lock de session. **BLOCKED** exige la conjonction COMPLÈTE :
 * lock présent ET pid entier > 0 ET pid d'un AUTRE run ET pid VIVANT ET heartbeat < TTL ET âge < MAX_AGE.
 * Toute autre issue → **CLEAR** (fail-open), avec une `reason` distincte (contrat de sortie).
 */
export function evaluateSessionLock({
  lock,
  loadReason,
  nowMs,
  ownerPid,
  pidAlive,
  ttlMin,
  maxAgeMin,
}) {
  if (!lock) return { verdict: "CLEAR", reason: loadReason };

  const pid = lock.pid;
  // pid absent/non entier = liveness INDÉTERMINABLE → CLEAR (fail-open), distingué de « pid mort »
  // pour que le rapport ne mente pas sur la cause (#164).
  if (!Number.isInteger(pid) || pid <= 0)
    return { verdict: "CLEAR", reason: SESSION_LOCK_REASONS.PID_INDETERMINATE };

  // Lock de CE run (même process propriétaire) : ne jamais s'auto-bloquer — un second appel du
  // guard dans la même session (reprise, re-lancement du skill) doit continuer, pas céder.
  if (pid === ownerPid) return { verdict: "CLEAR", reason: SESSION_LOCK_REASONS.SELF };

  if (!pidAlive(pid)) return { verdict: "CLEAR", reason: SESSION_LOCK_REASONS.PID_DEAD };

  const heartbeatMs = parseInstant(lock.heartbeatAt);
  if (heartbeatMs === null)
    return { verdict: "CLEAR", reason: SESSION_LOCK_REASONS.HEARTBEAT_UNREADABLE };
  if (nowMs - heartbeatMs > ttlMin * MS_PER_MIN)
    return { verdict: "CLEAR", reason: SESSION_LOCK_REASONS.HEARTBEAT_EXPIRED };

  const startedMs = parseInstant(lock.startedAt);
  if (startedMs === null)
    return { verdict: "CLEAR", reason: SESSION_LOCK_REASONS.STARTED_UNREADABLE };
  if (nowMs - startedMs > maxAgeMin * MS_PER_MIN)
    return { verdict: "CLEAR", reason: SESSION_LOCK_REASONS.MAX_AGE_EXCEEDED };

  return { verdict: "BLOCKED", reason: SESSION_LOCK_REASONS.LIVE };
}

/** Enregistrement neuf (acquire). `startedAt` = ancre du plafond dur MAX_AGE. */
export function buildSessionLockRecord({ pid, pidSource, nowIso, host, note }) {
  return { pid, pidSource, startedAt: nowIso, heartbeatAt: nowIso, host, note };
}

/** Rafraîchit le heartbeat SANS toucher `startedAt` (sinon le plafond dur ne plafonnerait rien). */
export function renewSessionLockRecord(lock, nowIso) {
  return { ...lock, heartbeatAt: nowIso };
}

/**
 * Décide (sans I/O) ce que `acquire` / `heartbeat` / `release` doivent écrire.
 *
 * - le lock de CE run → rafraîchi (`startedAt` préservé) ;
 * - un lock ÉTRANGER **vivant** (evaluation BLOCKED) → on ne le vole ni ne l'écrase (`blocked`) ;
 * - un lock étranger périmé/absent/corrompu (evaluation CLEAR) → on prend la place (`acquired`) ;
 * - `release` ne supprime QUE notre propre lock (jamais celui d'un autre run).
 */
export function planSessionLockAction({
  action,
  lock,
  evaluation,
  ownerPid,
  pidSource,
  nowIso,
  host,
  note,
}) {
  // `ownerPid !== null` est INDISPENSABLE : sans lui, un run dont l'ancêtrie est indéterminable
  // (`ownerPid === null`) s'approprierait le lock d'un ÉTRANGER portant `pid: null` (`null === null`)
  // → il l'écraserait et perdrait son `note`. Deux identités INDÉTERMINÉES ne sont pas la même
  // identité. Sans impact fail-open (un lock à pid null rend CLEAR de toute façon), mais bug
  // d'attribution.
  const owned = lock !== null && ownerPid !== null && lock.pid === ownerPid;

  if (action === "release") {
    if (lock === null) return { op: "none", outcome: "absent" };
    if (!owned) return { op: "none", outcome: "foreign" };
    return { op: "remove", outcome: "released" };
  }

  if (owned) {
    return {
      op: "write",
      record: renewSessionLockRecord(lock, nowIso),
      outcome: action === "acquire" ? "renewed" : "beat",
    };
  }

  if (evaluation.verdict === "BLOCKED") return { op: "none", outcome: "blocked" };

  return {
    op: "write",
    record: buildSessionLockRecord({ pid: ownerPid, pidSource, nowIso, host, note }),
    outcome: "acquired",
  };
}
