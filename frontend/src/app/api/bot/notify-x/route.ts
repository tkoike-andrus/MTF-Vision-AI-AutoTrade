import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { postTradeToX } from "@/lib/notifications/x-post";
import { generateTweetText, type TweetAction } from "@/lib/ai/tweet-generator";

export const dynamic = 'force-dynamic';

type NotifyEvent = "bot_start" | "bot_stop" | "api_error" | "connection_error" | "custom";

interface NotifyBody {
  user_id: string;
  event: NotifyEvent;
  message?: string;
  detail?: Record<string, unknown>;
}

/**
 * Map notify events to TweetAction values that the prompt understands.
 * The user's prompt (e.g. 毒舌コンサル) defines rules for START / STOP / ERROR.
 */
const EVENT_TO_ACTION: Record<NotifyEvent, TweetAction> = {
  bot_start: "START",
  bot_stop: "STOP",
  api_error: "ERROR",
  connection_error: "ERROR",
  custom: "ERROR",
};

/**
 * Build the {last_reason} text from the event.
 * For sarcasm engines: "接続エラー" / "APIエラー" trigger specific sarcasm rules.
 */
function buildEventReason(event: NotifyEvent, message?: string): string {
  switch (event) {
    case "bot_start":
      return `Bot起動シーケンス完了。自動売買を開始します。${message ? `（${message}）` : ""}`;
    case "bot_stop":
      return `Bot停止。自動売買を中断します。${message ? `（${message}）` : ""}`;
    case "api_error":
      return `APIエラー: ${message || "不明なエラーが発生しました"}`;
    case "connection_error":
      return `接続エラー: ${message || "サーバーとの通信に失敗しました"}`;
    default:
      return message || event;
  }
}

/**
 * POST /api/bot/notify-x
 * Send X notification for system events using the user's configured prompt style.
 * Passes correct {action} (START/STOP/ERROR) and {last_reason} so the prompt's
 * rewrite rules (e.g. 毒舌コンサル sarcasm engine) activate properly.
 */
export async function POST(request: NextRequest) {
  try {
    const body: NotifyBody = await request.json();
    const { user_id, event, message } = body;

    if (!user_id || !event) {
      return NextResponse.json({ error: "user_id and event required" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const { data: config } = await supabase
      .from("bot_configs")
      .select("x_enabled, x_consumer_key, x_consumer_secret, x_access_token, x_access_token_secret, x_tweet_prompt, symbol, strategy_name, gemini_api_key")
      .eq("user_id", user_id)
      .single();

    if (!config?.x_enabled || !config.x_consumer_key || !config.x_access_token) {
      return NextResponse.json({ skipped: true, reason: "X not enabled or credentials missing" });
    }

    const symbol = config.symbol || "USD_JPY";
    const geminiKey = process.env.GEMINI_API_KEY || config.gemini_api_key;
    const eventReason = buildEventReason(event, message);
    const action = EVENT_TO_ACTION[event];

    // Only post Gemini-generated text — never raw system messages
    if (!geminiKey) {
      return NextResponse.json({ skipped: true, reason: "Gemini API key not available" });
    }

    const promptTemplate = config.x_tweet_prompt
      || `以下のBot運用イベントをXに投稿する日本語ツイートにしてください。140〜180文字。自然な口調で。\n\n通貨ペア: {pair}\nイベント: {action}\n詳細: {last_reason}\n\n{trade_info}`;

    const tweetText = await generateTweetText(
      geminiKey,
      promptTemplate,
      {
        action,
        symbol,
        confidence: 0,
        reason: eventReason,
      },
      "quick"
    );

    const result = await postTradeToX(
      {
        consumerKey: config.x_consumer_key,
        consumerSecret: config.x_consumer_secret,
        accessToken: config.x_access_token,
        accessTokenSecret: config.x_access_token_secret,
      },
      tweetText
    );

    return NextResponse.json({
      success: result.success,
      tweet_id: result.tweetId,
      tweet_text: tweetText,
      error: result.error,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

