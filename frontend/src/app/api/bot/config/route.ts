import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

/**
 * GET /api/bot/config?user_id=xxx — Load bot config & state
 * PUT /api/bot/config — Update bot config
 */
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const [configRes, stateRes, ordersRes] = await Promise.all([
    supabase.from("bot_configs").select("*").eq("user_id", userId).single(),
    supabase.from("bot_states").select("*").eq("user_id", userId).single(),
    supabase
      .from("auto_trade_orders")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return NextResponse.json({
    config: configRes.data,
    state: stateRes.data,
    recentOrders: ordersRes.data || [],
  });
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, ...configData } = body;

    if (!user_id) {
      return NextResponse.json({ error: "user_id required" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Upsert config
    const { data, error } = await supabase
      .from("bot_configs")
      .upsert(
        {
          user_id,
          ...configData,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (error) {
      console.error("[bot/config PUT] Supabase upsert error:", error.message, error.details, error.hint);
      throw error;
    }

    // Also ensure bot_states exists
    await supabase
      .from("bot_states")
      .upsert(
        { user_id, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );

    return NextResponse.json({ success: true, config: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const details = err && typeof err === "object" && "details" in err ? (err as Record<string, unknown>).details : undefined;
    console.error("[bot/config PUT] Error:", message, details);
    return NextResponse.json(
      { error: message, details },
      { status: 500 }
    );
  }
}
