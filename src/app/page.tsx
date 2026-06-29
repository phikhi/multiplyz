import { ThemeToggle } from "@/components/ThemeToggle";

// Scaffold: texte minimal en constante locale. Centralisé en #14 (i18n).
const COPY = {
  title: "multiplyz",
  subtitle: "Design tokens — scaffold visuel",
  sections: {
    colors: "Couleurs",
    spacing: "Espacements",
    typography: "Typographie",
    radius: "Rayons",
  },
} as const;

// Couleurs à afficher comme swatches (utilise var(--…) de tokens.css)
const COLOR_SWATCHES = [
  { label: "bg-primary", cssVar: "--color-bg-primary" },
  { label: "bg-secondary", cssVar: "--color-bg-secondary" },
  { label: "bg-tertiary", cssVar: "--color-bg-tertiary" },
  { label: "text-primary", cssVar: "--color-text-primary" },
  { label: "text-secondary", cssVar: "--color-text-secondary" },
  { label: "accent-primary", cssVar: "--color-accent-primary" },
  { label: "accent-secondary", cssVar: "--color-accent-secondary" },
  { label: "status-success", cssVar: "--color-status-success" },
  { label: "status-warning", cssVar: "--color-status-warning" },
  { label: "status-error", cssVar: "--color-status-error" },
  { label: "reward-gold", cssVar: "--color-reward-gold" },
  { label: "reward-coral", cssVar: "--color-reward-coral" },
  { label: "feedback-correct", cssVar: "--color-feedback-correct" },
  { label: "feedback-retry", cssVar: "--color-feedback-retry" },
] as const;

// Espacements (space-1 … space-8, pas de valeur en dur)
const SPACE_TOKENS = [
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
  "--space-7",
  "--space-8",
] as const;

// Rayons
const RADIUS_TOKENS = [
  { label: "sm", cssVar: "--border-radius-sm" },
  { label: "md", cssVar: "--border-radius-md" },
  { label: "lg (card)", cssVar: "--border-radius-lg" },
  { label: "xl", cssVar: "--border-radius-xl" },
  { label: "full", cssVar: "--border-radius-full" },
] as const;

// Tailles typographiques
const FONT_SIZE_TOKENS = [
  { label: "xs", cssVar: "--font-size-xs" },
  { label: "sm", cssVar: "--font-size-sm" },
  { label: "base", cssVar: "--font-size-base" },
  { label: "md", cssVar: "--font-size-md" },
  { label: "lg", cssVar: "--font-size-lg" },
  { label: "xl", cssVar: "--font-size-xl" },
  { label: "2xl", cssVar: "--font-size-2xl" },
  { label: "3xl", cssVar: "--font-size-3xl" },
] as const;

