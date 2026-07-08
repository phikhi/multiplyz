#!/usr/bin/env node
// quota-usage.mjs — Lecteur JSONL maison (ADR 0011).
//
// Mesure la consommation RÉELLE de tokens à partir des transcripts locaux de
// Claude Code (~/.claude/projects/**/*.jsonl), compte-account (tous les projets,
// pas seulement multiplyz — le rate-limit est par-compte).
//
// Objet : donner à l'orchestrateur un CHIFFRE MESURÉ au lieu d'un % halluciné.
// Ce que ce lecteur SAIT (vérité locale) :
//   - tokens réels par appel (message.usage) + timestamp
//   - découpage en blocs 5h (gap-based, façon ccusage) → bloc actif + reset
//   - plafond EMPIRIQUE = max de tokens observé sur un bloc 5h passé (auto-calibré,
//     0 nombre de plan deviné)
//   - somme glissante 7 jours (proxy hebdo)
// Ce que ce lecteur NE SAIT PAS (jamais deviné ici) :
//   - le % serveur exact, le ceiling exact du plan, l'ancre de reset hebdo.
//     → le seul signal d'autorité « t'es coupé » reste le MESSAGE de limite d'usage.
//       Ce lecteur sert la garde de DÉMARRAGE (anti-orphelin) + le rapport, pas le STOP.
//
// Usage :
//   node quota-usage.mjs            # JSON sur stdout + 1 ligne humaine sur stderr
//   node quota-usage.mjs --json     # JSON seul
//   node quota-usage.mjs --nowMs=…  # override l'instant (tests)
//
// Pur stdlib (fs/path/os/readline) — aucune dépendance, aucun node_modules requis.

import { readdirSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

const FIVE_H_MS = 5 * 60 * 60 * 1000;
const SEVEN_D_MS = 7 * 24 * 60 * 60 * 1000;

// ⚙️ Paramètres de la garde de DÉMARRAGE (anti-orphelin) — à calibrer au réel.
// Auto-calibrés sur les données (pas de nombre de plan deviné) :
const START_GUARD_RATIO = 0.85; // ⚙️ si bloc courant ≥ 85 % du max empirique → HOLD
const STORY_WALLCLOCK_MIN = 30; // ⚙️ durée wall-clock estimée d'une story ; si reset < ça → HOLD

function parseArgs(argv) {
  const out = { jsonOnly: false, nowMs: Date.now() };
  for (const a of argv.slice(2)) {
    if (a === "--json") out.jsonOnly = true;
    else if (a.startsWith("--nowMs=")) out.nowMs = Number(a.slice("--nowMs=".length));
  }
  return out;
}

// Collecte tous les événements avec usage, dédupliqués par requestId||uuid
// (une même réponse API peut être re-loggée après fork/reprise de session).
async function collectEvents(rootDirs) {
  const seen = new Set();
  const events = [];
  for (const dir of rootDirs) {
    let projects;
    try {
      projects = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const p of projects) {
      const projPath = p.isDirectory() ? join(dir, p.name) : null;
      if (!projPath) continue;
      let files;
      try {
        files = readdirSync(projPath).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const f of files) {
        await readJsonl(join(projPath, f), seen, events);
      }
    }
  }
  events.sort((a, b) => a.ts - b.ts);
  return events;
}

function readJsonl(file, seen, events) {
  return new Promise((resolve) => {
    let stream;
    try {
      stream = createReadStream(file, { encoding: "utf8" });
    } catch {
      resolve();
      return;
    }
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on("line", (line) => {
      // Fast-path : ne parser que les lignes qui portent un usage de tokens.
      if (line.indexOf('"output_tokens"') === -1) return;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        return;
      }
      const u = d?.message?.usage;
      if (!u || typeof u.output_tokens !== "number") return;
      const key = d.requestId || d.uuid;
      if (key) {
        if (seen.has(key)) return;
        seen.add(key);
      }
      const ts = Date.parse(d.timestamp);
      if (Number.isNaN(ts)) return;
      const total =
        (u.input_tokens || 0) +
        (u.cache_creation_input_tokens || 0) +
        (u.cache_read_input_tokens || 0) +
        (u.output_tokens || 0);
      events.push({ ts, total });
    });
    rl.on("close", resolve);
    rl.on("error", () => resolve());
  });
}

