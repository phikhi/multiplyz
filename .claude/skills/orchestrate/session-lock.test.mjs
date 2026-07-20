import { describe, expect, it, vi } from "vitest";

import {
  SESSION_LOCK_DEFAULTS,
  SESSION_LOCK_REASONS,
  buildSessionLockRecord,
  evaluateSessionLock,
  isShellCommand,
  loadSessionLock,
  parseSessionLockRecord,
  planSessionLockAction,
  readSessionLockConfig,
  renewSessionLockRecord,
  resolveGuardOwnerPid,
  resolveOwnerPid,
} from "./session-lock.mjs";

const NOW_MS = Date.parse("2026-07-20T12:00:00.000Z");
const minutesAgo = (n) => new Date(NOW_MS - n * 60_000).toISOString();

// Les fixtures dérivent des ⚙️ (jamais de minutes en dur) : recalibrer TTL/MAX_AGE ne doit pas
// rendre ces tests vacuous en glissant les entrées du mauvais côté de la borne.
const { ttlMin: TTL, maxAgeMin: MAX_AGE } = SESSION_LOCK_DEFAULTS;

/** Lock étranger PARFAITEMENT vivant : c'est le SEUL cas qui doit rendre BLOCKED. */
const liveForeignLock = (overrides = {}) => ({
  pid: 4242,
  pidSource: "ancestor",
  startedAt: minutesAgo(10),
  heartbeatAt: minutesAgo(1),
  host: "mac",
  note: null,
  ...overrides,
});

const alwaysAlive = () => true;
const neverAlive = () => false;

const evaluate = (overrides = {}) =>
  evaluateSessionLock({
    lock: liveForeignLock(),
    loadReason: SESSION_LOCK_REASONS.PRESENT,
    nowMs: NOW_MS,
    ownerPid: 999, // ≠ lock.pid → lock ÉTRANGER
    pidAlive: alwaysAlive,
    ttlMin: SESSION_LOCK_DEFAULTS.ttlMin,
    maxAgeMin: SESSION_LOCK_DEFAULTS.maxAgeMin,
    ...overrides,
  });

// ── AC2 — le pid stocké doit SURVIVRE à l'invocation ────────────────────────────────────────────
describe("resolveOwnerPid — pid d'ancêtre long-vivant (AC2)", () => {
  /**
   * Ancêtrie réelle observée sur darwin :
   *   node (guard, ÉPHÉMÈRE) → /bin/zsh (shell jetable) → …/MacOS/claude (process du RUN) → …
   */
  const darwinChain = {
    777: { ppid: 666, command: "/opt/homebrew/bin/node" },
    666: { ppid: 555, command: "/bin/zsh" },
    555: {
      ppid: 400,
      command: "/Users/x/Application Support/Claude/claude-code/claude.app/claude",
    },
    400: { ppid: 1, command: "/Applications/Claude.app/Contents/MacOS/Claude" },
  };
  const readProcess = (pid) => darwinChain[pid] ?? null;

  it("remonte les shells jetables et retient le process du RUN — JAMAIS le pid éphémère du guard", () => {
    const resolved = resolveOwnerPid({ startPid: 777, readProcess });

    // Assertion-clé AC2 : si le résolveur retombait sur `process.pid`, le lock serait mort
    // à l'instant de son écriture → CLEAR permanent → mécanisme INERTE (#127).
    expect(resolved).not.toBe(777);
    expect(resolved).toBe(555);
  });

  it("traverse PLUSIEURS shells empilés (zsh → bash) avant de retenir le run", () => {
    const stacked = {
      10: { ppid: 11, command: "node" },
      11: { ppid: 12, command: "-zsh" }, // login shell darwin : préfixe `-`
      12: { ppid: 13, command: "/bin/bash" },
      13: { ppid: 1, command: "claude" },
    };
    expect(resolveOwnerPid({ startPid: 10, readProcess: (pid) => stacked[pid] ?? null })).toBe(13);
  });

  it("rend null quand le process de départ est illisible (→ fail-open)", () => {
    expect(resolveOwnerPid({ startPid: 42, readProcess: () => null })).toBeNull();
  });

  it("rend null quand un ancêtre intermédiaire devient illisible (→ fail-open)", () => {
    const chain = { 1000: { ppid: 1001, command: "node" } };
    expect(
      resolveOwnerPid({ startPid: 1000, readProcess: (pid) => chain[pid] ?? null }),
    ).toBeNull();
  });

  it("rend null quand l'ancêtrie atteint launchd (pid 1) sans candidat", () => {
    const chain = {
      20: { ppid: 21, command: "node" },
      21: { ppid: 1, command: "zsh" },
    };
    expect(resolveOwnerPid({ startPid: 20, readProcess: (pid) => chain[pid] ?? null })).toBeNull();
  });

  it("rend null quand le ppid n'est pas un entier (sortie ps inattendue)", () => {
    const chain = { 30: { ppid: Number.NaN, command: "node" } };
    expect(resolveOwnerPid({ startPid: 30, readProcess: (pid) => chain[pid] ?? null })).toBeNull();
  });

  it("borne la remontée à maxDepth (chaîne de shells infinie → null, pas de boucle)", () => {
    const readProcess = (pid) => ({ ppid: pid + 1, command: "zsh" });
    expect(resolveOwnerPid({ startPid: 1, readProcess, maxDepth: 3 })).toBeNull();
  });
});

