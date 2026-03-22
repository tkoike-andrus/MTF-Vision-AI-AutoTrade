import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

/**
 * GET /api/strategies/proposals?user_id=xxx — List pending proposals
 * POST /api/strategies/proposals — Create a new proposal (from AI diagnosis)
 */
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("strategy_proposals")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ proposals: data || [] });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      user_id,
      strategy_name,
      analysis_id,
      original_prompt,
      proposed_prompt,
      change_summary,
      reason,
    } = body;

    if (!user_id || !strategy_name || !original_prompt || !proposed_prompt || !change_summary) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    const { data, error } = await supabase
      .from("strategy_proposals")
      .insert({
        user_id,
        strategy_name,
        analysis_id: analysis_id || null,
        original_prompt,
        proposed_prompt,
        change_summary,
        reason: reason || "",
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, proposal: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
