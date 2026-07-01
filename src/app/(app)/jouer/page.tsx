import { strings } from "@/strings";
import { LogoutButton } from "@/components/LogoutButton";

// Placeholder de l'écran de jeu (#2.3) — l'écran réel arrive épic #3+. Protégé
// par le garde du groupe `(app)` : atteignable uniquement avec une session valide.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Écran de jeu (placeholder). Confirme la connexion (session enfant valide) et
 * offre la déconnexion. Voix de Teddy. Tokens uniquement, cible ≥ 44 px.
 */
export default function PlayPage() {
  return (
    <main
      className="bg-bg text-text"
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-6)",
        padding: "var(--space-6)",
        textAlign: "center",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-family-display)",
          fontSize: "var(--font-size-xl)",
          fontWeight: "var(--font-weight-bold)",
          color: "var(--color-text-primary)",
          margin: 0,
        }}
      >
        {strings.play.greeting}
      </h1>
      <LogoutButton />
    </main>
  );
}
