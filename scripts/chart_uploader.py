"""
AATM Chart Uploader — MT5チャート画像をSupabase Storageへ自動アップロード

使い方:
  1. pip install supabase
  2. chart_uploader.bat をダブルクリック（または chart_uploader.py を直接実行）

動作:
  - 5分足確定直後（例: 12:00:05）にファイル変更をチェック
  - 変更なければリトライ（12:00:07, 12:00:09）→ 最大N回
  - 取引時間外はスリープ
  - MD5ハッシュで差分検知 → 変更時のみアップロード
"""

import os
import sys
import time
import hashlib
import io
from datetime import datetime, timedelta
from pathlib import Path

try:
    from supabase import create_client
except ImportError:
    print("[ERROR] supabase パッケージが必要です")
    print("  pip install supabase")
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    print("[WARN] Pillow 未インストール — 画像リサイズなしでアップロードします")
    print("  pip install Pillow  で圧縮転送が有効になります")
    Image = None  # type: ignore

# ============================================================
# 設定（チューニング可能）
# ============================================================
CHART_FOLDER = r"C:\Users\surf_\AppData\Roaming\MetaQuotes\Terminal\EE0304F13905552AE0B5EAEFB04866EB\MQL5\Files\AATM_Charts"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
BUCKET_NAME = "chart-images"
CHART_FILES = ["m5.png", "h1.png", "h4.png", "d1.png"]
SR_LEVELS_FILE = "sr_levels.json"   # フェーズ判定用SRレベルファイル

# ── 画像リサイズ設定 ──
RESIZE_MAX_PX = 1024           # 長辺の最大ピクセル数（0=リサイズ無効）
JPEG_QUALITY = 80              # JPEG圧縮品質（1-100）

# ── タイミング設定 ──
CANDLE_INTERVAL_MIN = 5    # 足の間隔（分）: 5 = M5足
FIRST_CHECK_SEC = 5        # 足確定後、最初のチェックまでの秒数
RETRY_INTERVAL_SEC = 2     # リトライ間隔（秒）
MAX_RETRIES = 3            # 最大リトライ回数

# ── 取引時間（JST） ──
TRADE_START_HOUR = 8       # 取引開始時刻（JST）
TRADE_END_HOUR = 30        # 取引終了時刻（JST） ※24超=翌日（例: 26=翌2時）

# ============================================================
# ハッシュでファイル変更を検出
# ============================================================
last_hashes: dict[str, str] = {}

def file_hash(path: str) -> str:
    try:
        with open(path, "rb") as f:
            return hashlib.md5(f.read()).hexdigest()
    except FileNotFoundError:
        return ""

def is_changed(path: str, filename: str) -> bool:
    current = file_hash(path)
    if not current:
        return False
    prev = last_hashes.get(filename, "")
    if current != prev:
        last_hashes[filename] = current
        return True
    return False

# ============================================================
# 画像リサイズ＋JPEG圧縮
# ============================================================
def compress_image(filepath: str) -> tuple[bytes, str]:
    """
    画像をリサイズ＋JPEG圧縮して返す。
    Returns: (image_bytes, content_type)
    Pillowがなければ元PNGをそのまま返す。
    """
    with open(filepath, "rb") as f:
        raw = f.read()

    if Image is None or RESIZE_MAX_PX <= 0:
        return raw, "image/png"

    img = Image.open(io.BytesIO(raw))
    orig_w, orig_h = img.size

    # 長辺がRESIZE_MAX_PX以下ならリサイズ不要
    if max(orig_w, orig_h) > RESIZE_MAX_PX:
        ratio = RESIZE_MAX_PX / max(orig_w, orig_h)
        new_w = int(orig_w * ratio)
        new_h = int(orig_h * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)

    # RGBA→RGB変換（JPEG保存用）
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    compressed = buf.getvalue()

    orig_kb = len(raw) / 1024
    comp_kb = len(compressed) / 1024
    reduction = (1 - len(compressed) / len(raw)) * 100 if raw else 0
    print(f"    圧縮: {orig_w}x{orig_h} → {img.size[0]}x{img.size[1]} | "
          f"{orig_kb:.0f}KB → {comp_kb:.0f}KB ({reduction:.0f}%削減)")

    return compressed, "image/jpeg"


