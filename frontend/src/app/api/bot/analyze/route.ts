import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { analyzeChart, type VisionAnalysisResult } from "@/lib/ai/gemini-vision";
import { buildStrategyPrompt, type StrategyInput } from "@/lib/strategies";
import { buildFullPrompt, buildPositionContext } from "@/lib/strategies/system-prompt";
import {
  placeMarketOrder,
  closeAllPositions,
  getOpenPositions,
  placeStopLossOrder,
  cancelOrder,
  getTickerPrice,
} from "@/lib/gmo/orders";
import {
  sendDiscordMessage,
  createTradeEmbed,
  createExecutionEmbed,
} from "@/lib/notifications/discord";
import { postTradeToX } from "@/lib/notifications/x-post";
import { generateTweetText, isBigTrade, type TradeInfo, type TweetMode } from "@/lib/ai/tweet-generator";
import type { GmoPosition } from "@/lib/gmo/types";
import { readFile, stat } from "fs/promises";
import { join } from "path";

export const dynamic = 'force-dynamic';

const MTF_CHART_FILES = ["m5.png", "h1.png", "h4.png", "d1.png"];
const MTF_TIMEFRAMES = ["5分足", "1時間足", "4時間足", "日足"];

type LogCategory = "SYSTEM" | "ANALYSIS" | "CHART" | "GMO_API" | "TRADE" | "RISK" | "ERROR";
type LogLevel = "INFO" | "WARN" | "ERROR" | "SUCCESS";

/**
 * Activity logger — in-memory only, returned in API response.
 * No DB storage to avoid unnecessary data accumulation.
 */
function createActivityLogger() {
  const logs: Array<{
    timestamp: string;
    category: LogCategory;
    level: LogLevel;
    message: string;
    detail?: Record<string, unknown>;
  }> = [];

  const log = async (
    category: LogCategory,
    level: LogLevel,
    message: string,
    detail?: Record<string, unknown>
  ) => {
    logs.push({
      timestamp: new Date().toISOString(),
      category,
      level,
      message,
      detail,
    });
  };

  return { log, logs };
}

/**
 * POST /api/bot/analyze
 * Main bot analysis endpoint — called periodically or manually.
 */
