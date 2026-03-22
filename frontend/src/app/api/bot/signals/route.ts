import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

/**
 * GET /api/bot/signals?user_id=xxx&from=2026-03-17&to=2026-03-21
 * Fetch trade signals from DB with optional date range filter.
 */
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const from = request.nextUrl.searchParams.get("from"); // YYYY-MM-DD
  const to = request.nextUrl.searchParams.get("to");     // YYYY-MM-DD

  const supabase = createServiceRoleClient();

  let query = supabase
    .from("trade_signals")
    .select("id, symbol, strategy_name, action, confidence, reason, current_price, ai_model, position_status, executed, execution_result, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (from) {
    query = query.gte("created_at", `${from}T00:00:00+09:00`);
  }
  if (to) {
    query = query.lte("created_at", `${to}T23:59:59+09:00`);
  }

  const { data, error } = await query.limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ signals: data || [] });
}