describe("isShellCommand", () => {
  it("reconnaît les shells jetables, quel que soit le chemin ou le préfixe de login", () => {
    expect(isShellCommand("/bin/zsh")).toBe(true);
    expect(isShellCommand("-bash")).toBe(true);
    expect(isShellCommand("SH")).toBe(true);
  });

  it("ne prend pas un process de run pour un shell", () => {
    expect(isShellCommand("/Applications/Claude.app/Contents/MacOS/claude")).toBe(false);
    expect(isShellCommand(undefined)).toBe(false);
  });
});

describe("resolveGuardOwnerPid — pid propriétaire effectif du guard", () => {
  const chain = {
    5: { ppid: 6, command: "node" },
    6: { ppid: 7, command: "zsh" },
    7: { ppid: 1, command: "claude" },
  };
  const readProcess = (pid) => chain[pid] ?? null;

  it("par DÉFAUT résout l'ancêtre — le pid stocké n'est jamais celui du process éphémère (AC2)", () => {
    const owner = resolveGuardOwnerPid({ env: {}, selfPid: 5, readProcess, maxAncestorDepth: 8 });

    expect(owner.pid).not.toBe(5);
    expect(owner).toEqual({ pid: 7, source: "ancestor" });
  });

  it("honore l'injection explicite SESSION_LOCK_PID (point d'injection RÉEL du self-check)", () => {
    const owner = resolveGuardOwnerPid({
      env: { SESSION_LOCK_PID: "31337" },
      selfPid: 5,
      readProcess,
      maxAncestorDepth: 8,
    });
    expect(owner).toEqual({ pid: 31337, source: "env" });
  });

  it("ignore un SESSION_LOCK_PID vide et retombe sur l'ancêtrie", () => {
    const owner = resolveGuardOwnerPid({
      env: { SESSION_LOCK_PID: "   " },
      selfPid: 5,
      readProcess,
      maxAncestorDepth: 8,
    });
    expect(owner).toEqual({ pid: 7, source: "ancestor" });
  });

  it("rend un pid null (jamais un pid bidon) sur SESSION_LOCK_PID invalide", () => {
    const owner = resolveGuardOwnerPid({
      env: { SESSION_LOCK_PID: "abc" },
      selfPid: 5,
      readProcess,
      maxAncestorDepth: 8,
    });
    expect(owner).toEqual({ pid: null, source: "unresolved" });
  });

  it("rend un pid null quand l'ancêtrie est indéterminable (→ fail-open)", () => {
    const owner = resolveGuardOwnerPid({
      env: {},
      selfPid: 5,
      readProcess: () => null,
      maxAncestorDepth: 8,
    });
    expect(owner).toEqual({ pid: null, source: "unresolved" });
  });
});

