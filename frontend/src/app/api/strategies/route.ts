import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { STRATEGY_TEMPLATES } from "@/lib/strategies";

export const dynamic = 'force-dynamic';

/**
 * GET /api/strategies?user_id=xxx — List all strategies (built-in + custom)
 * POST /api/strategies — Create a new custom strategy
 */
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("strategies")
    .select("*")
    .or(`is_builtin.eq.true,user_id.eq.${userId}`)
    .neq("is_active", false)
    .order("is_builtin", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fill in built-in prompt templates from code (DB stores empty strings for builtins)
  const strategies = (data || []).map((s) => {
    if (s.is_builtin && (!s.prompt_template || s.prompt_template === "")) {
      return { ...s, prompt_template: STRATEGY_TEMPLATES[s.name] || "" };
    }
    return s;
  });

  return NextResponse.json({ strategies });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, name, display_name, description, prompt_template, output_format } = body;

    if (!user_id || !name || !display_name || !prompt_template) {
      return NextResponse.json(
        { error: "user_id, name, display_name, prompt_template required" },
        { status: 400 }
      );
    }

    const supabase = createServiceRoleClient();

    const { data, error } = await supabase
      .from("strategies")
      .insert({
        user_id,
        name,
        display_name,
        description: description || null,
        prompt_template,
        category: "custom",
        is_builtin: false,
        is_active: true,
        output_format: output_format || "simple",
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, strategy: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
