import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

/**
 * PUT /api/strategies/[id] — Update a strategy
 * DELETE /api/strategies/[id] — Delete a custom strategy
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { display_name, description, prompt_template, output_format, is_active } = body;

    const supabase = createServiceRoleClient();

    const { data, error } = await supabase
      .from("strategies")
      .update({
        ...(display_name !== undefined && { display_name }),
        ...(description !== undefined && { description }),
        ...(prompt_template !== undefined && { prompt_template }),
        ...(output_format !== undefined && { output_format }),
        ...(is_active !== undefined && { is_active }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceRoleClient();

    const { data: existing } = await supabase
      .from("strategies")
      .select("is_builtin")
      .eq("id", id)
      .single();

    if (existing?.is_builtin) {
      // Builtin strategies: deactivate instead of delete
      const { error: deactivateError } = await supabase
        .from("strategies")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (deactivateError) {
        return NextResponse.json({ error: deactivateError.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, deactivated: true });
    }

    // Custom strategies: delete permanently
    const { error } = await supabase.from("strategies").delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
