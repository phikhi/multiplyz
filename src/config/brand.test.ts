import { describe, expect, it } from "vitest";
import { BRAND_NAME } from "./brand";

describe("brand", () => {
  it("expose le nom de marque", () => {
    expect(BRAND_NAME).toBe("multiplyz");
  });
});
