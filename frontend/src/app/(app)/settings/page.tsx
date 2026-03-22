"use client";

import { useState, useEffect } from "react";
import {
  Shield,
  Swords,
  Eclipse,
  Save,
  Key,
  User,
  AlertTriangle,
  Check,
  MessageSquare,
  FolderOpen,
  Lock,
  Twitter,
} from "lucide-react";
import { useTheme } from "@/lib/hooks/useTheme";
import { useAuth } from "@/lib/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types/database";

const AGENT_OPTIONS = [
  { type: "guardian", name: "守護神", icon: Shield, color: "blue" },
  { type: "assault", name: "強襲", icon: Swords, color: "red" },
  { type: "eclipse", name: "エクリプス", icon: Eclipse, color: "purple" },
] as const;

export default function SettingsPage() {
  const { isDarkMode } = useTheme();
  const { userId, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [agentType, setAgentType] = useState<"guardian" | "assault" | "eclipse">("guardian");
  const [riskConfig, setRiskConfig] = useState({
    loss_tolerance: 50000,
    max_drawdown_pct: 10,
    losing_streak_lock: 5,
  });
  const [geminiKey, setGeminiKey] = useState("");
  const [gmoApiKey, setGmoApiKey] = useState("");
  const [gmoApiSecret, setGmoApiSecret] = useState("");
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");
  const [discordUserId, setDiscordUserId] = useState("");
  const [chartImageFolder, setChartImageFolder] = useState("");

  // X (Twitter) API
  const [xConsumerKey, setXConsumerKey] = useState("");
  const [xConsumerSecret, setXConsumerSecret] = useState("");
  const [xAccessToken, setXAccessToken] = useState("");
  const [xAccessTokenSecret, setXAccessTokenSecret] = useState("");
  const [xBearerToken, setXBearerToken] = useState("");
  const [xClientId, setXClientId] = useState("");
  const [xClientSecret, setXClientSecret] = useState("");

  // Password change
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwResult, setPwResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    async function load() {
      if (authLoading || !userId) return;
      const supabase = createClient();

      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (data) {
        const p = data as Profile & { discord_webhook_url?: string; discord_user_id?: string };
        setProfile(p as Profile);
        setDisplayName(p.display_name || "");
        if (p.ai_agent_type) setAgentType(p.ai_agent_type);
        if (p.risk_config) {
          const rc = p.risk_config as unknown as Record<string, number>;
          setRiskConfig({
            loss_tolerance: rc.loss_tolerance ?? 50000,
            max_drawdown_pct: rc.max_drawdown_pct ?? 10,
            losing_streak_lock: rc.losing_streak_lock ?? 5,
          });
        }
        if (p.discord_webhook_url) setDiscordWebhookUrl(p.discord_webhook_url);
        if (p.discord_user_id) setDiscordUserId(p.discord_user_id);
      }

      // Load GMO/Gemini API keys from bot_configs
      const botRes = await supabase
        .from("bot_configs")
        .select("gmo_api_key_enc, gmo_api_secret_enc, gemini_api_key, discord_webhook_url, discord_user_id, chart_image_folder, x_consumer_key, x_consumer_secret, x_access_token, x_access_token_secret, x_bearer_token, x_client_id, x_client_secret")
        .eq("user_id", userId)
        .single();

      if (botRes.data) {
        if (botRes.data.gmo_api_key_enc) setGmoApiKey(botRes.data.gmo_api_key_enc);
        if (botRes.data.gmo_api_secret_enc) setGmoApiSecret(botRes.data.gmo_api_secret_enc);
        if (botRes.data.gemini_api_key) setGeminiKey(botRes.data.gemini_api_key);
        if (botRes.data.chart_image_folder) setChartImageFolder(botRes.data.chart_image_folder);
        if (!discordWebhookUrl && botRes.data.discord_webhook_url) {
          setDiscordWebhookUrl(botRes.data.discord_webhook_url);
        }
        if (!discordUserId && botRes.data.discord_user_id) {
          setDiscordUserId(botRes.data.discord_user_id);
        }
        // X (Twitter) API
        if (botRes.data.x_consumer_key) setXConsumerKey(botRes.data.x_consumer_key);
        if (botRes.data.x_consumer_secret) setXConsumerSecret(botRes.data.x_consumer_secret);
        if (botRes.data.x_access_token) setXAccessToken(botRes.data.x_access_token);
        if (botRes.data.x_access_token_secret) setXAccessTokenSecret(botRes.data.x_access_token_secret);
        if (botRes.data.x_bearer_token) setXBearerToken(botRes.data.x_bearer_token);
        if (botRes.data.x_client_id) setXClientId(botRes.data.x_client_id);
        if (botRes.data.x_client_secret) setXClientSecret(botRes.data.x_client_secret);
      }

      setLoading(false);
    }
    load();
  }, [authLoading, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePasswordChange = async () => {
    setPwResult(null);
    if (!newPassword || !confirmPassword) {
      setPwResult({ ok: false, msg: "新しいパスワードを入力してください" });
      return;
    }
    if (newPassword.length < 6) {
      setPwResult({ ok: false, msg: "パスワードは6文字以上で入力してください" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwResult({ ok: false, msg: "新しいパスワードが一致しません" });
      return;
    }
    setPwSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setPwResult({ ok: false, msg: error.message });
      } else {
        setPwResult({ ok: true, msg: "パスワードを変更しました" });
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch (err) {
      setPwResult({ ok: false, msg: err instanceof Error ? err.message : "エラーが発生しました" });
    }
    setPwSaving(false);
  };

  const handleSave = async () => {
    if (!profile || !userId) return;
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const supabase = createClient();
      const agentName = AGENT_OPTIONS.find((a) => a.type === agentType)?.name || null;

      // Build profile update — only include columns that exist
      const profileUpdate: Record<string, unknown> = {
        display_name: displayName || null,
        ai_agent_type: agentType,
        ai_agent_name: agentName,
        risk_config: riskConfig,
        updated_at: new Date().toISOString(),
      };
      // discord columns added by migration 005
      if (discordWebhookUrl !== undefined) profileUpdate.discord_webhook_url = discordWebhookUrl || null;
      if (discordUserId !== undefined) profileUpdate.discord_user_id = discordUserId || null;

      const { error: updateError } = await supabase
        .from("profiles")
        .update(profileUpdate)
        .eq("id", profile.id);

      if (updateError) throw updateError;

      // Sync GMO key, Gemini key, and Discord to bot_configs
      // Check if bot_configs row exists
      const { data: existing } = await supabase
        .from("bot_configs")
        .select("user_id")
        .eq("user_id", userId)
        .single();

      if (existing) {
        // Update only the fields we manage here
        await supabase
          .from("bot_configs")
          .update({
            gmo_api_key_enc: gmoApiKey || null,
            gmo_api_secret_enc: gmoApiSecret || null,
            gemini_api_key: geminiKey || null,
            discord_webhook_url: discordWebhookUrl || null,
            discord_user_id: discordUserId || null,
            chart_image_folder: chartImageFolder || null,
            x_consumer_key: xConsumerKey || null,
            x_consumer_secret: xConsumerSecret || null,
            x_access_token: xAccessToken || null,
            x_access_token_secret: xAccessTokenSecret || null,
            x_bearer_token: xBearerToken || null,
            x_client_id: xClientId || null,
            x_client_secret: xClientSecret || null,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);
      } else {
        // Insert with all required defaults
        await supabase
          .from("bot_configs")
          .insert({
            user_id: userId,
            is_active: false,
            symbol: "USD_JPY",
            strategy_name: "PriceAction_logic",
            lot_size: 10000,
            max_positions: 1,
            trade_start_hour: 8,
            trade_end_hour: 15,
            analysis_interval_min: 5,
            gmo_api_key_enc: gmoApiKey || null,
            gmo_api_secret_enc: gmoApiSecret || null,
            gemini_api_key: geminiKey || null,
            discord_webhook_url: discordWebhookUrl || null,
            discord_user_id: discordUserId || null,
            chart_image_folder: chartImageFolder || null,
            x_consumer_key: xConsumerKey || null,
            x_consumer_secret: xConsumerSecret || null,
            x_access_token: xAccessToken || null,
            x_access_token_secret: xAccessTokenSecret || null,
            x_bearer_token: xBearerToken || null,
            x_client_id: xClientId || null,
            x_client_secret: xClientSecret || null,
          });
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const colorMap: Record<string, { bg: string; border: string; text: string }> = {
    blue: { bg: "bg-blue-500/10", border: "border-blue-500/40", text: "text-blue-400" },
    red: { bg: "bg-red-500/10", border: "border-red-500/40", text: "text-red-400" },
    purple: { bg: "bg-purple-500/10", border: "border-purple-500/40", text: "text-purple-400" },
  };

  const inputCls = `w-full px-3 py-2 rounded-lg text-sm border ${
    isDarkMode
      ? "bg-dark-secondary border-gray-700 text-white placeholder:text-gray-600"
      : "bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400"
  }`;

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="animate-pulse text-gray-500">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className={`text-xl font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>設定</h1>
        <p className={`text-sm mt-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
          プロフィール・リスク管理・API連携・通知の設定
        </p>
      </div>

      {/* Profile */}
      <section className={`rounded-xl border p-4 space-y-4 ${isDarkMode ? "bg-dark-card border-gray-800" : "bg-white border-gray-200"}`}>
        <div className="flex items-center gap-2">
          <User size={16} className="text-blue-400" />
          <h2 className={`text-sm font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>プロフィール</h2>
        </div>

        <div>
          <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>表示名</label>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="トレーダー名" className={inputCls} />
        </div>

        <div>
          <label className={`text-xs font-medium block mb-2 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>AIキャラクター</label>
          <div className="grid grid-cols-3 gap-2">
            {AGENT_OPTIONS.map((agent) => {
              const Icon = agent.icon;
              const colors = colorMap[agent.color];
              const isSelected = agentType === agent.type;
              return (
                <button
                  key={agent.type}
                  onClick={() => setAgentType(agent.type)}
                  className={`p-3 rounded-xl border-2 text-center transition-all ${
                    isSelected
                      ? `${colors.bg} ${colors.border}`
                      : isDarkMode ? "border-gray-800 hover:border-gray-700" : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <Icon size={20} className={`mx-auto mb-1 ${isSelected ? colors.text : "text-gray-500"}`} />
                  <span className={`text-xs font-bold ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>{agent.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Risk Config */}
      <section className={`rounded-xl border p-4 space-y-4 ${isDarkMode ? "bg-dark-card border-gray-800" : "bg-white border-gray-200"}`}>
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-orange-400" />
          <h2 className={`text-sm font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>リスク管理</h2>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={`text-xs font-medium ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>1日の許容損失額</label>
            <span className="text-xs font-mono text-red-400">¥{riskConfig.loss_tolerance.toLocaleString()}</span>
          </div>
          <input type="range" min={10000} max={500000} step={10000} value={riskConfig.loss_tolerance} onChange={(e) => setRiskConfig((prev) => ({ ...prev, loss_tolerance: Number(e.target.value) }))} className="w-full accent-red-500" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={`text-xs font-medium ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>最大ドローダウン率</label>
            <span className="text-xs font-mono text-orange-400">{riskConfig.max_drawdown_pct}%</span>
          </div>
          <input type="range" min={3} max={30} step={1} value={riskConfig.max_drawdown_pct} onChange={(e) => setRiskConfig((prev) => ({ ...prev, max_drawdown_pct: Number(e.target.value) }))} className="w-full accent-orange-500" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={`text-xs font-medium ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>連敗ロック回数</label>
            <span className="text-xs font-mono text-yellow-400">{riskConfig.losing_streak_lock}連敗</span>
          </div>
          <input type="range" min={3} max={10} step={1} value={riskConfig.losing_streak_lock} onChange={(e) => setRiskConfig((prev) => ({ ...prev, losing_streak_lock: Number(e.target.value) }))} className="w-full accent-yellow-500" />
        </div>
      </section>

      {/* Discord Notification */}
      <section className={`rounded-xl border p-4 space-y-4 ${isDarkMode ? "bg-dark-card border-gray-800" : "bg-white border-gray-200"}`}>
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-indigo-400" />
          <h2 className={`text-sm font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>Discord通知</h2>
        </div>

        <div>
          <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>Webhook URL</label>
          <input type="text" value={discordWebhookUrl} onChange={(e) => setDiscordWebhookUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/..." className={inputCls + " font-mono"} />
        </div>

        <div>
          <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>User ID (メンション用)</label>
          <input type="text" value={discordUserId} onChange={(e) => setDiscordUserId(e.target.value)} placeholder="123456789012345678" className={inputCls + " font-mono"} />
        </div>

        <p className={`text-xs ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
          自動売買のシグナル・約定・エラー通知をDiscordに送信します。
        </p>
      </section>

      {/* API Keys */}
      <section className={`rounded-xl border p-4 space-y-4 ${isDarkMode ? "bg-dark-card border-gray-800" : "bg-white border-gray-200"}`}>
        <div className="flex items-center gap-2">
          <Key size={16} className="text-emerald-400" />
          <h2 className={`text-sm font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>API連携</h2>
        </div>

        <div>
          <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>Gemini API Key</label>
          <input type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} placeholder="AIxxx..." className={inputCls + " font-mono"} />
          <p className={`text-xs mt-1 ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
            AI診断に使用されます。サーバーの環境変数に設定済みの場合は不要です。
          </p>
        </div>

        <div>
          <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>GMO Coin API Key</label>
          <input type="password" value={gmoApiKey} onChange={(e) => setGmoApiKey(e.target.value)} placeholder="GMO API Key" className={inputCls + " font-mono"} />
        </div>

        <div>
          <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>GMO Coin API Secret</label>
          <input type="password" value={gmoApiSecret} onChange={(e) => setGmoApiSecret(e.target.value)} placeholder="GMO API Secret" className={inputCls + " font-mono"} />
          <p className={`text-xs mt-1 ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
            GMO Coin FXの自動売買と取引履歴の同期に使用されます。会員ページで注文権限をONにしたAPIキーを発行してください。
          </p>
        </div>
      </section>

      {/* Chart Image Folder */}
      <section className={`rounded-xl border p-4 space-y-4 ${isDarkMode ? "bg-dark-card border-gray-800" : "bg-white border-gray-200"}`}>
        <div className="flex items-center gap-2">
          <FolderOpen size={16} className="text-cyan-400" />
          <h2 className={`text-sm font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>チャート画像フォルダ</h2>
        </div>

        <div>
          <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>フォルダパス</label>
          <input type="text" value={chartImageFolder} onChange={(e) => setChartImageFolder(e.target.value)} placeholder="C:\Users\...\MQL5\Files\AATM_Charts" className={inputCls + " font-mono"} />
          <p className={`text-xs mt-1 ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
            MT5 EAが4TFスクリーンショットを保存するフォルダを指定してください。m5.png / h1.png / h4.png / d1.png が必要です。
          </p>
        </div>
      </section>

      {/* X (Twitter) API */}
      <section className={`rounded-xl border p-4 space-y-4 ${isDarkMode ? "bg-dark-card border-gray-800" : "bg-white border-gray-200"}`}>
        <div className="flex items-center gap-2">
          <Twitter size={16} className="text-sky-400" />
          <h2 className={`text-sm font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>X (Twitter) API認証</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>Consumer Key (API Key)</label>
            <input type="password" value={xConsumerKey} onChange={(e) => setXConsumerKey(e.target.value)} placeholder="xxxxxxxxxx" className={inputCls + " font-mono text-xs"} />
          </div>
          <div>
            <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>Consumer Secret (API Secret)</label>
            <input type="password" value={xConsumerSecret} onChange={(e) => setXConsumerSecret(e.target.value)} placeholder="xxxxxxxxxx" className={inputCls + " font-mono text-xs"} />
          </div>
          <div>
            <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>Access Token</label>
            <input type="password" value={xAccessToken} onChange={(e) => setXAccessToken(e.target.value)} placeholder="xxxxxxxxxx" className={inputCls + " font-mono text-xs"} />
          </div>
          <div>
            <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>Access Token Secret</label>
            <input type="password" value={xAccessTokenSecret} onChange={(e) => setXAccessTokenSecret(e.target.value)} placeholder="xxxxxxxxxx" className={inputCls + " font-mono text-xs"} />
          </div>
          <div>
            <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>Bearer Token</label>
            <input type="password" value={xBearerToken} onChange={(e) => setXBearerToken(e.target.value)} placeholder="xxxxxxxxxx" className={inputCls + " font-mono text-xs"} />
          </div>
          <div>
            <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>Client ID</label>
            <input type="password" value={xClientId} onChange={(e) => setXClientId(e.target.value)} placeholder="xxxxxxxxxx" className={inputCls + " font-mono text-xs"} />
          </div>
          <div className="sm:col-span-2">
            <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>Client Secret</label>
            <input type="password" value={xClientSecret} onChange={(e) => setXClientSecret(e.target.value)} placeholder="xxxxxxxxxx" className={inputCls + " font-mono text-xs"} />
          </div>
        </div>

        <p className={`text-xs ${isDarkMode ? "text-gray-600" : "text-gray-400"}`}>
          投稿にはConsumer Key/Secret + Access Token/Secretが必須です。App permissionsを<strong>Read and Write</strong>に設定してください。
        </p>
      </section>

      {/* Password Change */}
      <section className={`rounded-xl border p-4 space-y-4 ${isDarkMode ? "bg-dark-card border-gray-800" : "bg-white border-gray-200"}`}>
        <div className="flex items-center gap-2">
          <Lock size={16} className="text-amber-400" />
          <h2 className={`text-sm font-bold ${isDarkMode ? "text-white" : "text-gray-900"}`}>パスワード変更</h2>
        </div>

        <div className="space-y-3">
          <div>
            <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>新しいパスワード</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="6文字以上" className={inputCls} />
          </div>
          <div>
            <label className={`text-xs font-medium block mb-1 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>新しいパスワード（確認）</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="もう一度入力" className={inputCls} />
          </div>
        </div>

        {pwResult && (
          <div className={`rounded-lg p-2.5 text-xs font-medium ${pwResult.ok ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
            {pwResult.msg}
          </div>
        )}

        <button
          onClick={handlePasswordChange}
          disabled={pwSaving || !newPassword || !confirmPassword}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${isDarkMode ? "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" : "bg-amber-50 text-amber-600 hover:bg-amber-100"} disabled:opacity-50`}
        >
          <Lock size={14} /> {pwSaving ? "変更中..." : "パスワードを変更"}
        </button>
      </section>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all ${
          saved ? "bg-emerald-500 text-white" : "bg-blue-500 hover:bg-blue-600 text-white"
        } disabled:opacity-50`}
      >
        {saved ? (
          <><Check size={16} /> 保存しました</>
        ) : saving ? (
          "保存中..."
        ) : (
          <><Save size={16} /> 設定を保存</>
        )}
      </button>
    </div>
  );
}
