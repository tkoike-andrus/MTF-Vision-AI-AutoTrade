import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

/**
 * POST /api/trades/ocr
 * Accept a screenshot of trade history and use Gemini Vision to extract trade data.
 *
 * Body: {
 *   user_id: string,
 *   image: string (base64),
 *   broker?: string (hint: "sbi" | "gmo" | "other")
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, image, broker } = body;

    if (!user_id || !image) {
      return NextResponse.json(
        { error: "user_id and image are required" },
        { status: 400 }
      );
    }

    // Get Gemini API key — try bot_configs first, then env
    const supabase = createServiceRoleClient();
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
        { error: "GEMINI_API_KEY not configured. Please set it in Settings." },
        { status: 400 }
      );
    }

    const brokerHint = broker === "sbi"
      ? "SBI FXトレード"
      : broker === "gmo"
      ? "GMOコイン"
      : "不明なブローカー";

    const prompt = `あなたはFX取引履歴の画像をOCRで読み取る専門家です。
以下の画像は「${brokerHint}」の取引履歴のスクリーンショットです。

画像から全ての取引を読み取り、以下のJSON形式で正確に抽出してください。

## ${brokerHint}の画面構造ヒント:
${broker === "sbi" ? `- SBI FXトレードの約定履歴画面
- 列: 注文ID/約定日時, 銘柄名/売買区分, 約定数量/約定レート, 約定代金, 手数料, 決済損益/累計スワップ
- 売買区分: "新規 買" "新規 売" "決済 買" "決済 売"
- 「新規」と「決済」がペアで1つのトレード。同じ注文IDの新規と決済をマッチングしてください
- 決済損益は右端の列の上段の数値（下段は累計スワップ）
- 約定数量は通常10,000単位（=1lot）` : broker === "gmo" ? `- GMOコインFXの約定履歴画面
- 列構造（各行2段表示）:
  上段: 注文ID, 銘柄名, 約定数量, 約定代金, 手数料, 決済損益
  下段: 約定日時, 売買区分, 約定レート, (空), (空), 累計スワップ
- 売買区分: "新規 買" "新規 売" "決済 買" "決済 売"（色付きラベル）
- **重要**: 新規注文と決済注文には直接的な紐づけ（IDの一致）がありません
- **マッチングルール**: 以下の推論で新規と決済をペアリングしてください:
  1. 同じ銘柄名・同じ約定数量の「新規」と「決済」を探す
  2. 「新規 買」→「決済 売」、「新規 売」→「決済 買」が対になる
  3. 時系列で新規が先、決済が後
  4. 検証: (決済約定レート - 新規約定レート) × 約定数量 ≒ 決済損益（買いの場合）
     逆に売りの場合: (新規約定レート - 決済約定レート) × 約定数量 ≒ 決済損益
  5. 決済損益は「決済」行の右端上段の数値を使用
- まだ決済されていない「新規」行（決済損益が0で累計スワップも0）はスキップ` : `- ブローカー不明のため、一般的なFX取引履歴として解析してください
- 新規と決済のペアリングが可能であれば推論してマッチングしてください`}

## 出力形式:
{
  "trades": [
    {
      "pair": "USD_JPY",
      "side": "Buy",
      "entry_price": 150.123,
      "exit_price": 150.456,
      "pnl": 3300,
      "lot_size": 10000,
      "entry_at": "2025-01-15T09:30:00",
      "exit_at": "2025-01-15T14:20:00"
    }
  ],
  "broker": "${brokerHint}",
  "total_count": 5,
  "confidence": 0.95,
  "notes": "読み取れなかった部分や注意事項があれば記載"
}

## ルール:
- 通貨ペアは "USD_JPY", "EUR_JPY", "GBP_JPY", "AUD_JPY", "EUR_USD", "GBP_USD" のいずれかに正規化
- side は新規注文の方向を基準に "Buy" または "Sell"
- pnl は円単位の数値（マイナスは負の数）。決済損益の上段の数値を使用
- 日時はISO 8601形式（年は25→2025、26→2026に補完）
- lot_sizeは約定数量をそのまま記載（10,000なら10000）
- 読み取れない値はnullとして返す
- 新規注文のみ（まだ決済されていない）の行はスキップしてください
- JSON以外のテキストは出力しないでください`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;

    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/png", data: image } },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!geminiRes.ok) {
      // Fallback to Gemini 1.5 Flash
      const flashUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const flashRes = await fetch(flashUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: "image/png", data: image } },
            ],
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
          },
        }),
      });

      if (!flashRes.ok) {
        const errText = await flashRes.text();
        return NextResponse.json(
          { error: `Gemini API error: ${errText}` },
          { status: 500 }
        );
      }

      const flashData = await flashRes.json();
      const responseText = flashData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return parseAndRespond(responseText);
    }

    const geminiData = await geminiRes.json();
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return parseAndRespond(responseText);
  } catch (err) {
    console.error("OCR error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

function parseAndRespond(responseText: string) {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "AIの応答からJSONを解析できませんでした", raw: responseText },
        { status: 500 }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json({
      success: true,
      trades: parsed.trades || [],
      total_count: parsed.total_count || parsed.trades?.length || 0,
      confidence: parsed.confidence || 0,
      notes: parsed.notes || null,
      broker: parsed.broker || null,
    });
  } catch {
    return NextResponse.json(
      { error: "JSON parse failed", raw: responseText.slice(0, 500) },
      { status: 500 }
    );
  }
}
