import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

const GMO_PUBLIC_API = "https://forex-api.coin.z.com/public";

const SHORT_RESOLUTIONS = ["1min", "5min", "10min", "15min", "30min", "1hour"];
const LONG_RESOLUTIONS = ["4hour", "8hour", "12hour", "1day", "1week", "1month"];

function normalizeTimestamp(unixMs: number, resolution: string): string {
  const date = new Date(unixMs);
  if (["1day", "1week", "1month"].includes(resolution)) {
    date.setUTCHours(0, 0, 0, 0);
  }
  return date.toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDateYMD(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

interface KlineItem {
  openTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

async function fetchKlines(
  pair: string,
  resolution: string,
  dateVal: string
): Promise<KlineItem[]> {
  const url = `${GMO_PUBLIC_API}/v1/klines?symbol=${pair}&priceType=ASK&interval=${resolution}&date=${dateVal}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 0) return [];
  return json.data || [];
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const pair: string = body.pair;
    const resolutions: string[] = body.resolutions || ["5min", "1hour", "4hour", "1day"];

    if (!pair) {
      return NextResponse.json({ error: "pair is required" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const syncedCounts: Record<string, number> = {};
    const errors: string[] = [];
    let totalNew = 0;

    for (const res of resolutions) {
      const key = `${pair}_${res}`;
      try {
        // Get latest timestamp for this pair+resolution
        const { data: latestRow } = await supabase
          .from("market_data")
          .select("timestamp")
          .eq("pair", pair)
          .eq("resolution", res)
          .order("timestamp", { ascending: false })
          .limit(1)
          .single();

        const latestTimestamp = latestRow?.timestamp
          ? new Date(latestRow.timestamp)
          : null;

        const isShort = SHORT_RESOLUTIONS.includes(res);
        const isLong = LONG_RESOLUTIONS.includes(res);
        const datesToFetch: string[] = [];

        if (isShort) {
          // Fetch day-by-day from latest+1 to today
          const startDate = latestTimestamp
            ? new Date(latestTimestamp.getTime() + 86400000) // next day
            : new Date(Date.now() - 7 * 86400000); // default: last 7 days
          const today = new Date();

          const current = new Date(startDate);
          while (current <= today) {
            datesToFetch.push(formatDateYMD(current));
            current.setUTCDate(current.getUTCDate() + 1);
          }
        } else if (isLong) {
          // Fetch current year (covers all recent data)
          const currentYear = new Date().getUTCFullYear().toString();
          datesToFetch.push(currentYear);
          // Also fetch previous year if no data exists
          if (!latestTimestamp) {
            datesToFetch.unshift((parseInt(currentYear) - 1).toString());
          }
        }

        let resCount = 0;

        for (const dateVal of datesToFetch) {
          const klines = await fetchKlines(pair, res, dateVal);

          if (klines.length > 0) {
            const batchData = klines.map((item) => ({
              pair,
              resolution: res,
              timestamp: normalizeTimestamp(parseInt(item.openTime), res),
              open: parseFloat(item.open),
              high: parseFloat(item.high),
              low: parseFloat(item.low),
              close: parseFloat(item.close),
              volume: parseFloat(item.volume || "0"),
            }));

            const { error: upsertError } = await supabase
              .from("market_data")
              .upsert(batchData, { onConflict: "pair,resolution,timestamp" });

            if (upsertError) {
              errors.push(`${key}/${dateVal}: ${upsertError.message}`);
            } else {
              resCount += batchData.length;
            }
          }

          // Rate limit: 1.2s between API calls
          await sleep(1200);
        }

        syncedCounts[key] = resCount;
        totalNew += resCount;
      } catch (err) {
        errors.push(`${key}: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }

    return NextResponse.json({
      success: true,
      synced_counts: syncedCounts,
      total_new: totalNew,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
