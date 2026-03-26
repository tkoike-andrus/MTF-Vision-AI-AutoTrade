import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getTickerPrice } from "@/lib/gmo/orders";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/**
 * SRレベルとの最小距離を計算（pips単位）
 */
function calcMinDistancePips(
  currentPrice: number,
  zones: Array<{ type: string; high: number; low: number; broken: boolean }>,
  pipSize: number
): { minPips: number; nearest: { type: string; high: number; low: number } | null } {
  let minPips = Infinity;
  let nearest: { type: string; high: number; low: number } | null = null;

  for (const z of zones) {
    // ゾーンの上端・下端それぞれとの距離を計算
    const distHigh = Math.abs(currentPrice - z.high) / pipSize;
    const distLow = Math.abs(currentPrice - z.low) / pipSize;
    const dist = Math.min(distHigh, distLow);

    // ゾーン内にいる場合は距離0
    const insideZone = currentPrice >= Math.min(z.high, z.low) && currentPrice <= Math.max(z.high, z.low);
    const effectiveDist = insideZone ? 0 : dist;

    if (effectiveDist < minPips) {
      minPips = effectiveDist;
      nearest = { type: z.type, high: z.high, low: z.low };
    }
  }

  return { minPips, nearest };
}

/**
 * GET /api/bot/phase-check?user_id=xxx
 *
 * 軽量フェーズ判定（Gemini不使用）
 * - SRレベルファイルから全ゾーン価格を取得
 * - GMO公開APIから現在価格を取得
 * - 距離計算 → フェーズ判定
 */
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // Config取得
  const { data: config } = await supabase
    .from("bot_configs")
    .select("symbol, phase_battle_pips, post_trade_cooldown_min")
    .eq("user_id", userId)
    .single();

  if (!config) {
    return NextResponse.json({ error: "Config not found" }, { status: 404 });
  }

  const battlePips = Number(config.phase_battle_pips) || 12;
  const cooldownMin = Number(config.post_trade_cooldown_min) || 5;
  const symbol = String(config.symbol);
  const pipSize = symbol.includes("JPY") ? 0.01 : 0.0001;

  // SRレベル取得（ローカル or Supabase Storage）
  let zones: Array<{ type: string; high: number; low: number; broken: boolean }> = [];
  const isVercel = !!process.env.VERCEL;

  if (!isVercel) {
    // PC: ローカル読み込み
    try {
      const { readFile } = await import("fs/promises");
      const { join } = await import("path");
      // bot_configsからchart_image_folderを取得
      const { data: fullConfig } = await supabase
        .from("bot_configs")
        .select("chart_image_folder")
        .eq("user_id", userId)
        .single();
      if (fullConfig?.chart_image_folder) {
        const srPath = join(fullConfig.chart_image_folder, "sr_levels.json");
        const content = await readFile(srPath, "utf-8");
        const parsed = JSON.parse(content);
        zones = parsed.zones || [];
      }
    } catch {
      // ファイルなし → フォールバック
    }
  }

  if (zones.length === 0) {
    // Vercel or ローカルファイルなし: Supabase Storageから取得
    try {
      const { data, error } = await supabase.storage
        .from("chart-images")
        .download("charts/sr_levels.json");
      if (!error && data) {
        const text = await data.text();
        const parsed = JSON.parse(text);
        zones = parsed.zones || [];
      }
    } catch {
      // SR levels not available
    }
  }

  // 現在価格取得
  const currentPrice = await getTickerPrice(symbol);

  if (!currentPrice || zones.length === 0) {
    // データ不足 → 安全のためBATTLE（Gemini呼び出し許可）
    return NextResponse.json({
      phase: "BATTLE",
      reason: !currentPrice ? "Price unavailable" : "SR levels unavailable",
      min_distance_pips: 0,
      nearest_sr: null,
      current_price: currentPrice,
      cooldown_remaining_sec: 0,
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    });
  }

  // 距離計算
  const { minPips, nearest } = calcMinDistancePips(currentPrice, zones, pipSize);

  // クールダウン判定
  let cooldownRemainingSec = 0;
  const { data: stateData } = await supabase
    .from("bot_states")
    .select("last_trade_at")
    .eq("user_id", userId)
    .single();

  if (stateData?.last_trade_at) {
    const elapsed = (Date.now() - new Date(stateData.last_trade_at).getTime()) / 1000;
    const cooldownSec = cooldownMin * 60;
    if (elapsed < cooldownSec) {
      cooldownRemainingSec = Math.ceil(cooldownSec - elapsed);
    }
  }

  // フェーズ判定
  let phase: "BATTLE" | "STANDBY" | "COOLDOWN";
  let reason: string;

  if (cooldownRemainingSec > 0) {
    phase = "COOLDOWN";
    reason = `取引後クールダウン中 (残り${Math.ceil(cooldownRemainingSec / 60)}分)`;
  } else if (minPips <= battlePips) {
    phase = "BATTLE";
    reason = `${nearest?.type || "SR"} まで ${minPips.toFixed(1)} pips → 戦闘モード`;
  } else {
    phase = "STANDBY";
    reason = `最寄りSRまで ${minPips.toFixed(1)} pips (>${battlePips}) → 待機モード`;
  }

  return NextResponse.json({
    phase,
    reason,
    min_distance_pips: Math.round(minPips * 10) / 10,
    nearest_sr: nearest,
    current_price: currentPrice,
    cooldown_remaining_sec: cooldownRemainingSec,
    zones_count: zones.length,
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