// ── AC3/AC5 — verdict, chaque garde isolée (#206) ───────────────────────────────────────────────
describe("evaluateSessionLock — BLOCKED exige la conjonction COMPLÈTE (AC3)", () => {
  it("lock ÉTRANGER frais + pid VIVANT → BLOCKED", () => {
    expect(evaluate()).toEqual({ verdict: "BLOCKED", reason: SESSION_LOCK_REASONS.LIVE });
  });

  it("garde PID : lock à pid MORT → CLEAR (fail-open)", () => {
    // Entrée par ailleurs PARFAITE (heartbeat frais, âge sous plafond) : seule la garde pid
    // peut épingler ce test (#206).
    expect(evaluate({ pidAlive: neverAlive })).toEqual({
      verdict: "CLEAR",
      reason: SESSION_LOCK_REASONS.PID_DEAD,
    });
  });

  it("garde HEARTBEAT : heartbeat périmé avec pid VIVANT → CLEAR (cœur de l'anti-deadlock)", () => {
    // pid VIVANT + âge sous plafond → la garde pid et le plafond MAX_AGE laissent passer ;
    // seule la garde TTL peut rendre CLEAR ici (#206).
    const lock = liveForeignLock({
      startedAt: minutesAgo(TTL + 5),
      heartbeatAt: minutesAgo(TTL + 1),
    });

    expect(evaluate({ lock })).toEqual({
      verdict: "CLEAR",
      reason: SESSION_LOCK_REASONS.HEARTBEAT_EXPIRED,
    });
  });

  it("garde TTL — borne exacte : heartbeat pile à TTL reste BLOCKED, TTL+1 min passe CLEAR", () => {
    const atTtl = liveForeignLock({
      startedAt: minutesAgo(TTL + 5),
      heartbeatAt: minutesAgo(TTL),
    });
    const pastTtl = liveForeignLock({
      startedAt: minutesAgo(TTL + 5),
      heartbeatAt: minutesAgo(TTL + 1),
    });

    expect(evaluate({ lock: atTtl }).verdict).toBe("BLOCKED");
    expect(evaluate({ lock: pastTtl }).verdict).toBe("CLEAR");
  });

  it("garde MAX_AGE : âge > plafond avec pid VIVANT ET heartbeat FRAIS → CLEAR (plafond dur)", () => {
    // pid VIVANT + heartbeat d'il y a 1 min (bien sous TTL=15) → ni la garde pid ni la garde TTL
    // ne couvrent cette entrée ; seule la garde MAX_AGE peut l'épingler (#206).
    const lock = liveForeignLock({
      startedAt: minutesAgo(MAX_AGE + 1),
      heartbeatAt: minutesAgo(1),
    });

    expect(evaluate({ lock })).toEqual({
      verdict: "CLEAR",
      reason: SESSION_LOCK_REASONS.MAX_AGE_EXCEEDED,
    });
  });

  it("garde MAX_AGE — borne exacte : âge pile au plafond reste BLOCKED", () => {
    const atMax = liveForeignLock({ startedAt: minutesAgo(MAX_AGE), heartbeatAt: minutesAgo(1) });
    expect(evaluate({ lock: atMax }).verdict).toBe("BLOCKED");
  });

  it("garde SELF : le lock de CE run ne bloque JAMAIS son propre run (anti-auto-deadlock)", () => {
    // pid vivant + heartbeat frais + âge sous plafond : sans la garde `self`, ce lock rendrait
    // BLOCKED et un run s'auto-céderait la place à chaque re-lancement du guard (#206).
    expect(evaluate({ ownerPid: 4242 })).toEqual({
      verdict: "CLEAR",
      reason: SESSION_LOCK_REASONS.SELF,
    });
  });

  it("garde PID INDÉTERMINABLE : pid absent/non entier → CLEAR avec une raison DISTINCTE de pid-dead", () => {
    // La raison fait partie du contrat de sortie lu par l'orchestrateur : sans cette garde le
    // rapport dirait « pid mort » alors que le pid n'a jamais été lisible (#164).
    expect(evaluate({ lock: liveForeignLock({ pid: undefined }) })).toEqual({
      verdict: "CLEAR",
      reason: SESSION_LOCK_REASONS.PID_INDETERMINATE,
    });
    expect(evaluate({ lock: liveForeignLock({ pid: 0 }) }).reason).toBe(
      SESSION_LOCK_REASONS.PID_INDETERMINATE,
    );
    expect(evaluate({ lock: liveForeignLock({ pid: "4242" }) }).reason).toBe(
      SESSION_LOCK_REASONS.PID_INDETERMINATE,
    );
  });

  it("garde HORODATAGE : heartbeatAt / startedAt illisibles → CLEAR, jamais BLOCKED", () => {
    expect(evaluate({ lock: liveForeignLock({ heartbeatAt: "pas-une-date" }) })).toEqual({
      verdict: "CLEAR",
      reason: SESSION_LOCK_REASONS.HEARTBEAT_UNREADABLE,
    });
    expect(evaluate({ lock: liveForeignLock({ heartbeatAt: 12345 }) }).reason).toBe(
      SESSION_LOCK_REASONS.HEARTBEAT_UNREADABLE,
    );
    expect(evaluate({ lock: liveForeignLock({ startedAt: "n'importe quoi" }) })).toEqual({
      verdict: "CLEAR",
      reason: SESSION_LOCK_REASONS.STARTED_UNREADABLE,
    });
  });

  it("absence de lock → CLEAR en propageant la raison de chargement", () => {
    expect(evaluate({ lock: null, loadReason: SESSION_LOCK_REASONS.CORRUPT })).toEqual({
      verdict: "CLEAR",
      reason: SESSION_LOCK_REASONS.CORRUPT,
    });
  });

  it("ne consulte JAMAIS la liveness d'un lock qui lui appartient (pas de ps inutile)", () => {
    const pidAlive = vi.fn(() => true);
    evaluateSessionLock({
      lock: liveForeignLock(),
      loadReason: SESSION_LOCK_REASONS.PRESENT,
      nowMs: NOW_MS,
      ownerPid: 4242,
      pidAlive,
      ttlMin: TTL,
      maxAgeMin: MAX_AGE,
    });
    expect(pidAlive).not.toHaveBeenCalled();
  });
});

