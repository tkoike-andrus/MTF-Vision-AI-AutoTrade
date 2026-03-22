import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

/**
 * GET /api/bot/orders?user_id=xxx&from=2026-03-17&to=2026-03-21
 * Fetch auto_trade_orders with optional date range filter
 */
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");

  const supabase = createServiceRoleClient();

  let query = supabase
    .from("auto_trade_orders")
    .select("*")
    .eq("user_id", userId)
    .order("opened_at", { ascending: false });

  if (from) {
    query = query.gte("opened_at", `${from}T00:00:00`);
  }
  if (to) {
    query = query.lte("opened_at", `${to}T23:59:59`);
  }

  const { data, error } = await query.limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ orders: data || [] });
}
