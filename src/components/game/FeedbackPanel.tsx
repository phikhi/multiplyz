"use client";

import { useCallback } from "react";
import { strings } from "@/strings";
import { pickVariant } from "@/lib/game/copy-variant";
import type { QuestionPhase } from "@/lib/game/session";
import type { Skill } from "@/lib/engine/domain";
import { VisualScaffold } from "@/components/game/scaffolds/VisualScaffold";
import { ActionBar } from "@/components/game/ActionBar";
import { AssetImage } from "@/components/media/AssetImage";
import { TEDDY_EXPRESSION_REF } from "@/config/teddy";

/**
 * Feedback no-fail après une réponse (ENGINE §9, WIREFRAMES §3c/§3d, COPY §3).
 *
 * - `phase === "correct"` : feedback positif bref (variante Teddy), bouton continuer.
 * - `phase === "retry"` : posture croissance — **jamais** « faux »/« erreur » (règle
 *   CLAUDE.md/COPY §6) —, montre **d'abord l'étayage visuel** (`VisualScaffold`, épic #4,
 *   outil de découverte qui fait « voir » le calcul), **puis la révélation numérique en
 *   synthèse APRÈS** (« et voilà, ça fait {n} »). Ordre inversé par l'issue #100 (ADR
 *   0007, WIREFRAMES §3d) : l'étayage-découverte précède le résultat, jamais l'inverse.
 *   No-fail INTACT : la bonne réponse est **toujours** montrée, juste déplacée après
 *   l'étayage. **Jamais** d'étayage ni de révélation en `"correct"`.
 *
 * **A11y (LEARNINGS #36/#23)** : le feedback est **doublé d'une icône** (✓ / ↻), jamais
 * la seule couleur (daltonisme) — glyphes en constantes (aucun littéral JSX,
 * `react/jsx-no-literals`). Annoncé via `role="status"` (contenu éphémère critique) et
 * **reçoit le focus au montage** (ref-callback + `tabIndex={-1}`, même pattern approuvé
 * que `ResultsScreen`) : à la transition question→feedback le bouton de réponse démonte,
 * sans ce déplacement le focus retomberait sur `<body>` et perdrait l'utilisateur
 * clavier. Couleurs `--color-feedback-*` (bg + texte suivent **ensemble** le thème,
 * contraste préservé dans les 2 modes — distinct du cas « chip à couleur fixe » qui
 * exigerait un token de texte constant type `--color-on-warning`, cf. LEARNINGS #23).
 *
 * **Responsive (story 8.1 #254, WIREFRAMES §8)** : le bouton primaire (Continuer/Je
 * réessaie) passe dans l'`ActionBar` bas de zone pouce sur téléphone (`useIsPhone`),
 * disposition actuelle préservée tablette/desktop. Reste un enfant du panneau
 * `role="status"` déjà focalisé au montage (`position:fixed` se positionne relatif au
 * viewport, aucune restructuration DOM — le focus/l'ordre de lecture ne changent pas).
 */
export interface FeedbackPanelProps {
  readonly phase: Exclude<QuestionPhase, "asking">;
  /**
   * Bonne réponse du fait (montrée uniquement en re-essai, ENGINE §9), **en synthèse
   * SOUS l'étayage visuel** (ordre inversé issue #100 / ADR 0007 : l'étayage-découverte
   * d'abord, le chiffre en conclusion). No-fail : toujours présente en re-essai.
   */
  readonly correctAnswer: number;
  /** Compétence du fait — indexe l'étayage visuel du re-essai (`VisualScaffold`, épic #4). */
  readonly skill: Skill;
  /** Opérandes du calcul (`[a]` pour comp10, `[a, b]` sinon) — transmis à l'étayage visuel. */
  readonly operands: readonly number[];
  /** Seed déterministe pour varier la formulation (ex. index de question, COPY §1). */
  readonly variantSeed: number;
  /** Continuer vers la question suivante (uniquement depuis `phase === "correct"`). */
  readonly onContinue: () => void;
  /** Relancer le re-essai (uniquement depuis `phase === "retry"`). */
  readonly onRetry: () => void;
}

function fill(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

const CHECK_ICON = "✓";
const RETRY_ICON = "↻";
/** Repli no-fail de l'avatar Teddy si le sprite n'est pas servi (story R2.2, #360). */
const TEDDY_FALLBACK = "🧸";

const primaryButtonStyle = {
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-3) var(--space-6)",
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-md)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-inverse)",
  backgroundColor: "var(--color-accent-primary)",
  border: "none",
  borderRadius: "var(--border-radius-full)",
  cursor: "pointer",
} as const;