// Découpe les événements triés en blocs 5h (gap-based) :
// un nouveau bloc démarre si ≥5h depuis le début du bloc OU >5h depuis le dernier événement.
function toBlocks(events) {
  const blocks = [];
  let cur = null;
  for (const ev of events) {
    if (!cur || ev.ts - cur.start >= FIVE_H_MS || ev.ts - cur.lastTs > FIVE_H_MS) {
      cur = { start: ev.ts, lastTs: ev.ts, total: 0, count: 0 };
      blocks.push(cur);
    }
    cur.lastTs = ev.ts;
    cur.total += ev.total;
    cur.count += 1;
  }
  return blocks;
}

function summarize(events, nowMs) {
  const blocks = toBlocks(events);
  const last = blocks[blocks.length - 1];

  // Bloc actif = le dernier bloc si sa fenêtre 5h n'est pas encore refermée.
  const active =
    last && nowMs - last.start < FIVE_H_MS && nowMs - last.lastTs < FIVE_H_MS ? last : null;

  // Plafond empirique = max tokens sur un bloc PASSÉ (complet), hors bloc actif.
  const pastBlocks = active ? blocks.slice(0, -1) : blocks;
  const empiricalBlockMax = pastBlocks.reduce((m, b) => Math.max(m, b.total), 0);

  const currentTotal = active ? active.total : 0;
  const resetsAtMs = active ? active.start + FIVE_H_MS : null;
  const resetsInMin = resetsAtMs
    ? Math.max(0, Math.round((resetsAtMs - nowMs) / 60000))
    : Math.round(FIVE_H_MS / 60000); // fenêtre fraîche
  const ratio = empiricalBlockMax > 0 ? currentTotal / empiricalBlockMax : 0;

  // Proxy hebdo : somme glissante 7 jours (ancre de reset hebdo inconnue localement).
  const weeklyTotal = events
    .filter((e) => nowMs - e.ts <= SEVEN_D_MS)
    .reduce((s, e) => s + e.total, 0);
  const weeklyMax = blocks.reduce((s, b) => s + b.total, 0); // total tous blocs (borne haute observée)

  // Garde de DÉMARRAGE (anti-orphelin), pur data — voir ⚙️.
  const holdOnBudget = empiricalBlockMax > 0 && ratio >= START_GUARD_RATIO;
  const holdOnTime = active !== null && resetsInMin <= STORY_WALLCLOCK_MIN;
  const startVerdict = holdOnBudget || holdOnTime ? "HOLD" : "GO";

  return {
    now: new Date(nowMs).toISOString(),
    block5h: {
      active: active !== null,
      usedTokens: currentTotal,
      empiricalMaxTokens: empiricalBlockMax,
      ratioOfEmpiricalMax: Number(ratio.toFixed(3)),
      resetsInMin,
      resetsAt: resetsAtMs ? new Date(resetsAtMs).toISOString() : null,
    },
    weekly7d: {
      usedTokens: weeklyTotal,
      note: "proxy 7j glissant ; ancre de reset hebdo INCONNUE localement — le stop hebdo reste réactif au message de limite",
    },
    startGuard: {
      verdict: startVerdict, // GO = ok démarrer une story ; HOLD = finir la courante, ne pas en démarrer
      holdOnBudget,
      holdOnTime,
      params: { START_GUARD_RATIO, STORY_WALLCLOCK_MIN },
    },
    totals: { blocks: blocks.length, eventsAllTime: events.length, weeklyMaxTokens: weeklyMax },
    caveat:
      "CHIFFRE MESURÉ, pas le % serveur. Le seul signal d’autorité « coupé + reset » = le MESSAGE de limite d’usage. Sert la garde de DÉMARRAGE + le rapport, jamais un STOP préventif.",
  };
}

const { jsonOnly, nowMs } = parseArgs(process.argv);
const roots = [join(homedir(), ".claude", "projects")];
const events = await collectEvents(roots);
const summary = summarize(events, nowMs);

process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
if (!jsonOnly) {
  const b = summary.block5h;
  const line =
    `[quota] bloc5h ${b.usedTokens.toLocaleString()} tok ` +
    `(${(b.ratioOfEmpiricalMax * 100).toFixed(0)}% du max empirique ${b.empiricalMaxTokens.toLocaleString()}), ` +
    `reset dans ${b.resetsInMin} min · 7j ${summary.weekly7d.usedTokens.toLocaleString()} tok · ` +
    `démarrer story ? → ${summary.startGuard.verdict}`;
  process.stderr.write(line + "\n");
}