// ── AC5 — fichier corrompu / illisible ──────────────────────────────────────────────────────────
describe("parseSessionLockRecord — tout ce qui n'est pas un objet JSON → null (fail-open)", () => {
  it("accepte un objet JSON", () => {
    expect(parseSessionLockRecord('{"pid":7}')).toEqual({ pid: 7 });
  });

  it("rejette JSON invalide, non-objet, tableau, null et non-string", () => {
    expect(parseSessionLockRecord("{oops")).toBeNull();
    expect(parseSessionLockRecord("42")).toBeNull();
    expect(parseSessionLockRecord("[1,2]")).toBeNull();
    expect(parseSessionLockRecord("null")).toBeNull();
    expect(parseSessionLockRecord(Buffer.from("x"))).toBeNull();
  });
});

describe("loadSessionLock", () => {
  const deps = (overrides) => ({
    lockPath: "/tmp/.session-lock.json",
    fileExists: () => true,
    readFile: () => '{"pid":7}',
    ...overrides,
  });

  it("lock absent → no-lock", () => {
    expect(loadSessionLock(deps({ fileExists: () => false }))).toEqual({
      lock: null,
      reason: SESSION_LOCK_REASONS.NO_LOCK,
    });
  });

  it("lecture qui lève (permissions, I/O) → lock-unreadable, jamais une exception qui remonte", () => {
    expect(
      loadSessionLock(
        deps({
          readFile: () => {
            throw new Error("EACCES");
          },
        }),
      ),
    ).toEqual({ lock: null, reason: SESSION_LOCK_REASONS.UNREADABLE });
  });

  it("contenu corrompu → lock-corrupt", () => {
    expect(loadSessionLock(deps({ readFile: () => "{tronqué" }))).toEqual({
      lock: null,
      reason: SESSION_LOCK_REASONS.CORRUPT,
    });
  });

  it("lock lisible → objet + lock-present", () => {
    expect(loadSessionLock(deps())).toEqual({
      lock: { pid: 7 },
      reason: SESSION_LOCK_REASONS.PRESENT,
    });
  });
});

