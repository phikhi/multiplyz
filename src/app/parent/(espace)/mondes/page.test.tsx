import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { listPendingWorlds, type PendingWorld } from "@/lib/parent/world-approval";
import WorldApprovalPage from "./page";

// Page serveur = pont mince : charge la liste (lecture DB) et la passe au composant client (testé
// isolément). On stubbe getDb + listPendingWorlds + WorldApprovalManager pour vérifier ICI
// uniquement le CÂBLAGE (la liste servie atteint bien le composant).
const FAKE_DB = { __fakeDb: true };
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => FAKE_DB) }));
vi.mock("@/lib/parent/world-approval", () => ({ listPendingWorlds: vi.fn() }));
vi.mock("./WorldApprovalManager", () => ({
  WorldApprovalManager: ({ pending }: { pending: PendingWorld[] }) => (
    <div data-testid="manager">{pending.map((w) => w.id).join(",")}</div>
  ),
}));

const listMock = vi.mocked(listPendingWorlds);

describe("WorldApprovalPage (story 7.9)", () => {
  it("charge la file d'approbation (getDb) et la transmet au composant client", () => {
    const pending: PendingWorld[] = [
      {
        id: "world:2",
        index: 2,
        theme: {
          slug: "foret",
          accent: "#4CAF50",
          label: "Forêt",
          background: null,
          tiles: null,
          teddy: null,
        },
      },
    ];
    listMock.mockReturnValue(pending);

    render(<WorldApprovalPage />);

    expect(getDb).toHaveBeenCalledOnce();
    expect(listMock).toHaveBeenCalledWith(FAKE_DB);
    expect(screen.getByTestId("manager")).toHaveTextContent("world:2");
  });
});