export function FeedbackPanel({
  phase,
  correctAnswer,
  skill,
  operands,
  variantSeed,
  onContinue,
  onRetry,
}: FeedbackPanelProps) {
  const isCorrect = phase === "correct";
  const variants = isCorrect ? strings.play.correct.variants : strings.play.retry.variants;
  const message = pickVariant(variants, variantSeed);
  // Teddy réagit (story R2.2, #360, ART §2 « sprites de réaction en jeu ») : `content` (joie) sur
  // le feedback JUSTE, `neutre` (calme, soutenant) sur le « pas encore » — JAMAIS le sprite `oups`
  // (triste), qui culpabiliserait l'enfant (posture croissance no-fail, CLAUDE.md/COPY §6).
  const teddyRef = isCorrect ? TEDDY_EXPRESSION_REF.content : TEDDY_EXPRESSION_REF.neutre;
  const teddyAlt = isCorrect ? strings.play.correct.teddyAlt : strings.play.retry.teddyAlt;

  // Ref-callback : déplace le focus sur le panneau de feedback dès son montage
  // (LEARNINGS #36 — évite la branche `current === null` non couverte d'un `useEffect`
  // + `?.`, et couvre les 2 branches montage/démontage). Réplique le pattern approuvé
  // de `ResultsScreen`.
  const focusOnMount = useCallback((node: HTMLDivElement | null) => {
    node?.focus();
  }, []);

  return (
    <div
      role="status"
      ref={focusOnMount}
      tabIndex={-1}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "var(--space-5)",
        borderRadius: "var(--border-radius-lg)",
        backgroundColor: isCorrect
          ? "var(--color-feedback-correct-bg)"
          : "var(--color-feedback-retry-bg)",
        width: "100%",
        maxWidth: "var(--max-width-play)",
        textAlign: "center",
      }}
    >
      {/* Teddy réagit EN FLUX (premier enfant du panneau) — réserve son espace, ne recouvre ni le
          glyphe ni le message (#278b, non-occlusion structurelle). Repli no-fail = 🧸 emoji. */}
      <AssetImage
        assetRef={teddyRef}
        alt={teddyAlt}
        width="var(--teddy-feedback-size)"
        dataAsset="teddy-feedback"
        fallback={
          <span aria-hidden="true" style={{ fontSize: "var(--font-size-2xl)" }}>
            {TEDDY_FALLBACK}
          </span>
        }
      />

      <span
        aria-hidden="true"
        style={{
          fontSize: "var(--font-size-2xl)",
          color: isCorrect ? "var(--color-feedback-correct)" : "var(--color-feedback-retry)",
        }}
      >
        {isCorrect ? CHECK_ICON : RETRY_ICON}
      </span>

      <p
        style={{
          fontFamily: "var(--font-family-body)",
          fontSize: "var(--font-size-lg)",
          fontWeight: "var(--font-weight-semibold)",
          color: "var(--color-text-primary)",
          margin: 0,
        }}
      >
        {message}
      </p>

      {/* Étayage visuel PREMIER (au-dessus de la révélation numérique), **uniquement**
          en re-essai (jamais en « correct » : l'enfant a déjà trouvé). Ordre inversé par
          l'issue #100 (ADR 0007, WIREFRAMES §3d) : l'étayage est l'**outil de découverte**
          présenté d'abord (l'enfant « voit » le calcul par la représentation), le chiffre
          ne vient qu'en synthèse dessous. Le dispatcher choisit la représentation par
          compétence (épic #4). Il vit à l'intérieur du panneau `role="status"` déjà
          focalisé au montage → aucun nouveau focus, aucun contrôle focusable ajouté (le
          focus reste sur le conteneur, LEARNINGS #36). */}
      {!isCorrect && (
        <VisualScaffold skill={skill} operands={operands} correctAnswer={correctAnswer} />
      )}

      {/* Révélation numérique de la bonne réponse en **synthèse APRÈS l'étayage** (issue
          #100) : se lit comme une conclusion (« et voilà, ça fait {n} »), jamais comme la
          réponse jetée en tête. No-fail INTACT : toujours montrée en re-essai. */}
      {!isCorrect && (
        <p
          style={{
            fontFamily: "var(--font-family-numeric)",
            fontSize: "var(--font-size-xl)",
            fontWeight: "var(--font-weight-bold)",
            color: "var(--color-text-primary)",
            margin: 0,
          }}
        >
          {fill(strings.play.retry.answerReveal, "{n}", String(correctAnswer))}
        </p>
      )}

      <ActionBar>
        <button
          type="button"
          className="mz-focusable"
          onClick={isCorrect ? onContinue : onRetry}
          style={primaryButtonStyle}
        >
          {isCorrect ? strings.play.correct.next : strings.play.retry.tryAgain}
        </button>
      </ActionBar>
    </div>
  );
}