// ── AC4 — ⚙️ centralisés + surchargeables ───────────────────────────────────────────────────────
describe("readSessionLockConfig — ⚙️ centralisés, surchargeables par env", () => {
  it("retombe sur les défauts quand l'env est vide", () => {
    expect(readSessionLockConfig({})).toEqual({
      ttlMin: SESSION_LOCK_DEFAULTS.ttlMin,
      maxAgeMin: SESSION_LOCK_DEFAULTS.maxAgeMin,
      maxAncestorDepth: SESSION_LOCK_DEFAULTS.maxAncestorDepth,
    });
  });

  it("honore les surcharges d'env (⚙️ calibrables sans toucher au code)", () => {
    expect(
      readSessionLockConfig({
        SESSION_LOCK_TTL_MIN: "2",
        SESSION_LOCK_MAX_AGE_MIN: "5",
        SESSION_LOCK_MAX_ANCESTOR_DEPTH: "3",
      }),
    ).toEqual({ ttlMin: 2, maxAgeMin: 5, maxAncestorDepth: 3 });
  });

  it("ignore les surcharges vides, non numériques ou négatives (retour au défaut)", () => {
    expect(
      readSessionLockConfig({
        SESSION_LOCK_TTL_MIN: "  ",
        SESSION_LOCK_MAX_AGE_MIN: "beaucoup",
        SESSION_LOCK_MAX_ANCESTOR_DEPTH: "-4",
      }),
    ).toEqual(SESSION_LOCK_DEFAULTS);
  });
});

