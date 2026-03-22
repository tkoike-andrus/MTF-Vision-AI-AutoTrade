import { NextRequest, NextResponse } from "next/server";
import {
  buildLosingPatternPrompt,
  buildWinningPatternPrompt,
  buildVisionChartPrompt,
} from "@/lib/ai/prompts";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Trade } from "@/lib/types/database";

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { analysis_type, user_id, trade_info, chart_image, chart_images, timeframes } = body;

    if (!analysis_type || !user_id) {
      return NextResponse.json(
        { error: "analysis_type and user_id are required" },
        { status: 400 }
      );
    }

    const supabase = createServiceRoleClient();

    // Fetch user's trades
    const { data: trades, error: tradesError } = await supabase
      .from("trades")
      .select("*")
      .eq("user_id", user_id)
      .order("exit_at_utc", { ascending: true });

    if (tradesError) throw tradesError;

    // Build prompt based on analysis type
    let prompt: string;
    const model = "gemini-3.1-pro-preview";

    switch (analysis_type) {
      case "losing_pattern":
        prompt = buildLosingPatternPrompt(trades as Trade[]);
        break;
      case "winning_pattern":
        prompt = buildWinningPatternPrompt(trades as Trade[]);
        break;
      case "vision_chart":
        prompt = buildVisionChartPrompt(trade_info || null, timeframes || []);
        break;
      default:
        return NextResponse.json(
          { error: "Invalid analysis_type" },
          { status: 400 }
        );
    }

    // Call Gemini API — try env first, fallback to user's bot_configs
    let geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      const { data: botConfig } = await supabase
        .from("bot_configs")
        .select("gemini_api_key")
        .eq("user_id", user_id)
        .single();
      geminiKey = botConfig?.gemini_api_key || undefined;
    }
    if (!geminiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEYが未設定です。設定ページまたは環境変数で設定してください。" },
        { status: 400 }
      );
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: prompt },
    ];

    // Add chart images for vision analysis (multiple MTF charts supported)
    if (analysis_type === "vision_chart") {
      const images: string[] = chart_images || (chart_image ? [chart_image] : []);
      for (const img of images) {
        parts.push({
          inlineData: {
            mimeType: "image/png",
            data: img,
          },
        });
      }
    }

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      throw new Error(`Gemini API error: ${geminiResponse.status} ${errText}`);
    }

    const geminiData = await geminiResponse.json();
    const responseText =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Try to parse JSON from response (strip markdown fences if present)
    let patterns = null;
    try {
      let cleanResponse = responseText
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "");
      const firstBrace = cleanResponse.indexOf("{");
      const lastBrace = cleanResponse.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        cleanResponse = cleanResponse.substring(firstBrace, lastBrace + 1);
      }
      const parsed = JSON.parse(cleanResponse);
      patterns = parsed.patterns || parsed;
    } catch {
      // Response wasn't valid JSON, that's ok
    }

    // Build chart_images array for vision_chart (store all MTF charts)
    let chartImagesData: { label: string; data_url: string }[] | null = null;
    if (analysis_type === "vision_chart") {
      const images: string[] = chart_images || (chart_image ? [chart_image] : []);
      const tfLabels = timeframes || [];
      if (images.length > 0) {
        chartImagesData = images.map((img: string, i: number) => ({
          label: tfLabels[i] || `チャート${i + 1}`,
          data_url: `data:image/png;base64,${img}`,
        }));
      }
    }

    // Save analysis to database (trigger auto-cleans to keep max 10 per user)
    const { error: saveError } = await supabase
      .from("trade_analyses")
      .insert({
        user_id,
        analysis_type,
        analysis_text: responseText,
        patterns,
        ai_model: model,
        token_count: geminiData.usageMetadata?.totalTokenCount || null,
        chart_images: chartImagesData,
      });

    if (saveError) {
      console.error("Failed to save analysis:", saveError);
    }

    return NextResponse.json({
      success: true,
      analysis_text: responseText,
      patterns,
      model,
      chart_images: chartImagesData,
    });
  } catch (err) {
    console.error("Diagnosis error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