# ============================================================
# Supabase Storageアップロード
# ============================================================
def upload_charts(client) -> int:
    uploaded = 0
    for filename in CHART_FILES:
        filepath = os.path.join(CHART_FOLDER, filename)
        if not is_changed(filepath, filename):
            continue

        try:
            data, content_type = compress_image(filepath)

            # 圧縮時は拡張子を .jpg に変更
            upload_name = filename.replace(".png", ".jpg") if content_type == "image/jpeg" else filename
            storage_path = f"charts/{upload_name}"

            client.storage.from_(BUCKET_NAME).upload(
                path=storage_path,
                file=data,
                file_options={
                    "content-type": content_type,
                    "upsert": "true",
                },
            )
            size_kb = len(data) / 1024
            print(f"  [UPLOAD] {filename} → {upload_name} ({size_kb:.0f}KB)")
            uploaded += 1

        except Exception as e:
            err_str = str(e)
            if "already exists" in err_str.lower() or "Duplicate" in err_str:
                try:
                    client.storage.from_(BUCKET_NAME).update(
                        path=storage_path,
                        file=data,
                        file_options={"content-type": content_type},
                    )
                    print(f"  [UPDATE] {filename} → {upload_name}")
                    uploaded += 1
                except Exception as e2:
                    print(f"  [ERROR] {filename}: {e2}")
            else:
                print(f"  [ERROR] {filename}: {e}")

    # ── sr_levels.json のアップロード ──
    sr_path = os.path.join(CHART_FOLDER, SR_LEVELS_FILE)
    if os.path.isfile(sr_path) and is_changed(sr_path, SR_LEVELS_FILE):
        try:
            with open(sr_path, "rb") as f:
                sr_data = f.read()
            storage_path = f"charts/{SR_LEVELS_FILE}"
            client.storage.from_(BUCKET_NAME).upload(
                path=storage_path,
                file=sr_data,
                file_options={
                    "content-type": "application/json",
                    "upsert": "true",
                },
            )
            print(f"  [UPLOAD] {SR_LEVELS_FILE} ({len(sr_data)}B)")
            uploaded += 1
        except Exception as e:
            err_str = str(e)
            if "already exists" in err_str.lower() or "Duplicate" in err_str:
                try:
                    client.storage.from_(BUCKET_NAME).update(
                        path=f"charts/{SR_LEVELS_FILE}",
                        file=sr_data,
                        file_options={"content-type": "application/json"},
                    )
                    print(f"  [UPDATE] {SR_LEVELS_FILE}")
                    uploaded += 1
                except Exception as e2:
                    print(f"  [ERROR] {SR_LEVELS_FILE}: {e2}")
            else:
                print(f"  [ERROR] {SR_LEVELS_FILE}: {e}")

    return uploaded

# ============================================================
# 取引時間判定
# ============================================================
def is_trading_hours() -> bool:
    """現在がJST取引時間内かどうか"""
    now = datetime.now()  # ローカル時間（JST前提）
    hour = now.hour
    if TRADE_END_HOUR > 24 and hour < TRADE_START_HOUR:
        hour += 24
    return TRADE_START_HOUR <= hour < TRADE_END_HOUR

def next_trading_start() -> datetime:
    """次の取引開始時刻を返す"""
    now = datetime.now()
    today_start = now.replace(hour=TRADE_START_HOUR, minute=0, second=0, microsecond=0)
    if now < today_start:
        return today_start
    return today_start + timedelta(days=1)

