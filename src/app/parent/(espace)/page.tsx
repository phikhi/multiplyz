import { strings } from "@/strings";
import { ParentExitButton } from "@/components/ParentExitButton";

// Rendu dynamique (route gardée par `(espace)/layout.tsx` qui lit la session à chaque
// requête) → jamais prérendu au build. Runtime Node explicite (cohérence épic auth).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const cardStyle = {
  maxWidth: "var(--max-width-play)",
  width: "100%",
  margin: "0 auto",
  padding: "var(--space-6)",
  backgroundColor: "var(--card-bg)",
  borderRadius: "var(--card-radius)",
  boxShadow: "var(--card-shadow)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-5)",
} as const;

const titleStyle = {
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-xl)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
  margin: 0,
} as const;

const placeholderStyle = {
  margin: 0,
  color: "var(--color-text-secondary)",
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-base)",
} as const;

/**
 * **Espace parent — stub de fondation** (story 7.1, WIREFRAMES §7, AUTH.md §2). Accessible
 * uniquement avec une **session parent valide** (garde `(espace)/layout.tsx`). Registre
 * **neutre** (COPY §5, pas la voix de Teddy). Le vrai tableau de bord (justesse par
 * compétence, temps de jeu, à revoir) = **story 7.7** ; ici, seulement le bandeau + un
 * placeholder + la sortie (révoque la session parent). Zéro texte en dur (strings).
 */
export default function ParentDashboardPage() {
  return (
    <main className="bg-bg text-text" style={{ minHeight: "100dvh", padding: "var(--space-6)" }}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>{strings.parent.dashboard.title}</h1>
        <p style={placeholderStyle}>{strings.parent.dashboard.placeholder}</p>
        <ParentExitButton />
      </div>
    </main>
  );
}
