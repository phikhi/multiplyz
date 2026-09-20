import { join } from "node:path";
import { createWorldAssetStore } from "@/lib/worldgen/runtime-assets";

export const runtime = "nodejs";

/** Serve new immutable images without rebuilding/restarting Next's public-file inventory. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ world: string; file: string }> },
) {
  const { world, file } = await context.params;
  if (
    !/^(0|[1-9]\d*)$/.test(world) ||
    !/^runtime-[a-f0-9-]+-(background|tiles|teddy|(?:legendary|creature-\d+)(?:-(?:ado|adulte))?)\.png$/.test(
      file,
    )
  ) {
    return new Response(null, { status: 404 });
  }
  try {
    const bytes = createWorldAssetStore(join(process.cwd(), "storage", "generated")).read(
      `world/${world}/${file}`,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
