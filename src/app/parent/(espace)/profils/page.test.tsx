import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { listManagedProfiles, type ManagedProfile } from "@/lib/parent/profiles";
import ProfilesManagementPage from "./page";

// Page serveur = pont mince : charge la liste (lecture DB) et la passe au composant client
// (testé isolément). On stubbe getDb + listManagedProfiles + ProfileManager pour vérifier ICI
// uniquement le CÂBLAGE (la liste servie atteint bien le composant).
const FAKE_DB = { __fakeDb: true };
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => FAKE_DB) }));
vi.mock("@/lib/parent/profiles", () => ({ listManagedProfiles: vi.fn() }));
vi.mock("./ProfileManager", () => ({
  ProfileManager: ({ profiles }: { profiles: ManagedProfile[] }) => (
    <div data-testid="manager">{profiles.map((p) => p.name).join(",")}</div>
  ),
}));

const listMock = vi.mocked(listManagedProfiles);

describe("ProfilesManagementPage (story 7.5)", () => {
  it("charge la liste de gestion (getDb) et la transmet au composant client", () => {
    const profiles: ManagedProfile[] = [
      { id: 1, name: "Léa", avatar: "fox", isOwner: true },
      { id: 2, name: "Zoé", avatar: "rabbit", isOwner: false },
    ];
    listMock.mockReturnValue(profiles);

    render(<ProfilesManagementPage />);

    expect(getDb).toHaveBeenCalledOnce();
    expect(listMock).toHaveBeenCalledWith(FAKE_DB);
    expect(screen.getByTestId("manager")).toHaveTextContent("Léa,Zoé");
  });
});