# ============================================================
# 次の足確定チェック時刻を計算
# ============================================================
def next_check_time() -> datetime:
    """
    次の足確定 + FIRST_CHECK_SEC 後の時刻を返す
    例: CANDLE_INTERVAL_MIN=5, FIRST_CHECK_SEC=5
        現在 12:03:00 → 次回 12:05:05
        現在 12:05:10 → 次回 12:10:05
    """
    now = datetime.now()
    minute = now.minute
    second = now.second

    # 次の足確定分（例: 5分刻み → 0, 5, 10, 15, ...）
    next_candle_min = ((minute // CANDLE_INTERVAL_MIN) + 1) * CANDLE_INTERVAL_MIN

    if next_candle_min >= 60:
        target = now.replace(minute=0, second=FIRST_CHECK_SEC, microsecond=0) + timedelta(hours=1)
    else:
        target = now.replace(minute=next_candle_min, second=FIRST_CHECK_SEC, microsecond=0)

    # もう過ぎていたら次のサイクルへ
    if target <= now:
        target += timedelta(minutes=CANDLE_INTERVAL_MIN)

    return target

# ============================================================
# バケット初期化
# ============================================================
def ensure_bucket(client):
    try:
        client.storage.get_bucket(BUCKET_NAME)
        print(f"  バケット '{BUCKET_NAME}' 確認OK")
    except Exception:
        try:
            client.storage.create_bucket(
                BUCKET_NAME,
                options={"public": True},
            )
            print(f"  バケット '{BUCKET_NAME}' を作成しました")
        except Exception as e:
            if "already exists" in str(e).lower():
                print(f"  バケット '{BUCKET_NAME}' 確認OK")
            else:
                print(f"  [ERROR] バケット作成失敗: {e}")
                sys.exit(1)

# ============================================================
# メインループ
# ============================================================
def main():
    print("=" * 60)
    print("  AATM Chart Uploader v1.1")
    print("  MT5チャート画像 → Supabase Storage 自動アップロード")
    print("=" * 60)
    print()

    # 環境変数チェック
    url = SUPABASE_URL
    key = SUPABASE_KEY

    env_file = Path(__file__).parent / ".env"
    if (not url or not key) and env_file.exists():
        print(f"  .env ファイルから読み込み: {env_file}")
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line.startswith("SUPABASE_URL="):
                    url = line.split("=", 1)[1].strip().strip('"')
                elif line.startswith("SUPABASE_SERVICE_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"')

    if not url or not key:
        print("[ERROR] Supabase認証情報が設定されていません")
        print()
        print("以下のいずれかで設定してください:")
        print("  1. 環境変数: SUPABASE_URL, SUPABASE_SERVICE_KEY")
        print("  2. scripts/.env ファイル:")
        print('     SUPABASE_URL="https://xxx.supabase.co"')
        print('     SUPABASE_SERVICE_KEY="sb_secret_xxx"')
        print()
        input("Enterキーで終了...")
        sys.exit(1)

    # 取引時間表示
    end_display = f"翌{TRADE_END_HOUR - 24}" if TRADE_END_HOUR > 24 else str(TRADE_END_HOUR)

    print(f"  監視フォルダ: {CHART_FOLDER}")
    print(f"  対象ファイル: {', '.join(CHART_FILES)}")
    print(f"  足間隔: {CANDLE_INTERVAL_MIN}分")
    print(f"  チェック: 足確定+{FIRST_CHECK_SEC}秒後 → リトライ{RETRY_INTERVAL_SEC}秒×最大{MAX_RETRIES}回")
    print(f"  取引時間: {TRADE_START_HOUR}:00〜{end_display}:00 JST")
    print(f"  Supabase: {url[:40]}...")
    print()

    if not os.path.isdir(CHART_FOLDER):
        print(f"[ERROR] チャートフォルダが見つかりません: {CHART_FOLDER}")
        input("Enterキーで終了...")
        sys.exit(1)

    client = create_client(url, key)
    ensure_bucket(client)
    print()

    # 初回アップロード
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 初回アップロード実行...")
    count = upload_charts(client)
    if count == 0:
        print("  変更なし（または画像未生成）")
    print()

    # 常駐ループ
    print("常駐監視を開始します（Ctrl+C で終了）")
    print("-" * 60)

    try:
        while True:
            # ── 取引時間外チェック ──
            if not is_trading_hours():
                next_start = next_trading_start()
                wait = (next_start - datetime.now()).total_seconds()
                print(f"[{datetime.now().strftime('%H:%M:%S')}] "
                      f"取引時間外 → {next_start.strftime('%m/%d %H:%M')} までスリープ")
                time.sleep(max(wait, 1))
                continue

            # ── 次の足確定チェック時刻まで待機 ──
            target = next_check_time()
            wait = (target - datetime.now()).total_seconds()
            print(f"[{datetime.now().strftime('%H:%M:%S')}] "
                  f"次回チェック: {target.strftime('%H:%M:%S')} ({wait:.0f}秒後)")
            time.sleep(max(wait, 0.5))

            # ── チェック + リトライ ──
            for attempt in range(1, MAX_RETRIES + 1):
                ts = datetime.now().strftime('%H:%M:%S')
                count = upload_charts(client)
                if count > 0:
                    print(f"[{ts}] {count}枚アップロード完了 (試行{attempt})")
                    break
                if attempt < MAX_RETRIES:
                    print(f"[{ts}] 変更なし (試行{attempt}/{MAX_RETRIES}) → {RETRY_INTERVAL_SEC}秒後リトライ")
                    time.sleep(RETRY_INTERVAL_SEC)
                else:
                    print(f"[{ts}] 変更なし (試行{attempt}/{MAX_RETRIES}) → 次サイクルへ")

    except KeyboardInterrupt:
        print()
        print("終了しました。")

if __name__ == "__main__":
    main()
