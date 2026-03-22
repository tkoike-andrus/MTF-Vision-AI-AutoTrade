import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard?user_id=xxx — Load dashboard data (trades, profile)
 * Uses service_role to bypass RLS issues with browser client
 */
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const [profileRes, tradesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single(),
    supabase
      .from("trades")
      .select("*, entry_reason:entry_reasons(*)")
      .eq("user_id", userId)
      .order("exit_at_utc", { ascending: false }),
  ]);

  // Supabase returns numeric columns as strings — convert to numbers
  const trades = (tradesRes.data || []).map((t: Record<string, unknown>) => ({
    ...t,
    pnl: Number(t.pnl) || 0,
    entry_price: Number(t.entry_price) || 0,
    exit_price: Number(t.exit_price) || 0,
    lot_size: t.lot_size != null ? Number(t.lot_size) : null,
    discipline_score: t.discipline_score != null ? Number(t.discipline_score) : null,
  }));

  return NextResponse.json({
    profile: profileRes.data,
    trades,
  });
}
