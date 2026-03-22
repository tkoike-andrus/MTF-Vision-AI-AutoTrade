import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { STRATEGY_TEMPLATES } from "@/lib/strategies";

export const dynamic = 'force-dynamic';

/**
 * PUT /api/strategies/proposals/[id] — Approve or reject a proposal
 * Body: { action: "approve" | "reject" }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action } = body;

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { error: "action must be 'approve' or 'reject'" },
        { status: 400 }
      );
    }

    const supabase = createServiceRoleClient();

    // Get proposal
    const { data: proposal, error: fetchError } = await supabase
      .from("strategy_proposals")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }

    if (proposal.status !== "pending") {
      return NextResponse.json(
        { error: "Proposal already processed" },
        { status: 400 }
      );
    }

    // Update proposal status
    await supabase
      .from("strategy_proposals")
      .update({
        status: action === "approve" ? "approved" : "rejected",
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);

    // If approved, apply the change to the strategy
    if (action === "approve") {
      // Check if it's a built-in strategy
      const isBuiltin = proposal.strategy_name in (STRATEGY_TEMPLATES || {});

      if (isBuiltin) {
        // For builtins, update the DB record (overrides code template)
        await supabase
          .from("strategies")
          .update({
            prompt_template: proposal.proposed_prompt,
            updated_at: new Date().toISOString(),
          })
          .eq("name", proposal.strategy_name);
      } else {
        // For custom strategies, update directly
        await supabase
          .from("strategies")
          .update({
            prompt_template: proposal.proposed_prompt,
            updated_at: new Date().toISOString(),
          })
          .eq("name", proposal.strategy_name)
          .eq("user_id", proposal.user_id);
      }
    }

    return NextResponse.json({
      success: true,
      status: action === "approve" ? "approved" : "rejected",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
