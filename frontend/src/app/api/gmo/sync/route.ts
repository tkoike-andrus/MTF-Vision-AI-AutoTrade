import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { fetchGmoExecutions } from "@/lib/gmo/executions";

export const dynamic = 'force-dynamic';

/**
 * POST /api/gmo/sync
 * Fetch GMO Coin FX executions and save as trades
 *
 * Body: { user_id: string, api_key: string, api_secret: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, api_key, api_secret } = body;

    if (!user_id || !api_key || !api_secret) {
      return NextResponse.json(
        { error: "user_id, api_key, api_secret required" },
        { status: 400 }
      );
    }

    // 1. Fetch executions from GMO
    const parsedTrades = await fetchGmoExecutions(api_key, api_secret);

    if (parsedTrades.length === 0) {
      return NextResponse.json({ success: true, synced: 0, message: "No new trades" });
    }

    // 2. Create trade_upload record
    const supabase = createServiceRoleClient();
    const { data: upload, error: uploadError } = await supabase
      .from("trade_uploads")
      .insert({
        user_id,
        source: "api_gmo",
        filename: null,
        trade_count: parsedTrades.length,
        status: "parsed",
      })
      .select()
      .single();

    if (uploadError) throw uploadError;

    // 3. Upsert trades (avoid duplicates by broker_trade_id + broker)
    const tradesToInsert = parsedTrades.map((t) => ({
      user_id,
      upload_id: upload.id,
      broker_trade_id: t.broker_trade_id,
      broker: t.broker,
      pair: t.pair,
      side: t.side,
      entry_price: t.entry_price,
      exit_price: t.exit_price,
      pnl: t.pnl,
      lot_size: t.lot_size,
      entry_at_utc: t.entry_at_utc,
      exit_at_utc: t.exit_at_utc,
      trade_type: "manual", // GMO sync = discretionary trades
    }));

    const { error: insertError, data: inserted } = await supabase
      .from("trades")
      .upsert(tradesToInsert, {
        onConflict: "broker_trade_id,broker",
        ignoreDuplicates: false,
      })
      .select();

    if (insertError) throw insertError;

    // 4. Update upload status
    await supabase
      .from("trade_uploads")
      .update({
        trade_count: inserted?.length || parsedTrades.length,
        status: "saved",
      })
      .eq("id", upload.id);

    return NextResponse.json({
      success: true,
      synced: inserted?.length || parsedTrades.length,
      total_fetched: parsedTrades.length,
    });
  } catch (err) {
    console.error("GMO sync error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
