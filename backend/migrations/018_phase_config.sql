-- Phase configuration for API cost optimization
-- Phase A: Environment recognition (H1 bar close, always call Gemini)
-- Phase B: Standby (price far from S/R lines, skip Gemini)
-- Phase C: Battle (price near S/R lines, call Gemini)

ALTER TABLE bot_configs
  ADD COLUMN IF NOT EXISTS phase_battle_pips NUMERIC(6,1) NOT NULL DEFAULT 12.0,
  ADD COLUMN IF NOT EXISTS phase_battle_interval_min INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS post_trade_cooldown_min INTEGER NOT NULL DEFAULT 5;

COMMENT ON COLUMN bot_configs.phase_battle_pips IS 'SRラインとの距離閾値(pips) - この距離以内で戦闘モード';
COMMENT ON COLUMN bot_configs.phase_battle_interval_min IS '戦闘モード時の分析間隔(分)';
COMMENT ON COLUMN bot_configs.post_trade_cooldown_min IS '取引後のクールダウン時間(分)';

-- Track last trade time for cooldown calculation
ALTER TABLE bot_states
  ADD COLUMN IF NOT EXISTS last_trade_at TIMESTAMPTZ;

COMMENT ON COLUMN bot_states.last_trade_at IS '最後の取引実行時刻(クールダウン計算用)';