export async function POST(request: NextRequest) {
  const cycleId = `cycle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const body = await request.json();
    const { user_id, chart_image, economic_info, dry_run = false } = body;

    if (!user_id) {
      return NextResponse.json({ error: "user_id required" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const { log, logs: activityLogs } = createActivityLogger();

    // ── Step 1: Load config & state ──
    await log("SYSTEM", "INFO", "分析サイクル開始", {
      dry_run,
      trigger: chart_image ? "手動（画像アップロード）" : "自動（定期実行）",
    });

    const [configRes, stateRes] = await Promise.all([
      supabase.from("bot_configs").select("*").eq("user_id", user_id).single(),
      supabase.from("bot_states").select("*").eq("user_id", user_id).single(),
    ]);

    if (!configRes.data) {
      await log("ERROR", "ERROR", "Bot設定が見つかりません");
      return NextResponse.json({ error: "Bot not configured" }, { status: 400 });
    }

    const config = configRes.data;
    if (!config.is_active && !dry_run) {
      return NextResponse.json({ error: "Bot is not active" }, { status: 400 });
    }

    await log("SYSTEM", "INFO", `設定読み込み完了: ${config.symbol.replace("_", "/")} / 戦略: ${config.strategy_name}`, {
      symbol: config.symbol,
      strategy: config.strategy_name,
      lot_size: config.lot_size,
    });

    // Initialize state if not exists
    let state = stateRes.data;
    if (!state) {
      const { data: newState } = await supabase
        .from("bot_states")
        .insert({ user_id })
        .select()
        .single();
      state = newState;
      await log("SYSTEM", "INFO", "Bot状態を初期化しました");
    }

    // ── Step 2: Verify GMO position existence ──
    if (state?.position && !dry_run) {
      const apiKey = String(config.gmo_api_key_enc || "");
      const apiSecret = String(config.gmo_api_secret_enc || "");

      if (apiKey && apiSecret && state.position_id) {
        await log("GMO_API", "INFO", `GMO建玉確認API実行中... (positionId: ${state.position_id})`, {
          api: "GET /v1/openPositions",
          position_id: state.position_id,
          symbol: config.symbol,
        });

        try {
          const positionsRes = await getOpenPositions(apiKey, apiSecret, String(config.symbol));
          const positions = (positionsRes.data?.list || []) as GmoPosition[];
          const found = positions.find(
            (p) => String(p.positionId) === String(state.position_id)
          );

          if (!found) {
            const closedPositionId = String(state.position_id);
            const closedSide = String(state.position) as "BUY" | "SELL";
            const closedEntryPrice = Number(state.entry_price) || 0;
            const closedEntryAt = state.entry_at ? String(state.entry_at) : new Date().toISOString();

            await log("GMO_API", "WARN", `ポジション ${closedPositionId} がGMO上で検出されません → 手動決済またはSL到達と判断`, {
              checked_positions: positions.length,
            });

            // ── Fetch execution details for the closed position ──
            let tradePnl = 0;
            let exitPrice = 0;
            try {
              const { fetchGmoExecutions } = await import("@/lib/gmo/executions");
              const recentTrades = await fetchGmoExecutions(apiKey, apiSecret, {
                symbol: String(config.symbol),
                count: 10,
              });

              // Find the execution matching this positionId
              // broker_trade_id format: "GMO_{executionId}", and lossGain is in the raw data
              // We match by checking recent CLOSE executions
              const matchedTrade = recentTrades.find(t =>
                t.broker_trade_id.startsWith("GMO_") && (
                  // Match by entry price proximity (within 0.01) + same side
                  (Math.abs(t.entry_price - closedEntryPrice) < 0.1 && t.side === (closedSide === "BUY" ? "Buy" : "Sell"))
                )
              ) || recentTrades[0]; // Fallback to most recent

              if (matchedTrade) {
                tradePnl = matchedTrade.pnl;
                exitPrice = matchedTrade.exit_price;
                const bestEntryPrice = matchedTrade.entry_price !== matchedTrade.exit_price
                  ? matchedTrade.entry_price
                  : closedEntryPrice;

                await log("GMO_API", "SUCCESS", `決済明細取得完了: 決済価格=${exitPrice} P&L=¥${tradePnl >= 0 ? "+" : ""}${tradePnl.toLocaleString()}`, {
                  exit_price: exitPrice,
                  pnl: tradePnl,
                  trade_id: matchedTrade.broker_trade_id,
                });

                await supabase.from("trades").upsert(
                  {
                    user_id: user_id,
                    broker_trade_id: matchedTrade.broker_trade_id,
                    broker: "GMO",
                    pair: matchedTrade.pair,
                    side: matchedTrade.side,
                    entry_price: bestEntryPrice,
                    exit_price: matchedTrade.exit_price,
                    pnl: matchedTrade.pnl,
                    lot_size: matchedTrade.lot_size,
                    entry_at_utc: matchedTrade.entry_at_utc || closedEntryAt,
                    exit_at_utc: matchedTrade.exit_at_utc,
                    trade_type: "auto",
                  },
                  { onConflict: "broker_trade_id,broker" }
                );

                await log("TRADE", "SUCCESS", `取引履歴をtradesテーブルに保存しました`);
              } else {
                await log("GMO_API", "WARN", "決済明細が見つかりませんでした（約定データなし）");
              }
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : "Unknown";
              await log("GMO_API", "ERROR", `決済明細取得失敗: ${errMsg}`, { error: errMsg });
            }

            await supabase
              .from("auto_trade_orders")
              .update({
                status: "CLOSED_MANUAL",
                pnl: tradePnl || null,
                exit_price: exitPrice || null,
                closed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", user_id)
              .eq("gmo_position_id", closedPositionId)
              .eq("status", "OPEN");

            await supabase
              .from("bot_states")
              .update({
                position: null,
                entry_price: null,
                entry_at: null,
                position_id: null,
                stop_loss_order_id: null,
                consecutive_losses: tradePnl < 0 ? Number(state.consecutive_losses || 0) + 1 : 0,
                daily_pnl: Number(state.daily_pnl || 0) + tradePnl,
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", user_id);

            state = {
              ...state,
              position: null,
              entry_price: null,
              entry_at: null,
              position_id: null,
              stop_loss_order_id: null,
            };

            const pnlStr = tradePnl !== 0 ? ` (P&L: ¥${tradePnl >= 0 ? "+" : ""}${tradePnl.toLocaleString()})` : "";
            await log("SYSTEM", "SUCCESS", `Bot状態をリセットしました（ノーポジションに変更）${pnlStr}`);

            if (config.notification_enabled && config.discord_webhook_url) {
              await sendDiscordMessage(
                config.discord_webhook_url,
                `ℹ️ ポジション ${closedPositionId} がGMO上で検出されません（手動決済またはSL到達）${pnlStr}。状態をリセットしました。`
              );
            }
          } else {
            await log("GMO_API", "SUCCESS", `ポジション確認OK: ${state.position} @${state.entry_price} (ID: ${state.position_id})`, {
              position_count: positions.length,
            });
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          await log("GMO_API", "ERROR", `GMO建玉確認に失敗: ${errMsg}`, { error: errMsg });
          await notifyXError(config, `GMO建玉確認失敗: ${errMsg}`);
        }
      }
    } else if (state?.position && dry_run) {
      await log("SYSTEM", "INFO", `ドライランモード: GMO建玉確認をスキップ (現在: ${state.position} @${state.entry_price})`);
    } else {
      await log("SYSTEM", "INFO", "現在ポジションなし");
    }

    // ── Step 3: Check trading hours (supports overnight, e.g. start=8 end=26 → 8:00~翌2:00) ──
    const now = new Date();
    let jstHour = (now.getUTCHours() + 9) % 24;
    const endHour = Number(config.trade_end_hour || 24);
    const startHour = Number(config.trade_start_hour || 0);
    // For overnight ranges (end > 24), shift hours before start into next-day range
    if (endHour > 24 && jstHour < startHour) {
      jstHour += 24;
    }
    const endLabel = endHour > 24 ? `翌${endHour - 24}` : String(endHour);
    if (!dry_run && (jstHour < startHour || jstHour >= endHour)) {
      await log("RISK", "WARN", `取引時間外のためスキップ (現在JST ${(now.getUTCHours() + 9) % 24}時 / 許可: ${startHour}-${endLabel}時)`);
      return NextResponse.json({
        skipped: true,
        reason: `Outside trading hours (${startHour}:00-${endLabel}:00 JST)`,
        activity_logs: activityLogs,
      });
    }
    await log("RISK", "SUCCESS", `取引時間チェックOK (JST ${(now.getUTCHours() + 9) % 24}時)${dry_run ? " [ドライラン: 時間制限無視]" : ""}`);

    // ── Step 4: Check risk limits ──
    const riskCheck = checkRiskLimits(state, config);
    if (!dry_run && riskCheck) {
      await log("RISK", "WARN", `リスク制限に到達: ${riskCheck}`);
      return NextResponse.json({
        skipped: true,
        reason: riskCheck,
        activity_logs: activityLogs,
      });
    }
    await log("RISK", "SUCCESS", `リスクチェックOK (連敗: ${state?.consecutive_losses || 0} / 日次損益: ¥${(state?.daily_pnl || 0).toLocaleString()})`);

    // ── Step 5: Build strategy prompt ──
    const positionStatus = state?.position
      ? `${state.position} (@${state.entry_price})`
      : "ノーポジション";

    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const dtStr = `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, "0")}-${String(jstNow.getUTCDate()).padStart(2, "0")} ${String(jstNow.getUTCHours()).padStart(2, "0")}:${String(jstNow.getUTCMinutes()).padStart(2, "0")}`;

    // Fetch current price from GMO public API
    // BUY position → BID (決済価格), SELL position → ASK (決済価格), No position → ASK
    const positionSide = (state?.position as "BUY" | "SELL" | null) || null;
    const currentPrice = await getTickerPrice(String(config.symbol), positionSide);
    if (currentPrice) {
      const priceType = positionSide === "BUY" ? "BID" : positionSide === "SELL" ? "ASK" : "ASK";
      await log("GMO_API", "INFO", `現在価格取得: ${config.symbol} = ${currentPrice} (${priceType})`);
    }

    const strategyInput: StrategyInput = {
      symbol: config.symbol,
      currentDtStr: dtStr,
      economicInfo: economic_info || "データなし",
      aiSummary: "データなし",
      positionStatus,
      currentPrice: currentPrice ? String(currentPrice) : undefined,
    };

    // Load custom strategy template from DB if not a built-in strategy
    let customTemplate: string | undefined;
    const { data: dbStrategy } = await supabase
      .from("strategies")
      .select("prompt_template")
      .eq("name", config.strategy_name)
      .single();
    if (dbStrategy?.prompt_template) {
      customTemplate = dbStrategy.prompt_template;
    }

    const userPrompt = buildStrategyPrompt(String(config.strategy_name), strategyInput, customTemplate);
    const positionContext = buildPositionContext(
      state?.position as "BUY" | "SELL" | null,
      state?.entry_price ? Number(state.entry_price) : null,
      state?.entry_at ? String(state.entry_at) : null
    );
    const prompt = buildFullPrompt(userPrompt, positionContext);

    await log("ANALYSIS", "INFO", `戦略プロンプト構築完了 (${prompt.length}文字)`, {
      strategy: config.strategy_name,
      position_status: positionStatus,
      has_position_context: !!positionContext,
    });

    // ── Step 5.5: Load chart images ──
    // PC (localhost): ローカルフォルダ直読み優先
    // Vercel (スマホ): Supabase Storage から取得
    let chartImages: string[] = [];
    let chartTimeframes: string[] = [];
    const CHART_BUCKET = "chart-images";
    const isVercel = !!process.env.VERCEL;

    if (chart_image) {
      chartImages = [chart_image];
      chartTimeframes = ["チャート"];
      await log("CHART", "SUCCESS", "アップロードされたチャート画像を使用");
    } else if (!isVercel && config.chart_image_folder) {
      // ── PC: ローカルファイルシステムから直接読み込み ──
      await log("CHART", "INFO", `ローカルフォルダをスキャン中: ${config.chart_image_folder}`);
      for (let i = 0; i < MTF_CHART_FILES.length; i++) {
        const filePath = join(config.chart_image_folder, MTF_CHART_FILES[i]);
        try {
          const fileStat = await stat(filePath);
          const ageMs = Date.now() - fileStat.mtime.getTime();
          if (ageMs < 30 * 60 * 1000) {
            const buf = await readFile(filePath);
            chartImages.push(buf.toString("base64"));
            chartTimeframes.push(MTF_TIMEFRAMES[i]);
          } else {
            await log("CHART", "WARN", `${MTF_TIMEFRAMES[i]} (${MTF_CHART_FILES[i]}) は古いためスキップ (${Math.floor(ageMs / 60000)}分前)`);
          }
        } catch {
          await log("CHART", "WARN", `${MTF_TIMEFRAMES[i]} (${MTF_CHART_FILES[i]}) が見つかりません`);
        }
      }
      if (chartImages.length > 0) {
        await log("CHART", "SUCCESS", `ローカルから ${chartImages.length}/${MTF_CHART_FILES.length}枚を読み込み完了: ${chartTimeframes.join(", ")}`);
      } else {
        await log("CHART", "WARN", "有効なチャート画像が見つかりません（テキストのみで分析）");
      }
    } else {
      // ── Vercel (スマホ): Supabase Storageから取得 ──
      await log("CHART", "INFO", "Supabase Storageからチャート画像を取得中...");
      for (let i = 0; i < MTF_CHART_FILES.length; i++) {
        const storagePath = `charts/${MTF_CHART_FILES[i]}`;
        try {
          const { data, error } = await supabase.storage
            .from(CHART_BUCKET)
            .download(storagePath);
          if (!error && data) {
            const buffer = Buffer.from(await data.arrayBuffer());
            chartImages.push(buffer.toString("base64"));
            chartTimeframes.push(MTF_TIMEFRAMES[i]);
          }
        } catch {
          await log("CHART", "WARN", `${MTF_TIMEFRAMES[i]} (${MTF_CHART_FILES[i]}) をStorageから取得できません`);
        }
      }
      if (chartImages.length > 0) {
        await log("CHART", "SUCCESS", `Supabase Storageから ${chartImages.length}/${MTF_CHART_FILES.length}枚を読み込み完了: ${chartTimeframes.join(", ")}`);
      } else {
        await log("CHART", "WARN", "チャート画像が見つかりません（テキストのみで分析）");
      }
    }

    // ── Step 6: Call Gemini Vision AI ──
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
      await log("ERROR", "ERROR", "GEMINI_API_KEYが設定されていません");
      return NextResponse.json({ error: "GEMINI_API_KEY not configured", activity_logs: activityLogs }, { status: 500 });
    }

    await log("ANALYSIS", "INFO", `Gemini Vision AI 解析開始... (画像${chartImages.length}枚)`, {
      api: "Gemini Pro Vision",
      image_count: chartImages.length,
      timeframes: chartTimeframes,
    });

    let analysis: VisionAnalysisResult;
    try {
      const primaryImage = chartImages.length > 0 ? chartImages[0] : undefined;
      analysis = await analyzeChart(geminiKey, prompt, primaryImage, chartImages.length > 1 ? chartImages : undefined);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "AI analysis failed";
      await log("ANALYSIS", "ERROR", `Gemini AI解析エラー: ${errorMsg}`, { error: errorMsg });
      if (config.discord_webhook_url) {
        await sendDiscordMessage(config.discord_webhook_url, `⚠️ AATM AI分析エラー: ${errorMsg}`);
      }
      await notifyXError(config, `AI分析エラー: ${errorMsg}`, geminiKey);
      return NextResponse.json({ error: errorMsg, activity_logs: activityLogs }, { status: 500 });
    }

    const slTpInfo = analysis.stop_loss || analysis.take_profit
      ? ` | SL: ${analysis.stop_loss ?? "なし"} / TP: ${analysis.take_profit ?? "なし"}`
      : "";
    await log("ANALYSIS", "SUCCESS", `AI解析完了: ${analysis.action} (確信度: ${(analysis.confidence * 100).toFixed(0)}%)${slTpInfo}`, {
      action: analysis.action,
      confidence: analysis.confidence,
      reason: analysis.reason,
      model: analysis.model,
      stop_loss: analysis.stop_loss,
      take_profit: analysis.take_profit,
      entry_price: analysis.entry_price,
    });

    // ── Step 7: Save signal ──
    const signalData = {
      user_id,
      symbol: config.symbol,
      strategy_name: config.strategy_name,
      action: analysis.action,
      confidence: analysis.confidence,
      reason: analysis.reason,
      ai_model: analysis.model,
      ai_response_json: analysis.parsedJson,
      position_status: positionStatus,
      executed: false,
      execution_result: null as Record<string, unknown> | null,
    };

    // ── Step 8: Execute trade ──
    let executionResult: Record<string, unknown> | null = null;

    if (!dry_run && shouldExecute(analysis, state)) {
      await log("TRADE", "INFO", `取引実行条件を満たしました: ${analysis.action} (confidence: ${analysis.confidence} >= 0.6)`);

      try {
        executionResult = await executeTradeAction(
          analysis.action,
          config,
          state,
          supabase,
          user_id,
          log,
          analysis
        );
        signalData.executed = true;
        signalData.execution_result = executionResult;

        await log("TRADE", "SUCCESS", `取引実行完了: ${executionResult.type === "order" ? "新規注文" : executionResult.type === "close" ? "ポジション決済" : "アクションなし"}`, {
          execution_type: executionResult.type,
          order_id: executionResult.order_id,
          position_id: executionResult.position_id,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Execution failed";
        signalData.execution_result = { error: errMsg };
        await log("TRADE", "ERROR", `取引実行失敗: ${errMsg}`, { error: errMsg });

        if (config.discord_webhook_url) {
          const embed = createExecutionEmbed(
            "ORDER_FAILED",
            config.symbol,
            analysis.action,
            config.lot_size,
            undefined,
            undefined,
            errMsg
          );
          await sendDiscordMessage(config.discord_webhook_url, "❌ 注文失敗", embed);
        }
        await notifyXError(config, `注文失敗 (${analysis.action} ${config.symbol}): ${errMsg}`, geminiKey);
      }
    } else if (dry_run) {
      await log("SYSTEM", "INFO", `ドライランモード: 取引実行をスキップ (判定: ${analysis.action})`, {
        action: analysis.action,
        would_execute: shouldExecute(analysis, state),
      });
    } else {
      const reason = analysis.confidence < 0.6
        ? `確信度不足 (${(analysis.confidence * 100).toFixed(0)}% < 60%)`
        : analysis.action === "WAIT" || analysis.action === "HOLD"
          ? `${analysis.action}: 取引不要`
          : "実行条件未達";
      await log("ANALYSIS", "INFO", `取引実行スキップ: ${reason}`);
    }

    // ── Save signal to trade_signals table ──
    let savedSignalId: string | null = null;
    try {
      const { data: savedSignal } = await supabase
        .from("trade_signals")
        .insert({
          user_id,
          symbol: config.symbol,
          strategy_name: config.strategy_name,
          action: analysis.action,
          confidence: analysis.confidence,
          reason: analysis.reason,
          current_price: analysis.parsedJson?.current_price || null,
          ai_model: analysis.model,
          ai_response_json: analysis.parsedJson || null,
          position_status: positionStatus,
          executed: signalData.executed,
          execution_result: signalData.execution_result,
        })
        .select("id")
        .single();
      savedSignalId = savedSignal?.id || null;
    } catch (err) {
      console.error("Failed to save signal:", err);
    }

    // Link to auto_trade_order if BUY/SELL executed
    if (executionResult?.type === "order" && executionResult?.position_id) {
      await supabase.from("auto_trade_orders").insert({
        user_id,
        signal_id: savedSignalId,
        gmo_order_id: executionResult.order_id ? String(executionResult.order_id) : null,
        gmo_position_id: executionResult.position_id ? String(executionResult.position_id) : null,
        symbol: config.symbol,
        side: analysis.action,
        status: "OPEN",
        entry_price: executionResult.entry_price || null,
        lot_size: Number(config.lot_size || 1),
        opened_at: new Date().toISOString(),
      });
    }

    // Update auto_trade_orders on EXIT
    if (executionResult?.type === "close" && state?.position_id) {
      await supabase
        .from("auto_trade_orders")
        .update({
          status: "CLOSED_AI",
          exit_price: executionResult.exit_price || null,
          pnl: executionResult.pnl || null,
          closed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user_id)
        .eq("gmo_position_id", String(state.position_id))
        .eq("status", "OPEN");
    }

    // ── Step 9: Update bot state ──
    await supabase
      .from("bot_states")
      .update({
        last_analysis_at: now.toISOString(),
        last_action: analysis.action,
        last_confidence: analysis.confidence,
        last_reason: analysis.reason,
        updated_at: now.toISOString(),
      })
      .eq("user_id", user_id);

    // ── Step 10: Discord notification (BUY/SELL/EXIT only) ──
    const discordActions = ["BUY", "SELL", "EXIT"];
    if (config.notification_enabled && config.discord_webhook_url && discordActions.includes(analysis.action)) {
      const mention = config.discord_user_id ? `<@${config.discord_user_id}> ` : "";
      const strategy = config.strategy_name;
      const embed = createTradeEmbed(
        analysis.action,
        config.symbol,
        analysis.confidence,
        analysis.reason,
        positionStatus,
        undefined,
        strategy
      );
      await sendDiscordMessage(
        config.discord_webhook_url,
        `${mention}🔔 **${config.symbol.replace("_", "/")} Signal**`,
        embed
      );
    }

    // ── Step 11: X (Twitter) auto-post on BUY/SELL/EXIT execution ──
    if (
      config.x_enabled &&
      config.x_consumer_key &&
      config.x_consumer_secret &&
      config.x_access_token &&
      config.x_access_token_secret &&
      signalData.executed &&
      (analysis.action === "BUY" || analysis.action === "SELL" || analysis.action === "EXIT")
    ) {
      try {
        await log("SYSTEM", "INFO", "X投稿を作成中...");

        // Build trade info for tweet generation
        const tradeInfo: TradeInfo = {
          action: analysis.action as "BUY" | "SELL" | "EXIT",
          symbol: config.symbol,
          confidence: analysis.confidence,
          reason: analysis.reason,
        };

        // Add execution details
        if (executionResult) {
          if (executionResult.type === "order") {
            tradeInfo.entryPrice = executionResult.entry_price as number | undefined;
          } else if (executionResult.type === "close") {
            tradeInfo.exitPrice = executionResult.exit_price as number | undefined;
            tradeInfo.pnl = executionResult.pnl as number | undefined;
            tradeInfo.side = executionResult.side as "BUY" | "SELL" | undefined;
            // Calculate hold duration
            if (state?.entry_at) {
              const holdMs = Date.now() - new Date(String(state.entry_at)).getTime();
              const holdH = Math.floor(holdMs / 3600000);
              const holdM = Math.floor((holdMs % 3600000) / 60000);
              tradeInfo.holdDuration = holdH > 0 ? `${holdH}h${holdM}m` : `${holdM}m`;
            }
            if (state?.entry_price) {
              tradeInfo.entryPrice = Number(state.entry_price);
            }
          }
        }

        // Determine tweet mode: drama for big wins/losses, quick for everything else
        const bigThreshold = Number(config.x_big_trade_threshold || 10000);
        const isDrama = analysis.action === "EXIT" && isBigTrade(tradeInfo.pnl, bigThreshold);
        const tweetMode: TweetMode = isDrama ? "drama" : "quick";

        const tweetPrompt = isDrama
          ? (config.x_tweet_prompt_drama || config.x_tweet_prompt || "以下の取引情報をXに投稿する日本語ツイートにしてください。\n{trade_info}")
          : (config.x_tweet_prompt || "以下の取引情報をXに投稿する日本語ツイートにしてください。\n{trade_info}");

        await log("SYSTEM", "INFO", `投稿モード: ${isDrama ? "ドラマ (300-500字)" : "通常 (140-200字)"}${isDrama ? ` | P&L ¥${Math.abs(tradeInfo.pnl || 0).toLocaleString()} >= しきい値 ¥${bigThreshold.toLocaleString()}` : ""}`);

        const tweetText = await generateTweetText(
          geminiKey,
          tweetPrompt,
          tradeInfo,
          tweetMode
        );

        // Attach all available MTF chart images (up to 4: M5, H1, H4, D1)
        // chartImages order: [0]=m5, [1]=h1, [2]=h4, [3]=d1
        const chartImagesForTweet: string[] = [];
        if (chartImages[0]) chartImagesForTweet.push(chartImages[0]); // M5
        if (chartImages[1]) chartImagesForTweet.push(chartImages[1]); // H1
        if (chartImages[2]) chartImagesForTweet.push(chartImages[2]); // H4
        if (chartImages[3]) chartImagesForTweet.push(chartImages[3]); // D1

        // Post to X
        const xResult = await postTradeToX(
          {
            consumerKey: config.x_consumer_key,
            consumerSecret: config.x_consumer_secret,
            accessToken: config.x_access_token,
            accessTokenSecret: config.x_access_token_secret,
          },
          tweetText,
          chartImagesForTweet.length > 0 ? chartImagesForTweet : undefined
        );

        if (xResult.success) {
          await log("SYSTEM", "SUCCESS", `X投稿完了 (${tweetMode}/${tweetText.length}字/画像${chartImagesForTweet.length}枚): ${tweetText.slice(0, 60)}...`, {
            tweet_id: xResult.tweetId,
            image_count: chartImagesForTweet.length,
            mode: tweetMode,
            char_count: tweetText.length,
          });
        } else {
          await log("SYSTEM", "WARN", `X投稿失敗: ${xResult.error}`, {
            error: xResult.error,
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        await log("SYSTEM", "WARN", `X投稿エラー: ${errMsg}`);
      }
    }

    await log("SYSTEM", "SUCCESS", `分析サイクル完了: ${analysis.action} (${(analysis.confidence * 100).toFixed(0)}%) ${signalData.executed ? "→ 約定" : dry_run ? "[ドライラン]" : ""}`);

    return NextResponse.json({
      success: true,
      signal: {
        id: savedSignalId,
        action: analysis.action,
        confidence: analysis.confidence,
        reason: analysis.reason,
        model: analysis.model,
        strategy_name: config.strategy_name,
        symbol: config.symbol,
        position_status: positionStatus,
        ai_response_json: analysis.parsedJson,
      },
      executed: signalData.executed,
      executionResult,
      dry_run,
      chart_images_count: chartImages.length,
      chart_timeframes: chartTimeframes,
      cycle_id: cycleId,
      activity_logs: activityLogs,
    });
  } catch (err) {
    console.error("Bot analyze error:", err);

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

function checkRiskLimits(
  state: Record<string, unknown> | null,
  config: Record<string, unknown>
): string | null {
  if (!state) return null;

  const consecutiveLosses = Number(state.consecutive_losses || 0);
  const dailyPnl = Number(state.daily_pnl || 0);

  const maxConsecutiveLosses = 5;
  const maxDailyLoss = -100000; // ¥100,000

  if (consecutiveLosses >= maxConsecutiveLosses) {
    return `連敗ロック中 (${consecutiveLosses}連敗)`;
  }
  if (dailyPnl <= maxDailyLoss) {
    return `日次損失上限到達 (¥${dailyPnl.toLocaleString()})`;
  }

  if (state.position && Number(config.max_positions || 1) <= 1) {
    return null;
  }

  return null;
}

function shouldExecute(
  analysis: VisionAnalysisResult,
  state: Record<string, unknown> | null
): boolean {
  const { action, confidence } = analysis;
  const hasPosition = state?.position != null;
  const minConfidence = 0.6;

  if (confidence < minConfidence) return false;

  if (hasPosition) {
    return action === "EXIT";
  } else {
    return action === "BUY" || action === "SELL";
  }
}

function calculateStopPrice(
  entryPrice: number,
  side: "BUY" | "SELL",
  symbol: string
): number {
  const isJpy = symbol.includes("JPY");
  const stopDistance = isJpy ? 0.500 : 0.0050;

  if (side === "BUY") {
    return Math.round((entryPrice - stopDistance) * 1000) / 1000;
  } else {
    return Math.round((entryPrice + stopDistance) * 1000) / 1000;
  }
}

type LogFn = (
  category: LogCategory,
  level: LogLevel,
  message: string,
  detail?: Record<string, unknown>
) => Promise<void>;

async function executeTradeAction(
  action: string,
  config: Record<string, unknown>,
  state: Record<string, unknown> | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  log: LogFn,
  analysis?: VisionAnalysisResult
): Promise<Record<string, unknown>> {
  const apiKey = String(config.gmo_api_key_enc || "");
  const apiSecret = String(config.gmo_api_secret_enc || "");
  const symbol = String(config.symbol);
  const lotSize = Number(config.lot_size || 1);

  if (!apiKey || !apiSecret) {
    throw new Error("GMO API credentials not configured");
  }

  await log("GMO_API", "INFO", `API認証情報: key=${apiKey.slice(0, 6)}...${apiKey.slice(-4)} (${apiKey.length}文字)`, {
    key_prefix: apiKey.slice(0, 6),
    key_suffix: apiKey.slice(-4),
    key_length: apiKey.length,
    secret_length: apiSecret.length,
  });

  if (action === "BUY" || action === "SELL") {
    // ── Step 1: Place market order ──
    await log("GMO_API", "INFO", `GMO成行注文API送信中: ${action} ${symbol.replace("_", "/")} ${lotSize.toLocaleString()}通貨`, {
      api: "POST /v1/order",
      action,
      symbol,
      lot_size: lotSize,
      order_type: "MARKET",
    });

    const orderResult = await placeMarketOrder(apiKey, apiSecret, symbol, action as "BUY" | "SELL", lotSize);

    if (orderResult.status !== 0) {
      // Extract error detail from GMO messages array
      const gmoMessages = orderResult.messages;
      const errorDetail = gmoMessages?.map(m => `[${m.message_code}] ${m.message_string}`).join(", ") || "詳細不明";
      await log("GMO_API", "ERROR", `GMO注文APIエラー: status=${orderResult.status} | ${errorDetail}`, {
        response: orderResult,
        messages: gmoMessages,
        request_body: { symbol, side: action, executionType: "MARKET", size: String(lotSize) },
      });
      throw new Error(`GMO order failed: status=${orderResult.status} (${errorDetail})`);
    }

    // GMO order response: { status: 0, data: [{ rootOrderId, orderId, ... }] }
    const entryRawData = orderResult.data;
    const entryDataArr = Array.isArray(entryRawData) ? entryRawData : entryRawData?.list || [];
    const entryOrderObj = entryDataArr[0] || {};
    const entryOrderId = entryOrderObj.orderId || entryOrderObj.rootOrderId || null;
    await log("GMO_API", "SUCCESS", `成行注文送信成功 (注文ID: ${entryOrderId || "取得中"})`, {
      order_data: entryRawData,
    });

    // ── Step 2: Wait then get position info ──
    await log("GMO_API", "INFO", "約定待機中 (1.5秒)...");
    await sleep(1500);

    let positionId: number | null = null;
    let entryPrice: number | null = null;
    const orderId: string | null = entryOrderId;

    await log("GMO_API", "INFO", `GMO建玉一覧API実行中: ${symbol}`, {
      api: "GET /v1/openPositions",
      symbol,
    });

    try {
      const positionsRes = await getOpenPositions(apiKey, apiSecret, symbol);
      const positions = (positionsRes.data?.list || []) as GmoPosition[];

      const matchingPositions = positions
        .filter((p) => p.side === action)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      if (matchingPositions.length > 0) {
        positionId = matchingPositions[0].positionId;
        entryPrice = parseFloat(matchingPositions[0].price);
        await log("GMO_API", "SUCCESS", `建玉取得成功: positionId=${positionId} 約定価格=${entryPrice}`, {
          position_id: positionId,
          entry_price: entryPrice,
          total_positions: positions.length,
        });
      } else {
        await log("GMO_API", "WARN", "約定建玉が見つかりません（遅延の可能性）");
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown";
      await log("GMO_API", "ERROR", `建玉取得失敗: ${errMsg}`, { error: errMsg });
    }

    // ── Step 3: Place stop-loss order ──
    let stopLossOrderId: string | null = null;

    if (positionId && entryPrice) {
      // Use Gemini AI stop_loss if available, fallback to fixed 50pips
      const aiStopLoss = analysis?.stop_loss ?? null;
      const fallbackStopPrice = calculateStopPrice(entryPrice, action as "BUY" | "SELL", symbol);
      const stopPrice = aiStopLoss && !isNaN(aiStopLoss) ? aiStopLoss : fallbackStopPrice;
      const stopSource = aiStopLoss && !isNaN(aiStopLoss) ? "AI分析" : "フォールバック(50pips)";
      const slPips = Math.abs(entryPrice - stopPrice) * (symbol.includes("JPY") ? 100 : 10000);

      await log("GMO_API", "INFO", `GMO逆指値注文API送信中: SL=${stopPrice} (${slPips.toFixed(1)}pips / ${stopSource})`, {
        api: "POST /v1/closeOrder",
        ai_stop_loss: aiStopLoss,
        fallback_stop_price: fallbackStopPrice,
        stop_source: stopSource,
      });

      try {
        await sleep(1100);
        const stopResult = await placeStopLossOrder(
          apiKey, apiSecret, symbol,
          action as "BUY" | "SELL", lotSize,
          positionId, stopPrice
        );

        if (stopResult.status === 0 && stopResult.data) {
          const slDataArr = Array.isArray(stopResult.data) ? stopResult.data : stopResult.data?.list || [];
          const slOrderObj = slDataArr[0] || {};
          stopLossOrderId = String(slOrderObj.orderId || slOrderObj.rootOrderId || "");
          await log("GMO_API", "SUCCESS", `逆指値設定完了: SL注文ID=${stopLossOrderId}`, {
            sl_order_id: stopLossOrderId,
            stop_price: stopPrice,
          });
        } else {
          const errMessages = stopResult.messages?.map(
            (m: { message_code: string; message_string: string }) => `[${m.message_code}] ${m.message_string}`
          ).join(", ") || "詳細なし";
          await log("GMO_API", "WARN", `逆指値設定失敗: status=${stopResult.status} | ${errMessages}`, {
            response: stopResult,
            messages: stopResult.messages,
          });
        }

        if (config.discord_webhook_url) {
          await sendDiscordMessage(
            String(config.discord_webhook_url),
            `🛡️ 損切逆指値設定: ${symbol} @ ${stopPrice} (${slPips.toFixed(1)}pips / ${stopSource})`
          );
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown";
        await log("GMO_API", "ERROR", `逆指値設定失敗: ${errMsg}`, { error: errMsg });
        if (config.discord_webhook_url) {
          await sendDiscordMessage(
            String(config.discord_webhook_url),
            `⚠️ 損切逆指値の設定に失敗しました。手動で設定してください。`
          );
        }
      }
    }

    // ── Step 4: Update bot state ──
    await supabase
      .from("bot_states")
      .update({
        position: action,
        entry_price: entryPrice,
        entry_at: new Date().toISOString(),
        position_id: positionId ? String(positionId) : null,
        stop_loss_order_id: stopLossOrderId,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (config.discord_webhook_url) {
      const embed = createExecutionEmbed("ORDER_PLACED", symbol, action, lotSize, entryPrice ? String(entryPrice) : undefined);
      await sendDiscordMessage(String(config.discord_webhook_url), "✅ 新規注文約定", embed);
    }

    return {
      type: "order",
      action,
      order_id: orderId,
      position_id: positionId,
      entry_price: entryPrice,
      stop_loss_order_id: stopLossOrderId,
      result: orderResult.data,
    };
  }

  if (action === "EXIT" && state?.position) {
    const side = String(state.position) as "BUY" | "SELL";

    // ── Step 1: Cancel pending stop-loss order ──
    if (state.stop_loss_order_id) {
      await log("GMO_API", "INFO", `GMO注文キャンセルAPI送信中: SL注文ID=${state.stop_loss_order_id}`, {
        api: "POST /v1/cancelOrder",
        order_id: state.stop_loss_order_id,
      });

      try {
        await cancelOrder(apiKey, apiSecret, String(state.stop_loss_order_id));
        await log("GMO_API", "SUCCESS", "逆指値注文キャンセル完了");
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown";
        await log("GMO_API", "WARN", `逆指値キャンセル失敗（既に約定済みの可能性）: ${errMsg}`);
      }
    }

    // ── Step 2: Close position ──
    await log("GMO_API", "INFO", `GMO決済注文API送信中: ${side} ${symbol.replace("_", "/")} ${lotSize.toLocaleString()}通貨`, {
      api: "POST /v1/closeOrder",
      side,
      symbol,
      lot_size: lotSize,
    });

    await sleep(1100);
    const result = await closeAllPositions(apiKey, apiSecret, symbol, side, lotSize);

    // GMO closeOrder response: { status: 0, data: [{ rootOrderId, orderId, ... }] }
    const closeRawData = result.data;
    const closeDataArr = Array.isArray(closeRawData) ? closeRawData : closeRawData?.list || [];
    const closeOrderObj = closeDataArr[0] || {};
    const closeOrderId = closeOrderObj.orderId || closeOrderObj.rootOrderId || null;
    await log("GMO_API", "SUCCESS", `決済注文送信成功${closeOrderId ? ` (orderId: ${closeOrderId})` : ""}`, {
      response_data: closeRawData,
    });

    // ── Step 3: Fetch execution info ──
    await log("GMO_API", "INFO", "約定情報取得中 (2秒待機)...", {
      api: closeOrderId ? "GET /v1/executions" : "GET /v1/latestExecutions",
    });

    let tradePnl = 0;
    let exitPrice = 0;
    try {
      await sleep(2000);
      const { fetchGmoExecutions } = await import("@/lib/gmo/executions");
      const recentTrades = await fetchGmoExecutions(apiKey, apiSecret,
        closeOrderId
          ? { orderId: String(closeOrderId) }
          : { symbol, count: 5 }
      );

      if (recentTrades.length > 0) {
        const latestTrade = recentTrades[0];
        tradePnl = latestTrade.pnl;
        exitPrice = latestTrade.exit_price;

        await log("GMO_API", "SUCCESS", `約定情報取得完了: 決済価格=${exitPrice} P&L=¥${tradePnl >= 0 ? "+" : ""}${tradePnl.toLocaleString()}`, {
          exit_price: exitPrice,
          pnl: tradePnl,
          trade_id: latestTrade.broker_trade_id,
        });

        // Use bot_state's entry_price if execution didn't have OPEN data
        const bestEntryPrice = latestTrade.entry_price !== latestTrade.exit_price
          ? latestTrade.entry_price
          : (Number(state?.entry_price) || latestTrade.entry_price);

        await supabase.from("trades").upsert(
          {
            user_id: userId,
            broker_trade_id: latestTrade.broker_trade_id,
            broker: "GMO",
            pair: latestTrade.pair,
            side: latestTrade.side,
            entry_price: bestEntryPrice,
            exit_price: latestTrade.exit_price,
            pnl: latestTrade.pnl,
            lot_size: latestTrade.lot_size,
            entry_at_utc: latestTrade.entry_at_utc,
            exit_at_utc: latestTrade.exit_at_utc,
            trade_type: "auto",
          },
          { onConflict: "broker_trade_id,broker" }
        );
      } else {
        await log("GMO_API", "WARN", "約定情報が取得できませんでした");
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown";
      await log("GMO_API", "ERROR", `約定情報取得失敗: ${errMsg}`, { error: errMsg });
    }

    // ── Step 4: Update bot state ──
    const consecutiveLosses = Number(state.consecutive_losses || 0);
    const dailyPnl = Number(state.daily_pnl || 0);

    await supabase
      .from("bot_states")
      .update({
        position: null,
        entry_price: null,
        entry_at: null,
        position_id: null,
        stop_loss_order_id: null,
        consecutive_losses: tradePnl < 0 ? consecutiveLosses + 1 : 0,
        daily_pnl: dailyPnl + tradePnl,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (config.discord_webhook_url) {
      const pnlStr = tradePnl >= 0 ? `+${tradePnl.toLocaleString()}` : tradePnl.toLocaleString();
      const embed = createExecutionEmbed("POSITION_CLOSED", symbol, side, lotSize, exitPrice ? String(exitPrice) : undefined);
      await sendDiscordMessage(
        String(config.discord_webhook_url),
        `🔄 ポジション決済 | P&L: ${pnlStr}円`,
        embed
      );
    }

    return {
      type: "close",
      side,
      pnl: tradePnl,
      exit_price: exitPrice,
      trade_type: "auto",
      result: result.data,
    };
  }

  return { type: "no_action", action };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Post error/system event to X using the user's configured prompt style.
 * Passes error message through {last_reason} so sarcasm engines (毒舌コンサル etc.)
 * can transform "接続エラー" / "APIエラー" into character-appropriate snark.
 * Fire-and-forget — never throws.
 */
/**
 * Sanitize raw error messages into prompt-friendly categories.
 * Strips error codes (ERR-XXXX), status numbers, and technical details.
 * Returns a human-readable category that matches the prompt's sarcasm rules:
 *   - "APIエラー" → triggers "社長、また余計な設定をいじりましたか？"
 *   - "接続エラー" → triggers "社長、電気代をケチりましたか？"
 */
function sanitizeErrorForPrompt(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("api-key") || lower.includes("permission") || lower.includes("auth") || lower.includes("認証")) {
    return "APIエラー: 認証に失敗しました。APIキーまたは権限の問題です。";
  }
  if (lower.includes("timeout") || lower.includes("connect") || lower.includes("fetch") || lower.includes("network") || lower.includes("接続")) {
    return "接続エラー: サーバーとの通信が途絶えました。";
  }
  if (lower.includes("取引時間外") || lower.includes("maintenance") || lower.includes("時間外")) {
    return "APIエラー: 取引時間外のため注文が拒否されました。";
  }
  if (lower.includes("余力") || lower.includes("margin") || lower.includes("insufficient")) {
    return "APIエラー: 証拠金が不足しています。";
  }
  if (lower.includes("注文") || lower.includes("order") || lower.includes("失敗")) {
    return "APIエラー: 注文処理でエラーが発生しました。";
  }
  if (lower.includes("gemini") || lower.includes("ai") || lower.includes("分析")) {
    return "APIエラー: AI分析処理でエラーが発生しました。";
  }
  return "APIエラー: システムで予期しないエラーが発生しました。";
}

async function notifyXError(
  config: Record<string, unknown>,
  errorMsg: string,
  resolvedGeminiKey?: string
): Promise<void> {
  try {
    if (
      !config.x_enabled ||
      !config.x_consumer_key ||
      !config.x_consumer_secret ||
      !config.x_access_token ||
      !config.x_access_token_secret
    ) return;

    const symbol = String(config.symbol || "USD_JPY");
    const geminiKey = resolvedGeminiKey || String(config.gemini_api_key || process.env.GEMINI_API_KEY || "");
    const userPrompt = config.x_tweet_prompt ? String(config.x_tweet_prompt) : "";

    // Only post if Gemini can generate the text — never post raw error messages
    if (!geminiKey || !userPrompt) return;

    // Sanitize: strip error codes, pass only a human-readable category
    const sanitized = sanitizeErrorForPrompt(errorMsg);

    const tweet = await generateTweetText(
      geminiKey,
      userPrompt,
      {
        action: "ERROR",
        symbol,
        confidence: 0,
        reason: sanitized,
      },
      "quick"
    );

    await postTradeToX(
      {
        consumerKey: String(config.x_consumer_key),
        consumerSecret: String(config.x_consumer_secret),
        accessToken: String(config.x_access_token),
        accessTokenSecret: String(config.x_access_token_secret),
      },
      tweet
    );
  } catch {
    // Silent — X notification failure should never block bot flow
  }
}
