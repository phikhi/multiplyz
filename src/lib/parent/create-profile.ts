import { eq, isNotNull } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { isValidAvatarId } from "@/config/avatars";
import { hashPin, verifyPin } from "@/lib/auth/pin";
import { isValidName, isValidPin, nameKey, sanitizeName } from "@/lib/auth/validation";
import { ProfileManagementError } from "./profiles";

export interface NewChildProfile {
  name: string;
  avatar: string;
  pin: string;
}
/** A single insert, unique normalized name. A lost acknowledgement can be retried without duplicating the profile. */
export async function createChildProfile(db: AppDatabase, input: NewChildProfile): Promise<number> {
  if (!input || typeof input.name !== "string" || !isValidName(input.name))
    throw new ProfileManagementError("NAME_INVALID");
  if (typeof input.pin !== "string" || !isValidPin(input.pin))
    throw new ProfileManagementError("PIN_INVALID");
  if (typeof input.avatar !== "string" || !isValidAvatarId(input.avatar))
    throw new ProfileManagementError("NAME_INVALID");
  const owner = db
    .select({ hash: profiles.parentPinHash })
    .from(profiles)
    .where(isNotNull(profiles.parentPinHash))
    .get();
  if (!owner?.hash) throw new ProfileManagementError("PROFILE_NOT_FOUND");
  if (await verifyPin(owner.hash, input.pin)) throw new ProfileManagementError("PARENT_PIN_SAME");
  const pinHash = await hashPin(input.pin);
  const inserted = db
    .insert(profiles)
    .values({
      name: sanitizeName(input.name),
      nameKey: nameKey(input.name),
      avatar: input.avatar,
      pinHash,
    })
    .onConflictDoNothing({ target: profiles.nameKey })
    .returning({ id: profiles.id })
    .get();
  if (inserted) return inserted.id;
  const existing = db
    .select()
    .from(profiles)
    .where(eq(profiles.nameKey, nameKey(input.name)))
    .get();
  if (
    existing &&
    existing.parentPinHash === null &&
    existing.avatar === input.avatar &&
    (await verifyPin(existing.pinHash, input.pin))
  )
    return existing.id;
  throw new ProfileManagementError("NAME_TAKEN");
}