export default function DesignTokensPage() {
  return (
    <div
      style={{
        backgroundColor: "var(--color-bg-primary)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-family-body)",
        minHeight: "100dvh",
        padding: "var(--space-6)",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-7)",
          flexWrap: "wrap",
          gap: "var(--space-4)",
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: "var(--font-family-display)",
              fontSize: "var(--font-size-2xl)",
              fontWeight: "var(--font-weight-bold)",
              margin: 0,
              color: "var(--color-accent-primary)",
            }}
          >
            {COPY.title}
          </h1>
          <p
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-secondary)",
              margin: "var(--space-1) 0 0",
            }}
          >
            {COPY.subtitle}
          </p>
        </div>
        <ThemeToggle />
      </header>

      <main
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-7)",
          maxWidth: "var(--max-width-wide)",
          margin: "0 auto",
        }}
      >
        {/* Section Couleurs */}
        <section aria-labelledby="section-colors">
          <h2
            id="section-colors"
            style={{
              fontFamily: "var(--font-family-display)",
              fontSize: "var(--font-size-lg)",
              fontWeight: "var(--font-weight-semibold)",
              marginBottom: "var(--space-4)",
              color: "var(--color-text-primary)",
            }}
          >
            {COPY.sections.colors}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(9rem, 1fr))",
              gap: "var(--space-3)",
            }}
          >
            {COLOR_SWATCHES.map(({ label, cssVar }) => (
              <div
                key={cssVar}
                style={{
                  borderRadius: "var(--border-radius-md)",
                  overflow: "hidden",
                  border: "1px solid var(--color-border-primary)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    height: "var(--space-8)",
                    backgroundColor: `var(${cssVar})`,
                  }}
                />
                <div
                  style={{
                    padding: "var(--space-2) var(--space-3)",
                    backgroundColor: "var(--color-bg-secondary)",
                    fontSize: "var(--font-size-xs)",
                    color: "var(--color-text-secondary)",
                    fontFamily: "var(--font-family-mono)",
                  }}
                >
                  {label}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section Espacements */}
        <section aria-labelledby="section-spacing">
          <h2
            id="section-spacing"
            style={{
              fontFamily: "var(--font-family-display)",
              fontSize: "var(--font-size-lg)",
              fontWeight: "var(--font-weight-semibold)",
              marginBottom: "var(--space-4)",
              color: "var(--color-text-primary)",
            }}
          >
            {COPY.sections.spacing}
          </h2>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
            }}
          >
            {SPACE_TOKENS.map((token) => (
              <div
                key={token}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-4)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-family-mono)",
                    fontSize: "var(--font-size-xs)",
                    color: "var(--color-text-secondary)",
                    width: "var(--space-8)",
                    flexShrink: 0,
                  }}
                >
                  {token.replace("--", "")}
                </span>
                <div
                  aria-hidden="true"
                  style={{
                    height: "var(--space-4)",
                    width: `var(${token})`,
                    backgroundColor: "var(--color-accent-primary)",
                    borderRadius: "var(--border-radius-sm)",
                  }}
                />
              </div>
            ))}
          </div>
        </section>

        {/* Section Typographie */}
        <section aria-labelledby="section-typography">
          <h2
            id="section-typography"
            style={{
              fontFamily: "var(--font-family-display)",
              fontSize: "var(--font-size-lg)",
              fontWeight: "var(--font-weight-semibold)",
              marginBottom: "var(--space-4)",
              color: "var(--color-text-primary)",
            }}
          >
            {COPY.sections.typography}
          </h2>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            {FONT_SIZE_TOKENS.map(({ label, cssVar }) => (
              <div
                key={cssVar}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "var(--space-4)",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-family-mono)",
                    fontSize: "var(--font-size-xs)",
                    color: "var(--color-text-secondary)",
                    width: "var(--space-7)",
                    flexShrink: 0,
                  }}
                >
                  {label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-family-display)",
                    fontSize: `var(${cssVar})`,
                    fontWeight: "var(--font-weight-bold)",
                    color: "var(--color-text-primary)",
                    lineHeight: "var(--line-height-tight)",
                  }}
                >
                  Baloo 2
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-family-body)",
                    fontSize: `var(${cssVar})`,
                    color: "var(--color-text-secondary)",
                    lineHeight: "var(--line-height-tight)",
                  }}
                >
                  Nunito
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Section Rayons */}
        <section aria-labelledby="section-radius">
          <h2
            id="section-radius"
            style={{
              fontFamily: "var(--font-family-display)",
              fontSize: "var(--font-size-lg)",
              fontWeight: "var(--font-weight-semibold)",
              marginBottom: "var(--space-4)",
              color: "var(--color-text-primary)",
            }}
          >
            {COPY.sections.radius}
          </h2>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--space-4)",
              alignItems: "flex-end",
            }}
          >
            {RADIUS_TOKENS.map(({ label, cssVar }) => (
              <div
                key={cssVar}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "var(--space-2)",
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: "var(--space-8)",
                    height: "var(--space-8)",
                    backgroundColor: "var(--color-accent-primary)",
                    borderRadius: `var(${cssVar})`,
                    opacity: "0.85",
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--font-family-mono)",
                    fontSize: "var(--font-size-xs)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
