import { redirect } from "next/navigation";
import { evolutionStateAction } from "../../evolution-actions";
import { EvolutionScreen } from "@/components/game/EvolutionScreen";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function EvolutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let characterId: string;
  try {
    characterId = decodeURIComponent(id);
  } catch {
    redirect("/collection");
  }
  const state = await evolutionStateAction(characterId);
  if (!state) redirect("/collection");
  return <EvolutionScreen key={`${state.profileId}:${characterId}`} initial={state} />;
}
