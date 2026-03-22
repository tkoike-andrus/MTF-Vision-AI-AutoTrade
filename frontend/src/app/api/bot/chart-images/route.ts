import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readFile, stat } from "fs/promises";
import { join } from "path";

export const dynamic = 'force-dynamic';

const CHART_FILES = [
  { file: "m5.png", label: "5分足" },
  { file: "h1.png", label: "1時間足" },
  { file: "h4.png", label: "4時間足" },
  { file: "d1.png", label: "日足" },
];

/**
 * GET /api/bot/chart-images?user_id=xxx
 * Reads chart images from the user's configured local folder.
 * Returns base64-encoded images array.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("user_id");
    if (!userId) {
      return NextResponse.json({ error: "user_id required" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const { data: config } = await supabase
      .from("bot_configs")
      .select("chart_image_folder")
      .eq("user_id", userId)
      .single();

    if (!config?.chart_image_folder) {
      return NextResponse.json({
        error: "chart_image_folder not configured",
        images: [],
      }, { status: 400 });
    }

    const folder = config.chart_image_folder;
    const images: { file: string; label: string; base64: string; modified_at: string }[] = [];
    const errors: string[] = [];

    for (const { file, label } of CHART_FILES) {
      const filePath = join(folder, file);
      try {
        const [fileBuffer, fileStat] = await Promise.all([
          readFile(filePath),
          stat(filePath),
        ]);
        images.push({
          file,
          label,
          base64: fileBuffer.toString("base64"),
          modified_at: fileStat.mtime.toISOString(),
        });
      } catch {
        errors.push(`${file}: not found`);
      }
    }

    return NextResponse.json({
      images,
      errors,
      folder,
      chart_count: images.length,
    });
  } catch (err) {
    console.error("Chart images read error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
