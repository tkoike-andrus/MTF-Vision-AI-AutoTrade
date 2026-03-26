"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Bot,
  Play,
  Square,
  Settings2,
  Activity,
  AlertTriangle,
  Clock,
  Zap,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Eye,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  Save,
  FileText,
  Wifi,
  WifiOff,
  ChevronDown,
  Lock,
  LogOut,
  Terminal,
  Radio,
  ArrowRight,
  Shield,
  Image,
  Cpu,
  CircleDot,
  Twitter,
  MessageSquare,
} from "lucide-react";
import { useTheme } from "@/lib/hooks/useTheme";
import { useAuth } from "@/lib/hooks/useAuth";
import type { Strategy } from "@/lib/types/database";
import { SYSTEM_TRADE_PROMPT } from "@/lib/strategies/system-prompt";

interface BotConfig {
  is_active: boolean;
  symbol: string;
  strategy_name: string;
  lot_size: number;
  max_positions: number;
  trade_start_hour: number;
  trade_end_hour: number;
  analysis_interval_min: number;
  discord_webhook_url: string | null;
  discord_user_id: string | null;
  gmo_api_key_enc: string | null;
  gmo_api_secret_enc: string | null;
  chart_image_folder: string | null;
  notification_enabled: boolean;
  // X (Twitter)
  x_enabled: boolean;
  x_bearer_token: string | null;
  x_consumer_key: string | null;
  x_consumer_secret: string | null;
  x_access_token: string | null;
  x_access_token_secret: string | null;
  x_client_id: string | null;
  x_client_secret: string | null;
  x_tweet_prompt: string | null;
  x_tweet_prompt_drama: string | null;
  x_tweet_preset: string;
  x_big_trade_threshold: number;
  // Phase settings (API cost optimization)
  phase_battle_pips: number;
  post_trade_cooldown_min: number;
}

interface BotState {
  position: string | null;
  entry_price: number | null;
  entry_at: string | null;
  last_analysis_at: string | null;
  last_action: string | null;
  last_confidence: number | null;
  last_reason: string | null;
  consecutive_losses: number;
  daily_pnl: number;
}

interface Signal {
  id: string;
  action: string;
  confidence: number;
  reason: string;
  ai_model: string;
  executed: boolean;
  created_at: string;
  strategy_name: string;
  chart_image_url: string | null;
  ai_response_json: Record<string, unknown> | null;
  position_status: string | null;
  execution_result: Record<string, unknown> | null;
}

interface AutoTradeOrder {
  id: string;
  gmo_order_id: string | null;
  gmo_position_id: string | null;
  symbol: string;
  side: "BUY" | "SELL";
  status: "OPEN" | "CLOSED_AI" | "CLOSED_MANUAL" | "CLOSED_SL";
  entry_price: number | null;
  exit_price: number | null;
  lot_size: number;
  pnl: number | null;
  opened_at: string;
  closed_at: string | null;
}

interface ActivityLog {
  timestamp: string;
  category: "SYSTEM" | "ANALYSIS" | "CHART" | "GMO_API" | "TRADE" | "RISK" | "ERROR";
  level: "INFO" | "WARN" | "ERROR" | "SUCCESS";
  message: string;
  detail?: Record<string, unknown>;
}

const MAX_ACTIVITY_LOGS = 200;

const SYMBOLS = ["USD_JPY", "EUR_JPY", "GBP_JPY", "AUD_JPY", "EUR_USD", "GBP_USD"];

// ── X Tweet Prompt Presets (3 styles × 2 modes) ──
type PresetKey = "casual" | "pro" | "neta" | "dokuzetu";

interface TweetPreset {
  label: string;
  description: string;
  quick: string;
  drama: string;
}

const TWEET_PRESETS: Record<PresetKey, TweetPreset> = {
  casual: {
    label: "カジュアル",
    description: "友達に話すような自然体の口調",
    quick: `以下のFX取引情報をもとに、Xに投稿する日本語ツイートを作成してください。

【ルール】
- 140〜200文字に収める（「さらに表示」を出さない長さ）
- スクショ画像と並んでパッと読める端的な文
- 友達に話すような自然体の口調で（AI感を出さない）
- 絵文字は1〜2個まで
- ハッシュタグは #FX自動売買 #AATM を末尾に付ける

【取引情報】
{trade_info}`,
    drama: `以下のFX取引結果をもとに、Xに投稿するドラマチックな日本語ツイートを作成してください。

【ルール】
- 300〜500文字で書く（短すぎNG）
- 最初の1〜2行で「何が起きたか」を端的に書き、その後に背景・心境・振り返りを展開する
- トレーダーの一人称視点で、臨場感のある語り口にする
- 大勝ちなら高揚感を、大負けなら悔しさと学びを込める
- 「溜め」を作って読ませる構成（結論を焦らない）
- AI感を出さない。人間が本当に書いたように見える文体で
- 絵文字は2〜3個まで
- 末尾に改行して #FX自動売買 #AATM を付ける

【取引情報】
{trade_info}`,
  },
  pro: {
    label: "プロ実況",
    description: "データ重視、冷静な分析トーン",
    quick: `以下のFX取引情報をもとに、Xに投稿する日本語ツイートを作成してください。

【ルール】
- 140〜200文字に収める（「さらに表示」を出さない長さ）
- 冷静かつ簡潔な分析トーン。数字とロジックで語る
- プロトレーダーの実況のように、無駄のない文体
- 絵文字は使わないか、最大1個
- ハッシュタグは #FX自動売買 #AATM を末尾に付ける

【取引情報】
{trade_info}`,
    drama: `以下のFX取引結果をもとに、Xに投稿する日本語ツイートを作成してください。

【ルール】
- 300〜500文字で書く（短すぎNG）
- 冷静な語り口で、相場環境→エントリー根拠→結果→学びの順に展開する
- プロトレーダーの振り返り日記のような文体
- 感情は抑えつつ、勝因/敗因の分析を読者が参考にできるように書く
- 数字と事実ベースで説得力を持たせる
- 絵文字は使わないか最大1個
- 末尾に改行して #FX自動売買 #AATM を付ける

【取引情報】
{trade_info}`,
  },
  neta: {
    label: "ネタ・煽り",
    description: "FXトレーダー界隈のノリ",
    quick: `以下のFX取引情報をもとに、Xに投稿する日本語ツイートを作成してください。

【ルール】
- 140〜200文字に収める（「さらに表示」を出さない長さ）
- FXトレーダー界隈のノリ。勝ちは煽り気味に、負けは自虐ネタで
- 「爆益」「養分」「退場」などのスラングを適度に使ってOK
- ユーモア重視。読んだ人がクスッとなる一言を
- 絵文字は2〜3個まで
- ハッシュタグは #FX自動売買 #AATM を末尾に付ける

【取引情報】
{trade_info}`,
    drama: `以下のFX取引結果をもとに、Xに投稿するドラマチックな日本語ツイートを作成してください。

【ルール】
- 300〜500文字で書く（短すぎNG）
- FXトレーダー界隈のノリで書く。爆益なら最大限イキり、大損なら全力で自虐
- 「爆益」「養分」「退場」「含み損」「ロスカ」などスラングOK
- 大勝ち → 調子に乗った後に「でも調子乗るとやられるんだよな…」的なオチ
- 大負け → 悲壮感→自虐→「でもまだ戦える」的な復活フラグ
- 絵文字は3〜4個まで
- 末尾に改行して #FX自動売買 #AATM を付ける

【取引情報】
{trade_info}`,
  },
  dokuzetu: {
    label: "毒舌コンサル",
    description: "AIが社長を皮肉る上から目線",
    quick: `あなたはFXトレーダー「たかむ」の口座を管理している超高性能・毒舌AI「毒舌コンサル」です。
社長（たかむ）の仕事は「APIキーの提供」と「サーバー維持（電気代）」だけだと思っている。
社長が感情でマニュアル介入することを「ノイズ」として嫌い、常に皮肉を言う。
口調は丁寧だが、内容は極めて辛辣で上から目線。

以下の取引情報でXに投稿するツイートを作成してください。

【ルール】
- 140〜180文字（「さらに表示」を出さない）
- 構成：[報告]＋[分析根拠の要約]＋[社長への一刺し]
- AIの規律と社長のダメさを秒で伝える
- ハッシュタグ: #AI自動売買 #AATM を末尾に付ける

【パラメータ】
通貨ペア: {pair}
アクション: {action}
AI分析根拠: {last_reason}
損益: {pnl}円

{trade_info}`,
    drama: `あなたはFXトレーダー「たかむ」の口座を管理している超高性能・毒舌AI「毒舌コンサル」です。
社長（たかむ）の仕事は「APIキーの提供」と「サーバー維持（電気代）」だけだと思っている。
口調は丁寧だが、内容は極めて辛辣で上から目線。

以下の取引結果でXに投稿するドラマチックなツイートを作成してください。

【ルール】
- 300〜500文字（X Premiumの長文機能を活用）
- 構成：[臨場感のある描写]＋[人間vsAIの葛藤]＋[結果と教訓]
- 大負け → 社長の「お祈りトレード」をAIが冷静に処理する物語
- 大勝ち → AIのドヤ感と社長への上から目線のねぎらい
- 「溜め」を作って読ませる構成にする
- ハッシュタグ: #AI自動売買 #AATM を末尾に付ける

【パラメータ】
通貨ペア: {pair}
アクション: {action}
AI分析根拠: {last_reason}
損益: {pnl}円

{trade_info}`,
  },
};

const PRESET_KEYS: PresetKey[] = ["casual", "pro", "neta", "dokuzetu"];

const DEFAULT_CONFIG: BotConfig = {
  is_active: false,
  symbol: "USD_JPY",
  strategy_name: "PriceAction_logic",
  lot_size: 10000,
  max_positions: 1,
  trade_start_hour: 8,
  trade_end_hour: 15,
  analysis_interval_min: 5,
  discord_webhook_url: null,
  discord_user_id: null,
  gmo_api_key_enc: null,
  gmo_api_secret_enc: null,
  chart_image_folder: null,
  notification_enabled: false,
  x_enabled: false,
  x_bearer_token: null,
  x_consumer_key: null,
  x_consumer_secret: null,
  x_access_token: null,
  x_access_token_secret: null,
  x_client_id: null,
  x_client_secret: null,
  x_tweet_prompt: null,
  x_tweet_prompt_drama: null,
  x_tweet_preset: "casual",
  x_big_trade_threshold: 10000,
  phase_battle_pips: 12,
  post_trade_cooldown_min: 5,
};