// ── AC1/AC5 — acquire / heartbeat / release ─────────────────────────────────────────────────────
describe("planSessionLockAction — écritures (AC1)", () => {
  const NOW_ISO = "2026-07-20T12:00:00.000Z";
  const clear = { verdict: "CLEAR", reason: SESSION_LOCK_REASONS.NO_LOCK };
  const blocked = { verdict: "BLOCKED", reason: SESSION_LOCK_REASONS.LIVE };

  const plan = (overrides) =>
    planSessionLockAction({
      action: "acquire",
      lock: null,
      evaluation: clear,
      ownerPid: 700,
      pidSource: "ancestor",
      nowIso: NOW_ISO,
      host: "mac",
      note: null,
      ...overrides,
    });

  it("acquire sans lock → écrit un enregistrement complet ancré sur le pid d'ancêtre", () => {
    expect(plan()).toEqual({
      op: "write",
      outcome: "acquired",
      record: {
        pid: 700,
        pidSource: "ancestor",
        startedAt: NOW_ISO,
        heartbeatAt: NOW_ISO,
        host: "mac",
        note: null,
      },
    });
  });

  it("acquire prend la place d'un lock étranger PÉRIMÉ (evaluation CLEAR)", () => {
    const result = plan({ lock: { pid: 4242, startedAt: "x", heartbeatAt: "x" } });
    expect(result.outcome).toBe("acquired");
    expect(result.record.pid).toBe(700);
  });

  it("garde ANTI-VOL : acquire ne vole ni n'écrase un lock étranger VIVANT", () => {
    const result = plan({ lock: { pid: 4242 }, evaluation: blocked });
    expect(result).toEqual({ op: "none", outcome: "blocked" });
  });

  it("heartbeat rafraîchit heartbeatAt SANS déplacer startedAt (sinon le plafond dur ne plafonne rien)", () => {
    const lock = {
      pid: 700,
      pidSource: "ancestor",
      startedAt: "2026-07-20T11:00:00.000Z",
      heartbeatAt: "2026-07-20T11:30:00.000Z",
      host: "mac",
      note: null,
    };

    const result = plan({ action: "heartbeat", lock });

    expect(result.outcome).toBe("beat");
    expect(result.record.startedAt).toBe("2026-07-20T11:00:00.000Z");
    expect(result.record.heartbeatAt).toBe(NOW_ISO);
  });

  it("heartbeat sur lock absent ré-acquiert (chaîne auto-réparante)", () => {
    expect(plan({ action: "heartbeat" }).outcome).toBe("acquired");
  });

  it("heartbeat ne pique PAS le lock d'un autre run vivant", () => {
    expect(plan({ action: "heartbeat", lock: { pid: 4242 }, evaluation: blocked })).toEqual({
      op: "none",
      outcome: "blocked",
    });
  });

  it("acquire re-joué par le MÊME run renouvelle sans réinitialiser startedAt", () => {
    const lock = { pid: 700, startedAt: "2026-07-20T11:00:00.000Z", heartbeatAt: "x" };
    const result = plan({ lock });
    expect(result.outcome).toBe("renewed");
    expect(result.record.startedAt).toBe("2026-07-20T11:00:00.000Z");
  });

  it("release retire NOTRE lock", () => {
    expect(plan({ action: "release", lock: { pid: 700 } })).toEqual({
      op: "remove",
      outcome: "released",
    });
  });

  it("garde ANTI-SUPPRESSION : release ne touche pas au lock d'un autre run", () => {
    expect(plan({ action: "release", lock: { pid: 4242 } })).toEqual({
      op: "none",
      outcome: "foreign",
    });
  });

  it("garde IDENTITÉ INDÉTERMINÉE : un ownerPid null ne s'approprie PAS le lock étranger à pid null", () => {
    // Deux identités INDÉTERMINÉES ne sont pas la même identité : sans `ownerPid !== null`,
    // `null === null` rendrait `owned` vrai → ce run écraserait le lock d'un autre run (perte
    // de son `note`) sur `acquire`, et le SUPPRIMERAIT sur `release`.
    const foreignUnknown = { pid: null, pidSource: "unresolved", note: "run étranger" };

    const acquired = plan({ ownerPid: null, pidSource: "unresolved", lock: foreignUnknown });
    expect(acquired.outcome).toBe("acquired"); // remplacement assumé, PAS un « renewed »
    expect(acquired.record.note).toBeNull(); // pas de reprise du `note` étranger

    expect(plan({ action: "release", ownerPid: null, lock: foreignUnknown })).toEqual({
      op: "none",
      outcome: "foreign",
    });
  });

  it("release sans lock est un no-op silencieux", () => {
    expect(plan({ action: "release" })).toEqual({ op: "none", outcome: "absent" });
  });

  it("acquire puis release ramène l'état à CLEAR (cycle de vie complet)", () => {
    const acquired = plan();
    const evaluationAfterAcquire = evaluateSessionLock({
      lock: acquired.record,
      loadReason: SESSION_LOCK_REASONS.PRESENT,
      nowMs: Date.parse(NOW_ISO),
      ownerPid: 42, // AUTRE run : sans release il verrait un lock vivant
      pidAlive: alwaysAlive,
      ttlMin: TTL,
      maxAgeMin: MAX_AGE,
    });
    expect(evaluationAfterAcquire.verdict).toBe("BLOCKED");

    const released = planSessionLockAction({
      action: "release",
      lock: acquired.record,
      evaluation: evaluationAfterAcquire,
      ownerPid: 700,
      pidSource: "ancestor",
      nowIso: NOW_ISO,
      host: "mac",
      note: null,
    });
    expect(released.op).toBe("remove");

    // Lock retiré → plus rien à charger → CLEAR.
    expect(
      evaluateSessionLock({
        lock: null,
        loadReason: SESSION_LOCK_REASONS.NO_LOCK,
        nowMs: Date.parse(NOW_ISO),
        ownerPid: 42,
        pidAlive: alwaysAlive,
        ttlMin: TTL,
        maxAgeMin: MAX_AGE,
      }).verdict,
    ).toBe("CLEAR");
  });
});

describe("constructeurs d'enregistrement", () => {
  it("buildSessionLockRecord ancre startedAt ET heartbeatAt sur l'instant d'acquisition", () => {
    expect(
      buildSessionLockRecord({
        pid: 1,
        pidSource: "env",
        nowIso: "2026-01-01T00:00:00.000Z",
        host: "h",
        note: "n",
      }),
    ).toEqual({
      pid: 1,
      pidSource: "env",
      startedAt: "2026-01-01T00:00:00.000Z",
      heartbeatAt: "2026-01-01T00:00:00.000Z",
      host: "h",
      note: "n",
    });
  });

  it("renewSessionLockRecord ne touche QUE heartbeatAt", () => {
    const lock = { pid: 1, startedAt: "a", heartbeatAt: "b", host: "h", note: "n" };
    expect(renewSessionLockRecord(lock, "c")).toEqual({
      pid: 1,
      startedAt: "a",
      heartbeatAt: "c",
      host: "h",
      note: "n",
    });
  });
});
