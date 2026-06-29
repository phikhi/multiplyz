import { BRAND_NAME } from "@/config/brand";
import { strings } from "@/strings";

// Placeholder de scaffold (#10). UI réelle + tokens visuels en #11.
// Strings centralisées (zéro texte en dur) ; nom de marque depuis la config.
export default function Home() {
  return (
    <main>
      <h1>{BRAND_NAME}</h1>
      <p>{strings.app.booting}</p>
    </main>
  );
}