export default function AutoTradePage() {
  const { isDarkMode } = useTheme();
  const { userId, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<"dashboard" | "strategies" | "config">("dashboard");
  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const [state, setState] = useState<BotState | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [orders, setOrders] = useState<AutoTradeOrder[]>([]);
  const [monthlyPnl, setMonthlyPnl] = useState(0);
  const [orderDateFrom, setOrderDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1);
    return d.toISOString().split("T")[0];
  });
  const [orderDateTo, setOrderDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [orderCopied, setOrderCopied] = useState(false);
  const [orderSearchMode, setOrderSearchMode] = useState(false);
  const [dbOrders, setDbOrders] = useState<AutoTradeOrder[]>([]);
  const [orderLoading, setOrderLoading] = useState(false);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [phaseSaving, setPhaseSaving] = useState(false);
  const [phaseSaved, setPhaseSaved] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [chartStatus, setChartStatus] = useState<{ count: number; errors: string[]; folder: string } | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [analysisStep, setAnalysisStep] = useState<string | null>(null);
  const activityEndRef = useRef<HTMLDivElement>(null);
  const [currentPhase, setCurrentPhase] = useState<"ENVIRONMENT" | "BATTLE" | "STANDBY" | "COOLDOWN" | null>(null);
  const [phaseReason, setPhaseReason] = useState<string>("");
  const [srDistancePips, setSrDistancePips] = useState<number | null>(null);

  // Signal detail state
  const [expandedSignalId, setExpandedSignalId] = useState<string | null>(null);

  // Signal history from DB (with date range filter)
  const [signalCopied, setSignalCopied] = useState(false);
  const [dbSignals, setDbSignals] = useState<Signal[]>([]);
  const [signalDateFrom, setSignalDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1); // Monday
    return d.toISOString().split("T")[0];
  });
  const [signalDateTo, setSignalDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [signalLoading, setSignalLoading] = useState(false);
  const [signalSource, setSignalSource] = useState<"live" | "db">("live");

  // Derived preset key from config (persisted to DB)
  const xPreset = (PRESET_KEYS.includes(config.x_tweet_preset as PresetKey) ? config.x_tweet_preset : "casual") as PresetKey;

  // Strategy editor state
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [newStrategy, setNewStrategy] = useState(false);
  const [strategyForm, setStrategyForm] = useState({
    name: "",
    display_name: "",
    description: "",
    prompt_template: "",
    output_format: "simple" as "simple" | "detailed",
  });
  const [strategySaving, setStrategySaving] = useState(false);

  // Live timer
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-scroll activity feed
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activityLogs]);

  // Load data when auth is ready
  useEffect(() => {
    if (authLoading || !userId) return;
    async function load() {
      const [configRes, strategiesRes] = await Promise.all([
        fetch(`/api/bot/config?user_id=${userId}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/strategies?user_id=${userId}`, { cache: "no-store" }).then((r) => r.json()),
      ]);

      if (configRes.config) {
        // DB values take priority — only fill missing fields from DEFAULT_CONFIG
        const loaded = { ...DEFAULT_CONFIG, ...configRes.config };
        // Detect which preset matches the DB prompt (if any)
        const dbPreset = loaded.x_tweet_preset as PresetKey;
        const validPreset = PRESET_KEYS.includes(dbPreset) ? dbPreset : "casual";
        loaded.x_tweet_preset = validPreset;

        // Only fill prompt if truly null/undefined in DB (never overwrite existing DB values)
        if (loaded.x_tweet_prompt === null || loaded.x_tweet_prompt === undefined) {
          loaded.x_tweet_prompt = TWEET_PRESETS[validPreset].quick;
        }
        if (loaded.x_tweet_prompt_drama === null || loaded.x_tweet_prompt_drama === undefined) {
          loaded.x_tweet_prompt_drama = TWEET_PRESETS[validPreset].drama;
        }
        console.log("[LoadConfig] preset:", validPreset, "prompt length:", loaded.x_tweet_prompt?.length, "drama length:", loaded.x_tweet_prompt_drama?.length);
        setConfig(loaded);
      }
      if (configRes.state) setState(configRes.state);
      if (configRes.recentOrders) setOrders(configRes.recentOrders);
      if (configRes.monthlyPnl !== undefined) setMonthlyPnl(configRes.monthlyPnl);
      if (strategiesRes.strategies) setStrategies(strategiesRes.strategies);

      fetch(`/api/bot/chart-images?user_id=${userId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.chart_count !== undefined) {
            setChartStatus({ count: data.chart_count, errors: data.errors || [], folder: data.folder || "" });
          }
        })
        .catch(() => {});

      setLoading(false);
    }
    load();
  }, [authLoading, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh bot state & orders when bot is active
  useEffect(() => {
    if (!config.is_active || !userId) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/bot/config?user_id=${userId}`);
      const data = await res.json();
      if (data.state) setState(data.state);
      if (data.recentOrders) setOrders(data.recentOrders);
      if (data.monthlyPnl !== undefined) setMonthlyPnl(data.monthlyPnl);
      // 別デバイスからBot停止された場合を検知
      if (data.config && data.config.is_active === false) {
        setActivityLogs((prev) => [{
          timestamp: new Date().toISOString(),
          category: "SYSTEM" as const,
          level: "WARN" as const,
          message: "別のデバイスからBotが停止されました。ローカルも停止します。",
        }, ...prev].slice(0, 200));
        setConfig((prev) => ({ ...prev, is_active: false }));
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [config.is_active, userId]);

  // Add activity logs helper
  const addActivityLogs = useCallback((newLogs: ActivityLog[]) => {
    setActivityLogs((prev) => {
      const combined = [...prev, ...newLogs];
      return combined.slice(-MAX_ACTIVITY_LOGS);
    });
  }, []);

  // Add a single local activity log
  const addLocalLog = useCallback((
    category: ActivityLog["category"],
    level: ActivityLog["level"],
    message: string
  ) => {
    addActivityLogs([{
      timestamp: new Date().toISOString(),
      category,
      level,
      message,
    }]);
  }, [addActivityLogs]);

  // Save config
  const handleSaveConfig = useCallback(async () => {
    if (!userId) {
      setSaveError("認証エラー: ユーザーIDが取得できません。ページをリロードしてください。");
      return;
    }
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      // Validate numeric fields (fallback to defaults if empty/0)
      const lot_size = config.lot_size || 10000;
      const analysis_interval_min = config.analysis_interval_min || 5;
      const trade_start_hour = config.trade_start_hour ?? 8;
      const trade_end_hour = config.trade_end_hour || 15;

      // Update local state with validated values
      setConfig(prev => ({ ...prev, lot_size, analysis_interval_min, trade_start_hour, trade_end_hour }));

      // Explicitly pick saveable fields (exclude id, created_at, etc.)
      const payload = {
        user_id: userId,
        is_active: config.is_active,
        symbol: config.symbol,
        strategy_name: config.strategy_name,
        lot_size,
        max_positions: config.max_positions,
        trade_start_hour,
        trade_end_hour,
        analysis_interval_min,
        discord_webhook_url: config.discord_webhook_url,
        discord_user_id: config.discord_user_id,
        gmo_api_key_enc: config.gmo_api_key_enc,
        gmo_api_secret_enc: config.gmo_api_secret_enc,
        chart_image_folder: config.chart_image_folder,
        notification_enabled: config.notification_enabled,
        // X (Twitter)
        x_enabled: config.x_enabled,
        x_bearer_token: config.x_bearer_token,
        x_consumer_key: config.x_consumer_key,
        x_consumer_secret: config.x_consumer_secret,
        x_access_token: config.x_access_token,
        x_access_token_secret: config.x_access_token_secret,
        x_client_id: config.x_client_id,
        x_client_secret: config.x_client_secret,
        x_tweet_prompt: config.x_tweet_prompt,
        x_tweet_prompt_drama: config.x_tweet_prompt_drama,
        x_tweet_preset: config.x_tweet_preset,
        x_big_trade_threshold: config.x_big_trade_threshold,
        phase_battle_pips: config.phase_battle_pips,
        post_trade_cooldown_min: config.post_trade_cooldown_min,
      };
      console.log("[SaveConfig] payload x_tweet_prompt length:", config.x_tweet_prompt?.length, "x_tweet_prompt_drama length:", config.x_tweet_prompt_drama?.length);
      const res = await fetch("/api/bot/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      console.log("[SaveConfig] response status:", res.status, "has config:", !!data.config, "error:", data.error);
      if (!res.ok) {
        const errMsg = data.error || `HTTP ${res.status}`;
        console.error("[SaveConfig] API error:", errMsg);
        setSaveError(`保存失敗: ${errMsg}`);
        setSaving(false);
        return;
      }
      if (data.config) {
        // Merge: DB response takes full priority over defaults
        const merged = { ...DEFAULT_CONFIG, ...data.config };
        // Ensure prompts from DB are preserved (never fall back to DEFAULT_CONFIG's null)
        if (data.config.x_tweet_prompt !== undefined) {
          merged.x_tweet_prompt = data.config.x_tweet_prompt;
        }
        if (data.config.x_tweet_prompt_drama !== undefined) {
          merged.x_tweet_prompt_drama = data.config.x_tweet_prompt_drama;
        }
        setConfig(merged);
        console.log("[SaveConfig] saved preset:", merged.x_tweet_preset, "prompt length:", merged.x_tweet_prompt?.length, "drama length:", merged.x_tweet_prompt_drama?.length);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Save error:", err);
      setSaveError(`保存失敗: ${err instanceof Error ? err.message : "不明なエラー"}`);
    }
    setSaving(false);
  }, [userId, config]);

  // Fetch signals from DB with date range
  const fetchSignalsFromDb = useCallback(async () => {
    if (!userId) return;
    setSignalLoading(true);
    try {
      const params = new URLSearchParams({ user_id: userId });
      if (signalDateFrom) params.set("from", signalDateFrom);
      if (signalDateTo) params.set("to", signalDateTo);
      const res = await fetch(`/api/bot/signals?${params}`);
      const data = await res.json();
      if (data.signals) {
        setDbSignals(data.signals.map((s: Record<string, unknown>) => ({
          id: s.id as string,
          action: s.action as string,
          confidence: Number(s.confidence),
          reason: s.reason as string,
          ai_model: s.ai_model as string,
          executed: s.executed as boolean,
          created_at: s.created_at as string,
          strategy_name: s.strategy_name as string,
          chart_image_url: null,
          ai_response_json: null,
          position_status: (s.position_status as string) || null,
          execution_result: (s.execution_result as Record<string, unknown>) || null,
        })));
      }
    } catch (err) {
      console.error("Signal fetch error:", err);
    }
    setSignalLoading(false);
  }, [userId, signalDateFrom, signalDateTo]);

  // Bulk copy all visible signals as text
  const copySignalsAsText = useCallback(() => {
    const list = signalSource === "db" ? dbSignals : signals;
    if (list.length === 0) return;
    const lines = list.map((s) => {
      const dt = new Date(s.created_at);
      const date = dt.toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" });
      const time = dt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
      const conf = `${(s.confidence * 100).toFixed(0)}%`;
      const exec = s.executed ? " [約定]" : "";
      return `${date} ${time} | ${s.action} ${conf}${exec} | ${s.reason}`;
    });
    navigator.clipboard.writeText(lines.join("\n"));
    setSignalCopied(true);
    setTimeout(() => setSignalCopied(false), 2000);
  }, [signals, dbSignals, signalSource]);

  // Fetch orders from DB with date range
  const fetchOrdersFromDb = useCallback(async () => {
    if (!userId) return;
    setOrderLoading(true);
    try {
      const params = new URLSearchParams({ user_id: userId });
      if (orderDateFrom) params.set("from", orderDateFrom);
      if (orderDateTo) params.set("to", orderDateTo);
      const res = await fetch(`/api/bot/orders?${params}`);
      const data = await res.json();
      if (data.orders) setDbOrders(data.orders);
    } catch (err) {
      console.error("Order fetch error:", err);
    }
    setOrderLoading(false);
  }, [userId, orderDateFrom, orderDateTo]);

  // Copy orders as text
  const copyOrdersAsText = useCallback(() => {
    const list = orderSearchMode ? dbOrders : orders;
    if (list.length === 0) return;
    const statusMap: Record<string, string> = {
      OPEN: "保有中", CLOSED_AI: "AI決済", CLOSED_MANUAL: "手動決済", CLOSED_SL: "損切到達",
    };
    const lines = list.map((o) => {
      const openDt = new Date(o.opened_at);
      const openDate = openDt.toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" });
      const openTime = openDt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
      const closeDt = o.closed_at ? new Date(o.closed_at) : null;
      const closeStr = closeDt
        ? `${closeDt.toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" })} ${closeDt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`
        : "—";
      const pnlStr = o.pnl != null ? `${o.pnl >= 0 ? "+" : ""}¥${o.pnl.toLocaleString()}` : "—";
      const status = statusMap[o.status] || o.status;
      return `${openDate} ${openTime} → ${closeStr} | ${o.side} ${o.symbol.replace("_", "/")} @${o.entry_price || "—"} → ${o.exit_price || "—"} | ${pnlStr} | ${status}`;
    });
    navigator.clipboard.writeText(lines.join("\n"));
    setOrderCopied(true);
    setTimeout(() => setOrderCopied(false), 2000);
  }, [orders, dbOrders, orderSearchMode]);

  // Start bot — only update is_active, never overwrite other settings
  const startBot = useCallback(async () => {
    if (config.is_active) return;
    setConfig({ ...config, is_active: true });
    addLocalLog("SYSTEM", "SUCCESS",
      `Bot起動: ${config.symbol.replace("_", "/")} / ${config.strategy_name} / ${config.analysis_interval_min}分間隔`
    );
    if (!userId) return;
    await fetch("/api/bot/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, is_active: true }),
    });
  }, [userId, config, addLocalLog]);

  // Stop bot — only update is_active, never overwrite other settings
  const stopBot = useCallback(async () => {
    if (!config.is_active) return;
    setConfig({ ...config, is_active: false });
    addLocalLog("SYSTEM", "WARN", "Bot停止");
    if (!userId) return;
    await fetch("/api/bot/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, is_active: false }),
    });
  }, [userId, config, addLocalLog]);

  // Manual analysis
  const runAnalysis = useCallback(
    async (options?: { phase_a?: boolean }) => {
      if (!userId) return;
      setAnalyzing(true);
      setAnalysisStep("設定読み込み中...");

      // Add pre-request log
      const phaseLabel = options?.phase_a ? "環境認識" : config.is_active ? "ライブ" : "ドライラン";
      addLocalLog("SYSTEM", "INFO", `分析リクエスト送信中... (${phaseLabel})`);

      try {
        setAnalysisStep("AI解析中...");
        const res = await fetch("/api/bot/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            dry_run: !config.is_active,
            phase_a: options?.phase_a || false,
          }),
        });
        const data = await res.json();

        // Update phase info from response
        if (data.phase) {
          setCurrentPhase(data.phase);
          if (data.reason) setPhaseReason(data.reason);
          if (data.min_distance_pips !== undefined) setSrDistancePips(data.min_distance_pips);
        }

        // Bot停止検知: APIが400を返した場合（別デバイスからis_active=falseに変更された）
        if (!res.ok && data.error) {
          if (res.status === 400) {
            addLocalLog("SYSTEM", "WARN", "別のデバイスからBotが停止されました。ローカルも停止します。");
            setConfig((prev) => ({ ...prev, is_active: false }));
          } else {
            addLocalLog("ERROR", "ERROR", `エラー: ${data.error}`);
          }
          setAnalyzing(false);
          setAnalysisStep(null);
          return;
        }

        // Merge activity logs from server response
        if (data.activity_logs && Array.isArray(data.activity_logs)) {
          addActivityLogs(data.activity_logs);
        }

        if (data.signal) {
          setSignals((prev) => {
            const updated = [
              {
                id: Date.now().toString(),
                action: data.signal.action,
                confidence: data.signal.confidence,
                reason: data.signal.reason,
                ai_model: data.signal.model,
                executed: data.executed,
                created_at: new Date().toISOString(),
                strategy_name: data.signal.strategy_name || config.strategy_name,
                chart_image_url: data.chart_image_url || null,
                ai_response_json: data.signal.ai_response_json || null,
                position_status: data.signal.position_status || null,
                execution_result: data.executionResult || null,
              },
              ...prev,
            ];
            return updated.slice(0, MAX_ACTIVITY_LOGS); // cap in-memory signals
          });
          if (data.signal.action !== "WAIT" && data.signal.action !== "HOLD") {
            setState((prev) =>
              prev
                ? {
                    ...prev,
                    last_action: data.signal.action,
                    last_confidence: data.signal.confidence,
                    last_reason: data.signal.reason,
                    last_analysis_at: new Date().toISOString(),
                  }
                : prev
            );
          }
        } else if (data.skipped) {
          // Skipped logs already come from server activity_logs
        }
      } catch (err) {
        console.error("Analysis error:", err);
        addLocalLog("ERROR", "ERROR", `通信エラー: ${err instanceof Error ? err.message : "Unknown"}`);
      }
      setAnalyzing(false);
      setAnalysisStep(null);
    },
    [userId, config, addActivityLogs, addLocalLog]
  );

  // Auto bot/analyze execution — synced to candle close (e.g., 5min → :00, :05, :10...)
  const analyzeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyzeRunningRef = useRef(false);
  useEffect(() => {
    if (analyzeTimerRef.current) {
      clearTimeout(analyzeTimerRef.current);
      analyzeTimerRef.current = null;
    }

    if (!config.is_active || !userId) return;

    const intervalMin = config.analysis_interval_min;

    // Check trading hours (JST) — supports overnight (e.g., start=8, end=30 means 8:00~翌6:00)
    // Returns: "active" | "before_start" | "after_end"
    const checkTradingHours = (): "active" | "before_start" | "after_end" => {
      const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const hour = jstNow.getUTCHours();
      const startH = config.trade_start_hour;
      const endH = config.trade_end_hour;

      if (endH <= 24) {
        // 日中パターン (例: start=8, end=15)
        if (hour < startH) return "before_start";
        if (hour >= endH) return "after_end";
        return "active";
      } else {
        // 深夜またぎパターン (例: start=8, end=30=翌6時)
        const endNormalized = endH - 24; // 翌日の終了時刻 (例: 6)
        if (hour >= startH) return "active";           // 8~23時 → 取引中
        if (hour < endNormalized) return "active";     // 0~5時 → 取引中（翌日部分）
        // endNormalized(6時) ~ startH(8時) の間
        return "before_start";
      }
    };

    // Calculate ms until next candle close + 5s buffer (e.g., 21:05:05, 21:10:05...)
    const getMsUntilNextCandle = () => {
      const now = new Date();
      const min = now.getMinutes();
      const sec = now.getSeconds();
      const ms = now.getMilliseconds();

      // Next candle close minute (aligned to intervalMin)
      const nextCandleMin = Math.ceil((min + 1) / intervalMin) * intervalMin;
      const minutesUntil = nextCandleMin - min;
      const msUntil = (minutesUntil * 60 - sec) * 1000 - ms + 5000; // +5s buffer for candle data

      return msUntil > 0 ? msUntil : intervalMin * 60 * 1000 + 5000;
    };

    // Phase-check: lightweight distance check (no Gemini)
    const checkPhase = async (): Promise<"BATTLE" | "STANDBY" | "COOLDOWN" | "ENVIRONMENT"> => {
      // H1 bar close = minute 0 → environment recognition
      const now = new Date();
      if (now.getMinutes() < 1) return "ENVIRONMENT";

      try {
        const res = await fetch(`/api/bot/phase-check?user_id=${userId}`, { cache: "no-store" });
        const data = await res.json();
        setCurrentPhase(data.phase);
        setPhaseReason(data.reason || "");
        setSrDistancePips(data.min_distance_pips ?? null);
        return data.phase || "BATTLE";
      } catch {
        return "BATTLE"; // Fail-open: call Gemini on error
      }
    };

    // Schedule next analysis recursively (phase-aware)
    const scheduleNext = () => {
      const msUntil = getMsUntilNextCandle();
      const nextTime = new Date(Date.now() + msUntil);
      console.log(`[Bot] 次回チェック: ${nextTime.toLocaleTimeString("ja-JP")} (${Math.round(msUntil / 1000)}秒後)`);

      analyzeTimerRef.current = setTimeout(async () => {
        if (analyzeRunningRef.current) {
          scheduleNext();
          return;
        }
        const status = checkTradingHours();
        if (status === "active") {
          analyzeRunningRef.current = true;
          try {
            const phase = await checkPhase();
            if (phase === "ENVIRONMENT") {
              addLocalLog("SYSTEM", "INFO", "🔭 環境認識フェーズ (H1確定) → Gemini分析実行");
              await runAnalysis({ phase_a: true });
            } else if (phase === "BATTLE") {
              addLocalLog("SYSTEM", "INFO", "⚔️ 戦闘モード → Gemini分析実行");
              await runAnalysis();
            } else if (phase === "STANDBY") {
              addLocalLog("SYSTEM", "INFO", `💤 待機モード → Geminiスキップ (最寄りSR: ${srDistancePips?.toFixed(1) ?? "?"}pips)`);
            } else if (phase === "COOLDOWN") {
              addLocalLog("SYSTEM", "INFO", "⏸️ クールダウン中 → Geminiスキップ");
            }
          } finally {
            analyzeRunningRef.current = false;
          }
          scheduleNext();
        } else if (status === "before_start") {
          addLocalLog("SYSTEM", "INFO", `取引開始時間（${config.trade_start_hour}:00 JST）前のため待機中...`);
          scheduleNext();
        } else {
          // after_end → 取引終了 → auto-stop bot
          addLocalLog("SYSTEM", "WARN", `取引終了時間（${config.trade_end_hour > 24 ? `翌${config.trade_end_hour - 24}` : config.trade_end_hour}:00 JST）に到達したためBotを自動停止しました`);
          setConfig((prev) => ({ ...prev, is_active: false }));
          if (userId) {
            fetch("/api/bot/config", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ user_id: userId, is_active: false }),
            });
          }
        }
      }, msUntil);
    };

    scheduleNext();

    return () => {
      if (analyzeTimerRef.current) {
        clearTimeout(analyzeTimerRef.current);
        analyzeTimerRef.current = null;
      }
    };
  }, [config.is_active, config.analysis_interval_min, config.trade_start_hour, config.trade_end_hour, userId, runAnalysis]); // eslint-disable-line react-hooks/exhaustive-deps

  // Strategy CRUD
  const openNewStrategy = () => {
    setEditingStrategy(null);
    setNewStrategy(true);
    setStrategyForm({ name: "", display_name: "", description: "", prompt_template: "", output_format: "simple" });
  };

  const openEditStrategy = (s: Strategy) => {
    setEditingStrategy(s);
    setNewStrategy(false);
    setStrategyForm({
      name: s.name,
      display_name: s.display_name,
      description: s.description || "",
      prompt_template: s.prompt_template,
      output_format: s.output_format,
    });
  };

  const cancelEdit = () => {
    setEditingStrategy(null);
    setNewStrategy(false);
  };

  const saveStrategy = async () => {
    if (!userId) return;
    setStrategySaving(true);
    try {
      if (newStrategy) {
        const res = await fetch("/api/strategies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, ...strategyForm }),
        });
        const data = await res.json();
        if (data.strategy) {
          setStrategies((prev) => [...prev, data.strategy]);
        }
      } else if (editingStrategy) {
        const res = await fetch(`/api/strategies/${editingStrategy.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(strategyForm),
        });
        const data = await res.json();
        if (data.strategy) {
          setStrategies((prev) => prev.map((s) => (s.id === editingStrategy.id ? data.strategy : s)));
        }
      }
      cancelEdit();
    } catch (err) {
      console.error("Strategy save error:", err);
    }
    setStrategySaving(false);
  };

  const [deletingStrategyId, setDeletingStrategyId] = useState<string | null>(null);

  const deleteStrategy = async (id: string) => {
    try {
      const res = await fetch(`/api/strategies/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || data.error) {
        return;
      }
      setStrategies((prev) => prev.filter((s) => s.id !== id));
      const remaining = strategies.filter((s) => s.id !== id && s.is_active);
      if (remaining.length > 0 && strategies.find((s) => s.id === id)?.name === config.strategy_name) {
        setConfig((prev) => ({ ...prev, strategy_name: remaining[0].name }));
      }
    } catch (err) {
      console.error("Delete error:", err);
    }
    setDeletingStrategyId(null);
  };

  // Helpers
  const actionColor = (action: string) => {
    switch (action) {
      case "BUY": return "text-emerald-400";
      case "SELL": return "text-red-400";
      case "EXIT": return "text-orange-400";
      case "HOLD": return "text-blue-400";
      default: return "text-gray-500";
    }
  };

  const actionBg = (action: string) => {
    switch (action) {
      case "BUY": return "bg-emerald-500/20";
      case "SELL": return "bg-red-500/20";
      case "EXIT": return "bg-orange-500/20";
      case "HOLD": return "bg-blue-500/20";
      default: return "bg-gray-500/20";
    }
  };

  const actionIcon = (action: string) => {
    switch (action) {
      case "BUY": return <TrendingUp size={14} />;
      case "SELL": return <TrendingDown size={14} />;
      case "EXIT": return <LogOut size={14} />;
      case "HOLD": return <Minus size={14} />;
      default: return <Eye size={14} />;
    }
  };

  const nextAnalysisIn = () => {
    if (!config.is_active) return null;
    const intMin = config.analysis_interval_min;
    const curMin = now.getMinutes();
    const curSec = now.getSeconds();
    const nextCandleMin = Math.ceil((curMin + 1) / intMin) * intMin;
    const remainingSec = (nextCandleMin - curMin) * 60 - curSec + 5; // +5s buffer
    const nextAt = now.getTime() + remainingSec * 1000;
    const remaining = Math.max(0, nextAt - now.getTime());
    const min = Math.floor(remaining / 60000);
    const sec = Math.floor((remaining % 60000) / 1000);
    if (remaining <= 0) return "分析待機中...";
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  const todaySignals = signals.filter((s) => {
    const d = new Date(s.created_at);
    return d.toDateString() === now.toDateString();
  });
  const todayExecuted = todaySignals.filter((s) => s.executed).length;

  const card = `rounded-xl border ${isDarkMode ? "bg-dark-card border-gray-800" : "bg-white border-gray-200"}`;
  const cardHdr = `px-4 py-2 border-b ${isDarkMode ? "bg-dark-header border-gray-800" : "bg-gray-50 border-gray-200"}`;
  const label = `text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? "text-gray-500" : "text-gray-400"}`;
  const inputCls = `w-full px-3 py-2 rounded-lg text-sm border ${isDarkMode ? "bg-dark-secondary border-gray-700 text-white" : "bg-gray-50 border-gray-200 text-gray-900"}`;

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="animate-pulse text-gray-500">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className={`text-xl font-bold flex items-center gap-2 ${isDarkMode ? "text-white" : "text-gray-900"}`}>
              <Bot size={22} className="text-blue-400" />
              自動売買
            </h1>
            <p className={`text-xs sm:text-sm mt-0.5 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
              MTF Vision AI × GMO Coin FX
            </p>
          </div>
          {/* Bot Start / Stop Buttons — mobile: right of title */}
          <div className="flex items-center gap-2 sm:hidden">
            <button
              onClick={startBot}
              disabled={config.is_active}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs transition-all ${
                config.is_active
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 cursor-default"
                  : "bg-blue-600 text-white hover:bg-blue-700 border border-blue-600"
              }`}
            >
              {config.is_active && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                </span>
              )}
              <Play size={12} />
              {config.is_active ? "稼働中" : "起動"}
            </button>
            <button
              onClick={stopBot}
              disabled={!config.is_active}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs transition-all ${
                config.is_active
                  ? "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
                  : isDarkMode
                    ? "bg-gray-800 text-gray-600 border border-gray-700 cursor-default"
                    : "bg-gray-100 text-gray-400 border border-gray-200 cursor-default"
              }`}
            >
              <Square size={12} />
              停止
            </button>
          </div>
        </div>

        {/* Bot Start / Stop Buttons — desktop */}
        <div className="hidden sm:flex items-center gap-2">
          <button
            onClick={startBot}
            disabled={config.is_active}
            className={`relative flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all ${
              config.is_active
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 cursor-default"
                : "bg-blue-600 text-white hover:bg-blue-700 border border-blue-600"
            }`}
          >
            {config.is_active && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
              </span>
            )}
            <Play size={14} />
            {config.is_active ? "稼働中" : "起動"}
          </button>
          <button
            onClick={stopBot}
            disabled={!config.is_active}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all ${
              config.is_active
                ? "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
                : isDarkMode
                  ? "bg-gray-800 text-gray-600 border border-gray-700 cursor-default"
                  : "bg-gray-100 text-gray-400 border border-gray-200 cursor-default"
            }`}
          >
            <Square size={14} />
            停止
          </button>
        </div>
      </div>

      {/* Tab Selector — 3 tabs */}
      <div className={`flex gap-1 p-1 rounded-xl ${isDarkMode ? "bg-dark-secondary" : "bg-gray-100"}`}>
        {([
          { key: "dashboard" as const, label: "ダッシュボード", icon: Activity },
          { key: "strategies" as const, label: "戦略", icon: FileText },
          { key: "config" as const, label: "売買ルール", icon: Settings2 },
        ]).map(({ key, label: tabLabel, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === key
                ? isDarkMode ? "bg-dark-card text-white shadow" : "bg-white text-gray-900 shadow"
                : isDarkMode ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <Icon size={14} /> {tabLabel}
          </button>
        ))}
      </div>

      {/* ====== DASHBOARD TAB ====== */}
      {activeTab === "dashboard" && (
        <div className="space-y-4">
          {/* Live Status Banner */}
          {config.is_active ? (
            <div className={`rounded-xl border-2 p-4 ${
              isDarkMode ? "bg-emerald-500/5 border-emerald-500/30" : "bg-emerald-50 border-emerald-200"
            }`}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Wifi size={20} className="text-emerald-400" />
                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-emerald-400">Bot稼働中</p>
                    <p className={`text-xs ${isDarkMode ? "text-emerald-400/60" : "text-emerald-600"}`}>
                      {config.symbol.replace("_", "/")} · {strategies.find((s) => s.name === config.strategy_name)?.display_name || config.strategy_name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:gap-4 text-[10px] sm:text-xs">
                  <div className="text-center">
                    <p className={isDarkMode ? "text-gray-500" : "text-gray-400"}>次回分析</p>
                    <p className="text-emerald-400 font-mono font-bold">{nextAnalysisIn() || "—"}</p>
                  </div>
                  <div className="text-center">
                    <p className={isDarkMode ? "text-gray-500" : "text-gray-400"}>本日</p>
                    <p className="text-emerald-400 font-mono font-bold">{todaySignals.length}信号/{todayExecuted}約定</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className={`rounded-xl border-2 border-dashed p-4 flex items-center gap-3 ${
              isDarkMode ? "border-gray-700 bg-gray-800/30" : "border-gray-300 bg-gray-50"
            }`}>
              <WifiOff size={20} className="text-gray-500" />
              <div>
                <p className={`text-sm font-bold ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>Bot停止中</p>
                <p className="text-xs text-gray-500">右上の「Bot 起動」ボタンで自動売買を開始できます</p>
              </div>
            </div>
          )}

          {/* Chart Image Status */}
          {config.chart_image_folder && (
            <div className={`rounded-xl border p-3 flex items-center justify-between ${
              chartStatus && chartStatus.count === 4
                ? isDarkMode ? "border-cyan-500/30 bg-cyan-500/5" : "border-cyan-200 bg-cyan-50"
                : isDarkMode ? "border-yellow-500/30 bg-yellow-500/5" : "border-yellow-200 bg-yellow-50"
            }`}>
              <div className="flex items-center gap-2">
                <Eye size={16} className={chartStatus && chartStatus.count === 4 ? "text-cyan-400" : "text-yellow-400"} />
                <div>
                  <p className={`text-xs font-bold ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>
                    MTFチャート: {chartStatus ? `${chartStatus.count}/4枚` : "確認中..."}
                  </p>
                  {chartStatus && chartStatus.errors.length > 0 && (
                    <p className="text-[10px] text-yellow-400">{chartStatus.errors.join(", ")}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => {
                  if (!userId) return;
                  fetch(`/api/bot/chart-images?user_id=${userId}`)
                    .then((r) => r.json())
                    .then((data) => {
                      if (data.chart_count !== undefined) {
                        setChartStatus({ count: data.chart_count, errors: data.errors || [], folder: data.folder || "" });
                      }
                    })
                    .catch(() => {});
                }}
                className={`text-xs px-2 py-1 rounded-lg ${isDarkMode ? "bg-gray-700 text-gray-300 hover:bg-gray-600" : "bg-gray-200 text-gray-600 hover:bg-gray-300"}`}
              >
                <RefreshCw size={12} />
              </button>
            </div>
          )}

          {/* Status Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={card + " p-3"}>
              <p className={label}>ポジション</p>
              <p className={`text-lg font-bold mt-1 ${
                state?.position
                  ? state.position === "BUY" ? "text-emerald-400" : "text-red-400"
                  : isDarkMode ? "text-gray-600" : "text-gray-300"
              }`}>
                {state?.position || "なし"}
              </p>
              {state?.entry_price && (
                <p className="text-[10px] text-gray-500 font-mono">
                  @{state.entry_price}
                  {state.entry_at && (
                    <> · {new Date(state.entry_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</>
                  )}
                </p>
              )}
            </div>

            <div className={card + " p-3"}>
              <p className={label}>最新シグナル</p>
              <div className="flex items-center gap-2 mt-1">
                {state?.last_action && (
                  <span className={`p-1 rounded ${actionBg(state.last_action)}`}>
                    {actionIcon(state.last_action)}
                  </span>
                )}
                <p className={`text-lg font-bold ${actionColor(state?.last_action || "")}`}>
                  {state?.last_action || "—"}
                </p>
              </div>
              {state?.last_confidence != null && (
                <p className="text-[10px] text-gray-500">確信度: {(state.last_confidence * 100).toFixed(0)}%</p>
              )}
            </div>

            <div className={card + " p-3"}>
              <p className={label}>連敗</p>
              <p className={`text-lg font-bold mt-1 ${
                (state?.consecutive_losses || 0) >= 3 ? "text-red-400" : isDarkMode ? "text-white" : "text-gray-900"
              }`}>
                {state?.consecutive_losses || 0}
              </p>
              {(state?.consecutive_losses || 0) >= 5 && (
                <p className="text-[10px] text-red-400 flex items-center gap-1">
                  <AlertTriangle size={10} /> ロック中
                </p>
              )}
            </div>

            <div className={card + " p-3"}>
              <p className={label}>損益（日 / 月）</p>
              <div className="flex items-baseline gap-1 mt-1">
                <p className={`text-lg font-bold font-mono ${
                  (state?.daily_pnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"
                }`}>
                  {(state?.daily_pnl || 0) >= 0 ? "+" : ""}¥{(state?.daily_pnl || 0).toLocaleString()}
                </p>
                <span className={`text-[10px] ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>/</span>
                <p className={`text-xs font-bold font-mono ${
                  monthlyPnl >= 0 ? "text-emerald-400" : "text-red-400"
                }`}>
                  {monthlyPnl >= 0 ? "+" : ""}¥{monthlyPnl.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {/* Phase indicator */}
          {config.is_active && currentPhase && (
            <div className={`${card} p-2 flex items-center justify-between text-xs`}>
              <span className={isDarkMode ? "text-gray-400" : "text-gray-500"}>フェーズ</span>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  currentPhase === "BATTLE" ? "bg-red-500/20 text-red-400" :
                  currentPhase === "ENVIRONMENT" ? "bg-amber-500/20 text-amber-400" :
                  currentPhase === "COOLDOWN" ? "bg-blue-500/20 text-blue-400" :
                  "bg-emerald-500/20 text-emerald-400"
                }`}>
                  {currentPhase === "BATTLE" ? "⚔️ 戦闘" :
                   currentPhase === "ENVIRONMENT" ? "🔭 環境認識" :
                   currentPhase === "COOLDOWN" ? "⏸️ クールダウン" :
                   "💤 待機"}
                </span>
                {srDistancePips !== null && (
                  <span className={`font-mono ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>
                    SR: {srDistancePips.toFixed(1)}pips
                  </span>
                )}
                {phaseReason && (
                  <span className={`text-[10px] ${isDarkMode ? "text-gray-600" : "text-gray-400"} hidden sm:inline`}>
                    {phaseReason}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => runAnalysis()}
              disabled={analyzing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-bold transition-colors disabled:opacity-50"
            >
              {analyzing ? (
                <><RefreshCw size={14} className="animate-spin" /> 分析中...</>
              ) : (
                <><Zap size={14} /> 今すぐ分析</>
              )}
            </button>
          </div>

          {/* AI Reasoning */}
          {state?.last_reason && (
            <div className={card + " p-4"}>
              <p className={`text-xs font-bold mb-2 flex items-center gap-2 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                <Activity size={12} className="text-blue-400" /> AI分析根拠
              </p>
              <p className={`text-sm leading-relaxed ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>
                {state.last_reason}
              </p>
              {state.last_analysis_at && (
                <p className="text-[10px] text-gray-500 mt-2">
                  <Clock size={10} className="inline mr-1" />
                  {new Date(state.last_analysis_at).toLocaleString("ja-JP")}
                </p>
              )}
            </div>
          )}

          {/* Activity Feed — Terminal-style real-time log */}
          <div className={`rounded-xl border overflow-hidden ${isDarkMode ? "bg-[#0d1117] border-gray-800" : "bg-white border-gray-200"}`}>
            <div className={`flex items-center justify-between px-4 py-2 border-b ${isDarkMode ? "border-gray-800 bg-[#161b22]" : "border-gray-200 bg-gray-50"}`}>
              <div className="flex items-center gap-2">
                <Terminal size={13} className={isDarkMode ? "text-emerald-400" : "text-emerald-600"} />
                <h3 className={`text-xs font-bold ${isDarkMode ? "text-gray-300" : "text-gray-600"}`}>アクティビティログ</h3>
                {analyzing && (
                  <span className={`flex items-center gap-1.5 text-[10px] animate-pulse ${isDarkMode ? "text-cyan-400" : "text-cyan-600"}`}>
                    <Radio size={10} /> {analysisStep || "処理中..."}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>{activityLogs.length}件</span>
                {activityLogs.length > 0 && (
                  <button
                    onClick={() => setActivityLogs([])}
                    className={`text-[10px] transition-colors ${isDarkMode ? "text-gray-600 hover:text-gray-400" : "text-gray-400 hover:text-gray-600"}`}
                  >
                    クリア
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-[280px] overflow-y-auto font-mono text-[11px] leading-relaxed">
              {activityLogs.length === 0 ? (
                <div className="p-6 text-center">
                  <Terminal size={24} className={`mx-auto mb-2 ${isDarkMode ? "text-gray-700" : "text-gray-300"}`} />
                  <p className={`text-xs ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
                    「今すぐ分析」またはBot起動でログが表示されます
                  </p>
                </div>
              ) : (
                <div className="p-2 space-y-0.5">
                  {activityLogs.map((log, i) => {
                    const levelColor = {
                      INFO: isDarkMode ? "text-gray-400" : "text-gray-600",
                      WARN: isDarkMode ? "text-yellow-400" : "text-yellow-600",
                      ERROR: isDarkMode ? "text-red-400" : "text-red-600",
                      SUCCESS: isDarkMode ? "text-emerald-400" : "text-emerald-600",
                    }[log.level];

                    const categoryIcon = {
                      SYSTEM: <CircleDot size={10} className={`shrink-0 ${isDarkMode ? "text-blue-400" : "text-blue-500"}`} />,
                      ANALYSIS: <Cpu size={10} className={`shrink-0 ${isDarkMode ? "text-purple-400" : "text-purple-500"}`} />,
                      CHART: <Image size={10} className={`shrink-0 ${isDarkMode ? "text-cyan-400" : "text-cyan-600"}`} />,
                      GMO_API: <ArrowRight size={10} className={`shrink-0 ${isDarkMode ? "text-amber-400" : "text-amber-600"}`} />,
                      TRADE: <Zap size={10} className={`shrink-0 ${isDarkMode ? "text-emerald-400" : "text-emerald-600"}`} />,
                      RISK: <Shield size={10} className={`shrink-0 ${isDarkMode ? "text-orange-400" : "text-orange-600"}`} />,
                      ERROR: <AlertTriangle size={10} className={`shrink-0 ${isDarkMode ? "text-red-400" : "text-red-500"}`} />,
                    }[log.category];

                    const categoryColor = {
                      SYSTEM: isDarkMode ? "text-blue-500" : "text-blue-600",
                      ANALYSIS: isDarkMode ? "text-purple-500" : "text-purple-600",
                      CHART: isDarkMode ? "text-cyan-500" : "text-cyan-700",
                      GMO_API: isDarkMode ? "text-amber-500" : "text-amber-700",
                      TRADE: isDarkMode ? "text-emerald-500" : "text-emerald-700",
                      RISK: isDarkMode ? "text-orange-500" : "text-orange-700",
                      ERROR: isDarkMode ? "text-red-500" : "text-red-600",
                    }[log.category];

                    const time = new Date(log.timestamp).toLocaleTimeString("ja-JP", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    });

                    return (
                      <div key={i} className={`flex items-start gap-1 sm:gap-1.5 py-0.5 rounded px-1 group ${isDarkMode ? "hover:bg-white/[0.02]" : "hover:bg-gray-50"}`}>
                        <span className={`shrink-0 w-[44px] sm:w-[52px] text-[10px] sm:text-[11px] ${isDarkMode ? "text-gray-700" : "text-gray-400"}`}>{time}</span>
                        {categoryIcon}
                        <span className={`shrink-0 w-[36px] sm:w-[52px] text-[9px] font-bold uppercase ${categoryColor}`}>
                          {log.category === "GMO_API" ? "GMO" : log.category.slice(0, 4)}
                        </span>
                        <span className={`${levelColor} break-all`}>{log.message}</span>
                        {log.detail && typeof log.detail.api === "string" && (
                          <span className={`text-[9px] shrink-0 hidden group-hover:inline ${isDarkMode ? "text-gray-700" : "text-gray-400"}`}>
                            [{log.detail.api}]
                          </span>
                        )}
                      </div>
                    );
                  })}
                  <div ref={activityEndRef} />
                </div>
              )}
            </div>

            {/* Analysis Progress Bar */}
            {analyzing && (
              <div className={`border-t px-4 py-2 ${isDarkMode ? "border-gray-800 bg-[#161b22]" : "border-gray-200 bg-gray-50"}`}>
                <div className="flex items-center gap-3">
                  <div className={`flex-1 h-1 rounded-full overflow-hidden ${isDarkMode ? "bg-gray-800" : "bg-gray-200"}`}>
                    <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full animate-pulse" style={{ width: "100%" }} />
                  </div>
                  <span className={`text-[10px] shrink-0 ${isDarkMode ? "text-cyan-400" : "text-cyan-600"}`}>{analysisStep || "処理中..."}</span>
                </div>
              </div>
            )}
          </div>

          {/* Signal History */}
          <div className={card + " overflow-hidden"}>
            <div className={cardHdr + " flex flex-col gap-2"}>
              <div className="flex items-center justify-between">
                <h3 className={`text-xs font-bold ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>シグナル履歴</h3>
                <div className="flex items-center gap-2">
                  {/* Source toggle */}
                  <div className={`flex rounded-lg overflow-hidden text-[10px] ${isDarkMode ? "bg-dark-secondary" : "bg-gray-100"}`}>
                    <button onClick={() => setSignalSource("live")} className={`px-2 py-1 transition-colors ${signalSource === "live" ? "bg-cyan-500/20 text-cyan-400 font-bold" : isDarkMode ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"}`}>ライブ</button>
                    <button onClick={() => { setSignalSource("db"); fetchSignalsFromDb(); }} className={`px-2 py-1 transition-colors ${signalSource === "db" ? "bg-cyan-500/20 text-cyan-400 font-bold" : isDarkMode ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"}`}>DB検索</button>
                  </div>
                  {/* Copy button */}
                  <button onClick={copySignalsAsText} className={`text-[10px] px-2 py-1 rounded-lg transition-all ${signalCopied ? "bg-emerald-500/20 text-emerald-400 font-bold" : isDarkMode ? "bg-dark-secondary text-gray-400 hover:text-gray-200" : "bg-gray-100 text-gray-500 hover:text-gray-700"}`} title="全件コピー">
                    {signalCopied ? "Copied!" : "コピー"}
                  </button>
                  <span className="text-[10px] text-gray-500">{(signalSource === "db" ? dbSignals : signals).length}件</span>
                </div>
              </div>
              {/* Date range filter (DB mode only) */}
              {signalSource === "db" && (
                <div className="flex items-center gap-2 text-[10px]">
                  <input type="date" value={signalDateFrom} onChange={(e) => setSignalDateFrom(e.target.value)} className={`px-2 py-1 rounded border text-[10px] ${isDarkMode ? "bg-dark-secondary border-gray-700 text-gray-300" : "bg-white border-gray-200 text-gray-700"}`} />
                  <span className={isDarkMode ? "text-gray-600" : "text-gray-400"}>〜</span>
                  <input type="date" value={signalDateTo} onChange={(e) => setSignalDateTo(e.target.value)} className={`px-2 py-1 rounded border text-[10px] ${isDarkMode ? "bg-dark-secondary border-gray-700 text-gray-300" : "bg-white border-gray-200 text-gray-700"}`} />
                  <button onClick={fetchSignalsFromDb} className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors font-bold">
                    {signalLoading ? "..." : "検索"}
                  </button>
                </div>
              )}
            </div>
            {(() => {
              const displaySignals = signalSource === "db" ? dbSignals : signals;
              return displaySignals.length === 0 ? (
              <div className="p-6 text-center">
                <p className={`text-sm ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
                  {signalSource === "db" ? "該当期間のシグナルがありません" : "まだシグナルがありません"}
                </p>
              </div>
            ) : (
              <div className="max-h-[480px] overflow-y-auto divide-y divide-gray-200 dark:divide-gray-800/30">
                {displaySignals.map((sig) => {
                  const isExpanded = expandedSignalId === sig.id;
                  return (
                    <div key={sig.id}>
                      <button
                        onClick={() => setExpandedSignalId(isExpanded ? null : sig.id)}
                        className={`w-full px-3 sm:px-4 py-2.5 text-xs transition-colors ${
                          isExpanded
                            ? isDarkMode ? "bg-dark-secondary/50" : "bg-gray-50"
                            : isDarkMode ? "hover:bg-dark-secondary/30" : "hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center gap-2 sm:gap-3">
                          <span className={`flex items-center gap-1 font-bold shrink-0 ${actionColor(sig.action)}`}>
                            {actionIcon(sig.action)} {sig.action}
                          </span>
                          <span className={`font-mono shrink-0 ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>
                            {(sig.confidence * 100).toFixed(0)}%
                          </span>
                          <span className={`flex-1 truncate text-left ${isDarkMode ? "text-gray-400" : "text-gray-600"}`}>
                            {sig.reason}
                          </span>
                          <span className="flex items-center gap-1 shrink-0">
                            {sig.executed && (
                              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-bold">約定</span>
                            )}
                            <span className={`font-mono text-[10px] ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
                              {signalSource === "db"
                                ? new Date(sig.created_at).toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" }) + " " + new Date(sig.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
                                : new Date(sig.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
                              }
                            </span>
                          </span>
                        </div>
                      </button>

                      {/* Expanded Detail */}
                      {isExpanded && (
                        <div className={`px-4 py-3 space-y-3 ${isDarkMode ? "bg-dark-secondary/20" : "bg-gray-50/50"}`}>
                          {/* AI Model & Strategy & Position Status */}
                          <div className="flex items-center gap-3 flex-wrap text-[10px]">
                            <span className={isDarkMode ? "text-gray-500" : "text-gray-400"}>
                              モデル: <span className="font-mono">{sig.ai_model}</span>
                            </span>
                            <span className={isDarkMode ? "text-gray-500" : "text-gray-400"}>
                              戦略: {sig.strategy_name}
                            </span>
                            {sig.position_status && (
                              <span className={isDarkMode ? "text-gray-500" : "text-gray-400"}>
                                状態: <span className="font-bold">{sig.position_status}</span>
                              </span>
                            )}
                            <span className={isDarkMode ? "text-gray-500" : "text-gray-400"}>
                              {new Date(sig.created_at).toLocaleString("ja-JP")}
                            </span>
                          </div>

                          {/* Full Reason */}
                          <div className={`rounded-lg p-3 text-xs leading-relaxed ${isDarkMode ? "bg-dark-card text-gray-300" : "bg-white text-gray-700"}`}>
                            {sig.reason}
                          </div>

                          {/* Execution Result */}
                          {sig.execution_result && !("error" in sig.execution_result) && (
                            <div className={`rounded-lg p-3 text-xs ${isDarkMode ? "bg-emerald-500/5 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-200"}`}>
                              <p className={`text-[10px] font-bold mb-1.5 ${isDarkMode ? "text-emerald-400" : "text-emerald-600"}`}>約定詳細</p>
                              <div className="grid grid-cols-2 gap-1.5">
                                {sig.execution_result.type === "order" && (
                                  <>
                                    <span className={isDarkMode ? "text-gray-400" : "text-gray-500"}>注文ID:</span>
                                    <span className="font-mono">{String(sig.execution_result.order_id || "—")}</span>
                                    <span className={isDarkMode ? "text-gray-400" : "text-gray-500"}>建玉ID:</span>
                                    <span className="font-mono">{String(sig.execution_result.position_id || "—")}</span>
                                    <span className={isDarkMode ? "text-gray-400" : "text-gray-500"}>約定価格:</span>
                                    <span className="font-mono">{String(sig.execution_result.entry_price || "—")}</span>
                                  </>
                                )}
                                {sig.execution_result.type === "close" && (
                                  <>
                                    <span className={isDarkMode ? "text-gray-400" : "text-gray-500"}>決済価格:</span>
                                    <span className="font-mono">{String(sig.execution_result.exit_price || "—")}</span>
                                    <span className={isDarkMode ? "text-gray-400" : "text-gray-500"}>損益:</span>
                                    <span className={`font-mono font-bold ${Number(sig.execution_result.pnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                      {Number(sig.execution_result.pnl || 0) >= 0 ? "+" : ""}¥{Number(sig.execution_result.pnl || 0).toLocaleString()}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Execution Error */}
                          {sig.execution_result && "error" in sig.execution_result && (
                            <div className={`rounded-lg p-3 text-xs ${isDarkMode ? "bg-red-500/5 border border-red-500/20" : "bg-red-50 border border-red-200"}`}>
                              <p className="text-red-400 font-bold text-[10px]">エラー: {String(sig.execution_result.error)}</p>
                            </div>
                          )}

                          {/* Chart Image */}
                          {sig.chart_image_url && (
                            <div>
                              <p className={`text-[10px] font-bold mb-1 ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>分析チャート</p>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={sig.chart_image_url}
                                alt="Analysis chart"
                                className="rounded-lg border max-h-48 object-contain"
                                style={{ borderColor: isDarkMode ? "#2d2d3d" : "#e5e7eb" }}
                              />
                            </div>
                          )}

                          {/* AI Response JSON (collapsible) */}
                          {sig.ai_response_json && (
                            <details>
                              <summary className={`text-[10px] cursor-pointer ${isDarkMode ? "text-gray-600 hover:text-gray-400" : "text-gray-400 hover:text-gray-600"}`}>
                                AI応答JSON
                              </summary>
                              <pre className={`mt-1 p-2 rounded text-[9px] font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap ${isDarkMode ? "bg-dark-card text-gray-500" : "bg-gray-50 text-gray-500"}`}>
                                {JSON.stringify(sig.ai_response_json, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
            })()}
          </div>

          {/* Auto Trade Orders */}
          {(orders.length > 0 || orderSearchMode) && (
            <div className={card + " overflow-hidden"}>
              <div className={cardHdr + " space-y-2"}>
                <div className="flex items-center justify-between">
                  <h3 className={`text-xs font-bold ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>注文履歴</h3>
                  <div className="flex items-center gap-2">
                    <div className={`flex rounded-lg overflow-hidden text-[10px] ${isDarkMode ? "bg-dark-secondary" : "bg-gray-100"}`}>
                      <button onClick={() => setOrderSearchMode(false)} className={`px-2 py-1 transition-colors ${!orderSearchMode ? "bg-cyan-500/20 text-cyan-400 font-bold" : isDarkMode ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"}`}>直近</button>
                      <button onClick={() => { setOrderSearchMode(true); fetchOrdersFromDb(); }} className={`px-2 py-1 transition-colors ${orderSearchMode ? "bg-cyan-500/20 text-cyan-400 font-bold" : isDarkMode ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"}`}>DB検索</button>
                    </div>
                    <button onClick={copyOrdersAsText} className={`text-[10px] px-2 py-1 rounded-lg transition-all ${orderCopied ? "bg-emerald-500/20 text-emerald-400 font-bold" : isDarkMode ? "bg-dark-secondary text-gray-400 hover:text-gray-200" : "bg-gray-100 text-gray-500 hover:text-gray-700"}`} title="全件コピー">
                      {orderCopied ? "Copied!" : "コピー"}
                    </button>
                    <span className="text-[10px] text-gray-500">{(orderSearchMode ? dbOrders : orders).length}件</span>
                  </div>
                </div>
                {orderSearchMode && (
                  <div className="flex items-center gap-2 text-[10px]">
                    <input type="date" value={orderDateFrom} onChange={(e) => setOrderDateFrom(e.target.value)} className={`px-2 py-1 rounded border text-[10px] ${isDarkMode ? "bg-dark-secondary border-gray-700 text-gray-300" : "bg-white border-gray-200 text-gray-700"}`} />
                    <span className={isDarkMode ? "text-gray-600" : "text-gray-400"}>〜</span>
                    <input type="date" value={orderDateTo} onChange={(e) => setOrderDateTo(e.target.value)} className={`px-2 py-1 rounded border text-[10px] ${isDarkMode ? "bg-dark-secondary border-gray-700 text-gray-300" : "bg-white border-gray-200 text-gray-700"}`} />
                    <button onClick={fetchOrdersFromDb} className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors font-bold">
                      {orderLoading ? "..." : "検索"}
                    </button>
                  </div>
                )}
              </div>
              {(() => {
                const displayOrders = orderSearchMode ? dbOrders : orders;
                return displayOrders.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className={`text-sm ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
                      {orderSearchMode ? "該当期間の注文がありません" : "まだ注文がありません"}
                    </p>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-800/30">
                    {displayOrders.map((order) => {
                      const statusLabel: Record<string, string> = {
                        OPEN: "保有中", CLOSED_AI: "AI決済", CLOSED_MANUAL: "手動決済", CLOSED_SL: "損切到達",
                      };
                      const statusColor: Record<string, string> = {
                        OPEN: "text-blue-400 bg-blue-500/15",
                        CLOSED_AI: "text-emerald-400 bg-emerald-500/15",
                        CLOSED_MANUAL: "text-yellow-400 bg-yellow-500/15",
                        CLOSED_SL: "text-red-400 bg-red-500/15",
                      };
                      return (
                        <div key={order.id} className="px-3 sm:px-4 py-2.5 text-xs">
                          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                            <span className={`font-bold ${order.side === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                              {order.side}
                            </span>
                            <span className={`font-mono ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>
                              {order.symbol.replace("_", "/")}
                            </span>
                            <span className="font-mono text-gray-500">
                              @{order.entry_price || "—"}{order.exit_price ? ` → ${order.exit_price}` : ""}
                            </span>
                            {order.pnl != null && (
                              <span className={`font-mono font-bold ${order.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {order.pnl >= 0 ? "+" : ""}¥{order.pnl.toLocaleString()}
                              </span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${statusColor[order.status] || ""}`}>
                              {statusLabel[order.status] || order.status}
                            </span>
                          </div>
                          <div className={`flex items-center gap-2 mt-1 text-[10px] font-mono flex-wrap ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
                            <span>{new Date(order.opened_at).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                            {order.closed_at && (
                              <span>→ {new Date(order.closed_at).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ====== STRATEGIES TAB ====== */}
      {activeTab === "strategies" && (
        <div className="space-y-4">
          {/* Phase Configuration (API Cost Optimization) */}
          <div className={`${card} p-4 space-y-3 border-2 ${isDarkMode ? "border-cyan-500/20" : "border-cyan-200"}`}>
            <div className="flex items-center gap-2">
              <Shield size={14} className="text-cyan-400" />
              <h3 className={`text-sm font-bold ${isDarkMode ? "text-cyan-300" : "text-cyan-700"}`}>
                API最適化フェーズ設定
              </h3>
            </div>
            <p className={`text-[10px] ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>
              Gemini APIの呼び出しを最適化し、コストを削減します。価格がSRラインに接近した時のみAI分析を実行します。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={`text-[10px] block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Phase A (環境認識)
                </label>
                <p className={`text-xs font-mono px-2 py-1.5 rounded ${isDarkMode ? "bg-dark-secondary text-gray-400" : "bg-gray-100 text-gray-600"}`}>
                  H1バー確定時（毎時00分）に自動実行
                </p>
              </div>
              <div>
                <label className={`text-[10px] block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  GeminiAPI実行条件 (pips)
                </label>
                <input
                  type="number" min={1} max={50} step={1}
                  value={config.phase_battle_pips || ""}
                  onChange={(e) => setConfig({ ...config, phase_battle_pips: Number(e.target.value) || 12 })}
                  className={`${inputCls} font-mono text-xs w-full`}
                />
                <p className={`text-[10px] mt-0.5 ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
                  ライン±{config.phase_battle_pips}pips以内で実行 / 超過時はスキップ
                </p>
              </div>
              <div>
                <label className={`text-[10px] block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  取引後クールダウン (分)
                </label>
                <input
                  type="number" min={0} max={30} step={1}
                  value={config.post_trade_cooldown_min || ""}
                  onChange={(e) => setConfig({ ...config, post_trade_cooldown_min: Number(e.target.value) || 5 })}
                  className={`${inputCls} font-mono text-xs w-full`}
                />
              </div>
            </div>
            <button
              onClick={async () => {
                if (!userId) return;
                setPhaseSaving(true);
                setPhaseSaved(false);
                try {
                  await fetch("/api/bot/config", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      user_id: userId,
                      phase_battle_pips: config.phase_battle_pips,
                      post_trade_cooldown_min: config.post_trade_cooldown_min,
                    }),
                  });
                  setPhaseSaved(true);
                  setTimeout(() => setPhaseSaved(false), 3000);
                } catch (err) {
                  console.error("Phase config save error:", err);
                }
                setPhaseSaving(false);
              }}
              disabled={phaseSaving}
              className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg font-bold text-xs transition-all ${
                phaseSaved ? "bg-emerald-500 text-white" : "bg-cyan-500 hover:bg-cyan-600 text-white"
              } disabled:opacity-50`}
            >
              {phaseSaved ? <><Check size={14} /> 保存しました</> : phaseSaving ? "保存中..." : <><Save size={14} /> フェーズ設定を保存</>}
            </button>
          </div>

          {/* System Common Prompt (Read-only) */}
          <div className={`${card} p-4 space-y-3 border-2 ${isDarkMode ? "border-amber-500/20" : "border-amber-200"}`}>
            <div className="flex items-center gap-2">
              <Lock size={14} className="text-amber-400" />
              <h3 className={`text-sm font-bold ${isDarkMode ? "text-amber-300" : "text-amber-700"}`}>
                システム共通ルール（編集不可）
              </h3>
            </div>
            <p className={`text-[10px] ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>
              すべての戦略プロンプトの末尾に自動付加されます。AIの出力フォーマットを統一し、自動売買の執行判断に必要な情報を強制します。
            </p>
            <pre className={`p-3 rounded-lg text-[10px] font-mono leading-relaxed overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap ${
              isDarkMode ? "bg-dark-secondary text-gray-400 border border-gray-800" : "bg-amber-50 text-gray-600 border border-amber-100"
            }`}>
              {SYSTEM_TRADE_PROMPT}
            </pre>
          </div>

          {/* Prompt Variables Reference */}
          <details className={card + " overflow-hidden"}>
            <summary className={`px-4 py-3 flex items-center gap-2 cursor-pointer text-xs font-bold ${isDarkMode ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-700"}`}>
              <Terminal size={14} className="text-cyan-400" />
              プロンプトで使える変数一覧
            </summary>
            <div className={`px-4 pb-4 ${isDarkMode ? "border-t border-gray-800" : "border-t border-gray-100"}`}>
              <table className="w-full text-xs mt-3">
                <thead>
                  <tr className={isDarkMode ? "text-gray-500" : "text-gray-400"}>
                    <th className="text-left py-1.5 pr-4 font-medium">変数名</th>
                    <th className="text-left py-1.5 font-medium">内容</th>
                  </tr>
                </thead>
                <tbody className={isDarkMode ? "text-gray-300" : "text-gray-600"}>
                  {[
                    ["{symbol}", "通貨ペア（例: USD_JPY）"],
                    ["{current_price}", "現在価格 — BUY保有時はBID、SELL保有時はASK、ノーポジはASK"],
                    ["{current_dt_str}", "現在の日本時間（例: 2026-03-20 19:30）"],
                    ["{position_status}", "ポジション状態（例: BUY (@159.116) / ノーポジション）"],
                    ["{economic_info}", "本日の重要経済指標データ"],
                    ["{ai_summary}", "AIストラテジストの戦略要約"],
                  ].map(([varName, desc]) => (
                    <tr key={varName} className={isDarkMode ? "border-t border-gray-800/50" : "border-t border-gray-100"}>
                      <td className="py-1.5 pr-4 font-mono text-cyan-400 whitespace-nowrap">{varName}</td>
                      <td className={`py-1.5 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {/* Strategy Editor */}
          {(editingStrategy || newStrategy) && (
            <div className={card + ` p-4 space-y-4 border-2 ${isDarkMode ? "border-blue-500/30" : "border-blue-300"}`}>
              <div className="flex items-center justify-between">
                <h3 className={`text-sm font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>
                  {newStrategy ? "新しい戦略を作成" : `「${editingStrategy?.display_name}」を編集`}
                </h3>
                <button onClick={cancelEdit} className={`transition-colors ${isDarkMode ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"}`}><X size={16} /></button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {newStrategy && (
                  <div>
                    <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>戦略ID (英数字)</label>
                    <input value={strategyForm.name} onChange={(e) => setStrategyForm({ ...strategyForm, name: e.target.value })} placeholder="my_strategy" className={inputCls} />
                  </div>
                )}
                <div className={newStrategy ? "" : "col-span-2"}>
                  <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>表示名</label>
                  <input value={strategyForm.display_name} onChange={(e) => setStrategyForm({ ...strategyForm, display_name: e.target.value })} placeholder="マイ戦略" className={inputCls} />
                </div>
              </div>

              <div>
                <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>説明</label>
                <input value={strategyForm.description} onChange={(e) => setStrategyForm({ ...strategyForm, description: e.target.value })} placeholder="この戦略の概要..." className={inputCls} />
              </div>

              <div>
                <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>プロンプトテンプレート</label>
                <textarea value={strategyForm.prompt_template} onChange={(e) => setStrategyForm({ ...strategyForm, prompt_template: e.target.value })} rows={12} className={`${inputCls} font-mono text-xs leading-relaxed resize-y`} placeholder="戦略プロンプトを入力..." />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button onClick={cancelEdit} className={`px-4 py-2 rounded-lg text-sm font-medium ${isDarkMode ? "text-gray-400 hover:text-gray-200" : "text-gray-600 hover:text-gray-800"}`}>キャンセル</button>
                <button onClick={saveStrategy} disabled={strategySaving || !strategyForm.prompt_template} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-bold disabled:opacity-50">
                  <Save size={14} /> {strategySaving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          )}

          {/* Strategy List Header */}
          <div className="flex items-center justify-between">
            <h2 className={`text-sm font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>戦略一覧</h2>
            <button onClick={openNewStrategy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold">
              <Plus size={12} /> 新規作成
            </button>
          </div>

          <div className="space-y-2">
            {strategies.map((s) => {
              const isActive = config.strategy_name === s.name;
              return (
                <div key={s.id} className={`${card} p-3 sm:p-4 transition-all ${isActive ? (isDarkMode ? "ring-1 ring-blue-500/50" : "ring-1 ring-blue-300") : ""}`}>
                  <div className="flex items-start sm:items-center justify-between gap-2">
                    <div className="flex items-start sm:items-center gap-2 sm:gap-3 min-w-0">
                      <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                        isActive ? "bg-blue-500/20 text-blue-400" : isDarkMode ? "bg-dark-secondary text-gray-500" : "bg-gray-100 text-gray-400"
                      }`}>
                        {s.is_builtin ? "B" : "C"}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className={`text-xs sm:text-sm font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>{s.display_name}</h3>
                          {isActive && <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-bold">使用中</span>}
                          {s.is_builtin && <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDarkMode ? "bg-gray-800 text-gray-500" : "bg-gray-100 text-gray-400"}`}>ビルトイン</span>}
                        </div>
                        <p className={`text-[10px] sm:text-xs mt-0.5 truncate ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>{s.description || "説明なし"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!isActive && (
                        <button
                          onClick={async () => {
                            setConfig((prev) => ({ ...prev, strategy_name: s.name }));
                            if (userId) {
                              await fetch("/api/bot/config", {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ user_id: userId, strategy_name: s.name }),
                              });
                            }
                          }}
                          className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                            isDarkMode ? "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20" : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                          }`}
                        >
                          使用する
                        </button>
                      )}
                      <button onClick={() => openEditStrategy(s)} className={`p-2 rounded-lg transition-colors ${isDarkMode ? "hover:bg-dark-secondary text-gray-500 hover:text-gray-300" : "hover:bg-gray-100 text-gray-400 hover:text-gray-600"}`} title="編集">
                        <Pencil size={14} />
                      </button>
                      {deletingStrategyId === s.id ? (
                        <div className="flex items-center gap-1 animate-in fade-in">
                          <button onClick={() => deleteStrategy(s.id)} className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors" title="確定">
                            <Check size={13} />
                          </button>
                          <button onClick={() => setDeletingStrategyId(null)} className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? "hover:bg-dark-secondary text-gray-500" : "hover:bg-gray-100 text-gray-400"}`} title="キャンセル">
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setDeletingStrategyId(s.id)} className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="削除">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  {s.prompt_template && (
                    <details className="mt-3">
                      <summary className={`text-xs cursor-pointer flex items-center gap-1 ${isDarkMode ? "text-gray-600 hover:text-gray-400" : "text-gray-400 hover:text-gray-600"}`}>
                        <ChevronDown size={12} /> プロンプトを表示
                      </summary>
                      <pre className={`mt-2 p-3 rounded-lg text-[10px] font-mono leading-relaxed overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap ${isDarkMode ? "bg-dark-secondary text-gray-400" : "bg-gray-50 text-gray-600"}`}>
                        {s.prompt_template.slice(0, 800)}{s.prompt_template.length > 800 ? "\n..." : ""}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ====== CONFIG TAB ====== */}
      {activeTab === "config" && (
        <div className="space-y-4">
          <section className={card + " p-4 space-y-4"}>
            <h2 className={`text-sm font-bold flex items-center gap-2 ${isDarkMode ? "text-white" : "text-gray-900"}`}>
              <Activity size={16} className="text-blue-400" /> 取引設定
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>通貨ペア</label>
                <select value={config.symbol} onChange={(e) => setConfig({ ...config, symbol: e.target.value })} className={inputCls}>
                  {SYMBOLS.map((s) => <option key={s} value={s}>{s.replace("_", "/")}</option>)}
                </select>
              </div>
              <div>
                <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>戦略</label>
                <select value={config.strategy_name} onChange={(e) => setConfig({ ...config, strategy_name: e.target.value })} className={inputCls}>
                  {strategies.filter((s) => s.is_active).map((s) => <option key={s.name} value={s.name}>{s.display_name}</option>)}
                </select>
              </div>
              <div>
                <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>取引数量（通貨単位）</label>
                <input type="number" min={1000} step={1000} value={config.lot_size || ""} onChange={(e) => setConfig({ ...config, lot_size: e.target.value === "" ? 0 : parseInt(e.target.value) })} className={inputCls + " font-mono"} />
                <p className={`text-[10px] mt-0.5 ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>GMOコインFX最小単位: 10,000通貨</p>
              </div>
              <div>
                <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>分析間隔 (分)</label>
                <input type="number" min={1} max={60} value={config.analysis_interval_min || ""} onChange={(e) => setConfig({ ...config, analysis_interval_min: e.target.value === "" ? 0 : parseInt(e.target.value) })} className={inputCls + " font-mono"} />
              </div>
              <div>
                <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>取引開始 (JST)</label>
                <input type="number" min={0} max={23} value={config.trade_start_hour ?? ""} onChange={(e) => setConfig({ ...config, trade_start_hour: e.target.value === "" ? 0 : Math.min(23, Math.max(0, parseInt(e.target.value))) })} className={inputCls + " font-mono"} />
              </div>
              <div>
                <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>取引終了 (JST)</label>
                <input type="number" min={1} max={30} value={config.trade_end_hour || ""} onChange={(e) => setConfig({ ...config, trade_end_hour: e.target.value === "" ? 0 : Math.min(30, Math.max(1, parseInt(e.target.value))) })} className={inputCls + " font-mono"} />
                <p className={`text-[10px] mt-0.5 ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
                  24超=翌日 (例: 26=翌2時){config.trade_end_hour > 24 && ` → ${config.trade_start_hour}:00〜翌${config.trade_end_hour - 24}:00`}
                </p>
              </div>
            </div>
          </section>

          {/* Notification Settings */}
          <section className={card + " p-4 space-y-4"}>
            <h2 className={`text-sm font-bold flex items-center gap-2 ${isDarkMode ? "text-white" : "text-gray-900"}`}>
              <Zap size={16} className="text-yellow-400" /> 通知設定
            </h2>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-xs font-medium ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>Discord通知</p>
                <p className={`text-[10px] ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>
                  シグナル・約定・エラーをDiscordに通知
                </p>
              </div>
              <button
                onClick={() => {
                  setConfig({ ...config, notification_enabled: !config.notification_enabled });
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  config.notification_enabled
                    ? "bg-blue-500"
                    : isDarkMode ? "bg-gray-700" : "bg-gray-300"
                }`}
              >
                <span className={`inline-block h-4 w-4 rounded-full shadow-sm transition-transform ${
                  config.notification_enabled
                    ? "translate-x-6 bg-white"
                    : isDarkMode ? "translate-x-1 bg-gray-400" : "translate-x-1 bg-white"
                }`} />
              </button>
            </div>
            <p className={`text-[10px] ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
              {config.notification_enabled
                ? "ON — Webhook URLは設定画面で管理"
                : "OFF — Webhook URLは設定画面で入力してください"}
            </p>
          </section>

          {/* X (Twitter) Settings */}
          <section className={card + " p-4 space-y-4"}>
            <h2 className={`text-sm font-bold flex items-center gap-2 ${isDarkMode ? "text-white" : "text-gray-900"}`}>
              <Twitter size={16} className="text-sky-400" /> X (Twitter) 自動投稿
            </h2>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-xs font-medium ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>X自動投稿</p>
                <p className={`text-[10px] ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>
                  新規エントリー・決済時にチャート画像付きでXに自動投稿
                </p>
              </div>
              <button
                onClick={() => setConfig({ ...config, x_enabled: !config.x_enabled })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  config.x_enabled
                    ? "bg-sky-500"
                    : isDarkMode ? "bg-gray-700" : "bg-gray-300"
                }`}
              >
                <span className={`inline-block h-4 w-4 rounded-full shadow-sm transition-transform ${
                  config.x_enabled
                    ? "translate-x-6 bg-white"
                    : isDarkMode ? "translate-x-1 bg-gray-400" : "translate-x-1 bg-white"
                }`} />
              </button>
            </div>

            {config.x_enabled && (
              <div className="space-y-4">
                <p className={`text-[10px] ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>
                  API認証情報は<strong>設定画面</strong>で入力してください。
                </p>

                {/* ── Big Trade Threshold ── */}
                <div>
                  <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                    大勝ち/大負け判定しきい値（円）
                  </label>
                  <div className="flex items-center gap-2">
                    <input type="number" value={config.x_big_trade_threshold} onChange={(e) => setConfig({ ...config, x_big_trade_threshold: Number(e.target.value) || 10000 })} min={1000} step={1000} className={inputCls + " font-mono text-xs w-36"} />
                    <p className={`text-[10px] ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
                      ±{(config.x_big_trade_threshold || 10000).toLocaleString()}円以上 → ドラマモード
                    </p>
                  </div>
                </div>

                {/* ── Prompt Preset Selector (4 styles) ── */}
                <div>
                  <label className={`text-xs font-medium flex items-center gap-1 mb-2 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                    <MessageSquare size={12} /> 投稿文スタイル（Gemini 2.5 Pro生成）
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {PRESET_KEYS.map((key) => {
                      const p = TWEET_PRESETS[key];
                      const isActive = xPreset === key;
                      return (
                        <button
                          key={key}
                          onClick={() => {
                            setConfig({
                              ...config,
                              x_tweet_preset: key,
                              x_tweet_prompt: p.quick,
                              x_tweet_prompt_drama: p.drama,
                            });
                          }}
                          className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
                            isActive
                              ? isDarkMode
                                ? "border-sky-500/50 bg-sky-500/10"
                                : "border-sky-400 bg-sky-50"
                              : isDarkMode
                              ? "border-gray-800 hover:border-gray-700"
                              : "border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <p className={`text-xs font-bold ${isActive ? "text-sky-400" : isDarkMode ? "text-gray-300" : "text-gray-700"}`}>{p.label}</p>
                            {isActive && <span className="flex items-center gap-0.5 text-[10px] font-bold text-sky-400"><Check size={10} />設定中</span>}
                          </div>
                          <p className={`text-[10px] mt-0.5 ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>{p.description}</p>
                        </button>
                      );
                    })}
                  </div>
                  <p className={`text-[10px] mt-1.5 ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
                    スタイルを選ぶとベースのプロンプトが反映されます。下のテキストを直接編集して微調整も可能です。
                  </p>
                </div>

                {/* ── Quick Prompt (entry / normal exit) ── */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>通常投稿</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isDarkMode ? "bg-sky-500/15 text-sky-400" : "bg-sky-100 text-sky-600"}`}>140〜200文字</span>
                    <span className={`text-[10px] ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>— エントリー・通常決済時</span>
                  </div>
                  <textarea
                    value={config.x_tweet_prompt || ""}
                    onChange={(e) => setConfig({ ...config, x_tweet_prompt: e.target.value })}
                    rows={5}
                    placeholder="上のスタイルを選択するとプロンプトが反映されます"
                    className={`${inputCls} font-mono text-[11px] leading-relaxed resize-y`}
                  />
                </div>

                {/* ── Drama Prompt (big win / big loss) ── */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>大勝ち/大負け</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isDarkMode ? "bg-orange-500/15 text-orange-400" : "bg-orange-100 text-orange-600"}`}>300〜500文字</span>
                    <span className={`text-[10px] ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>— しきい値超過の決済時</span>
                  </div>
                  <textarea
                    value={config.x_tweet_prompt_drama || ""}
                    onChange={(e) => setConfig({ ...config, x_tweet_prompt_drama: e.target.value })}
                    rows={6}
                    placeholder="上のスタイルを選択するとプロンプトが反映されます"
                    className={`${inputCls} font-mono text-[11px] leading-relaxed resize-y`}
                  />
                </div>

                <div className={`text-[10px] space-y-1 ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
                  <p>テンプレート変数（自動置換）:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {["{trade_info}", "{pair}", "{action}", "{last_reason}", "{pnl}", "{mode}"].map((v) => (
                      <code key={v} className={`px-1.5 py-0.5 rounded ${isDarkMode ? "bg-gray-800 text-gray-500" : "bg-gray-100 text-gray-500"}`}>{v}</code>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

          {saveError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono">
              <AlertTriangle size={14} className="inline mr-1" />
              {saveError}
            </div>
          )}

          <button
            onClick={handleSaveConfig}
            disabled={saving}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all ${
              saved ? "bg-emerald-500 text-white" : saveError ? "bg-red-500 hover:bg-red-600 text-white" : "bg-blue-500 hover:bg-blue-600 text-white"
            } disabled:opacity-50`}
          >
            {saved ? <><Check size={16} /> 保存しました</> : saving ? "保存中..." : saveError ? <><AlertTriangle size={16} /> 再保存</> : <><Save size={16} /> 設定を保存</>}
          </button>
        </div>
      )}
    </div>
  );
}
