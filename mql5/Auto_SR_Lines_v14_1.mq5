//+------------------------------------------------------------------+
//|                                Auto_SR_Lines_v14_1_Sandwich.mq5  |
//|                               Copyright 2026, IT Consultant & AI |
//+------------------------------------------------------------------+
#property copyright "IT Consultant & AI"
#property version   "14.04"
#property indicator_chart_window
#property indicator_plots 0
//--- 入力パラメータ
input int      InpSensitivity    = 12;              // ピボット感度（ZigZag Depth=12と同期）
input color    InpResColor       = clrChartreuse;   // 抵抗帯（2番目の上方ピボット）
input color    InpSupColor       = clrDeepPink;     // 支持帯（2番目の下方ピボット）
input bool     InpFill           = true;
input color    InpOrangeColor    = clrOrange;       // 中間帯（1番目のピボット）
input color    InpBrokenColor    = clrSlateGray;    // ブレイク済みゾーンの色
input double   InpZoneMaxPips    = 5.0;             // オレンジゾーンの最大幅
input int      InpLabelFontSize  = 12;              // 価格ラベルのフォントサイズ
//--- バー確定検出用
datetime g_lastH1BarTime = 0;
datetime g_lastBarTime   = 0;
//--- ゾーン価格記録（ブレイク判定用）
double g_resZoneHigh = 0, g_resZoneLow = 0;
double g_supZoneHigh = 0, g_supZoneLow = 0;
double g_sellZoneHigh = 0, g_sellZoneLow = 0;
double g_buyZoneHigh  = 0, g_buyZoneLow  = 0;
bool   g_hasResZone   = false, g_hasSupZone  = false;
bool   g_hasSellZone  = false, g_hasBuyZone  = false;
//+------------------------------------------------------------------+
int OnInit()
{
   g_lastH1BarTime = 0;
   g_lastBarTime   = 0;
   g_hasResZone = false; g_hasSupZone = false;
   g_hasSellZone = false; g_hasBuyZone = false;
   ObjectsDeleteAll(0, "AutoRes_");
   ObjectsDeleteAll(0, "AutoSup_");
   ObjectsDeleteAll(0, "Orange_");
   ObjectsDeleteAll(0, "Broken_");
   ObjectsDeleteAll(0, "PriceLabel_");
   return(INIT_SUCCEEDED);
}
void OnDeinit(const int reason)
{
   ObjectsDeleteAll(0, "AutoRes_");
   ObjectsDeleteAll(0, "AutoSup_");
   ObjectsDeleteAll(0, "Orange_");
   ObjectsDeleteAll(0, "Broken_");
   ObjectsDeleteAll(0, "PriceLabel_");
}
//+------------------------------------------------------------------+
void CreatePriceLabel(string name, double displayPrice, double anchorPrice, color col, bool above)
{
   string priceText = DoubleToString(displayPrice, _Digits);
   datetime labelTime = iTime(_Symbol, _Period, 0);
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_TEXT, 0, labelTime, anchorPrice);
   else
      ObjectMove(0, name, 0, labelTime, anchorPrice);
   ObjectSetString(0, name, OBJPROP_TEXT, priceText);
   ObjectSetString(0, name, OBJPROP_FONT, "Arial Bold");
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, InpLabelFontSize);
   ObjectSetInteger(0, name, OBJPROP_COLOR, col);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetInteger(0, name, OBJPROP_ANCHOR, above ? ANCHOR_RIGHT_LOWER : ANCHOR_RIGHT_UPPER);
}
//+------------------------------------------------------------------+
void CreateZone(string name, datetime t1, double price1, double price2, color col)
{
   datetime t2 = TimeCurrent() + 86400;
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_RECTANGLE, 0, t1, price1, t2, price2);
   else {
      ObjectMove(0, name, 0, t1, price1);
      ObjectMove(0, name, 1, t2, price2);
   }
   ObjectSetInteger(0, name, OBJPROP_COLOR, col);
   ObjectSetInteger(0, name, OBJPROP_FILL, InpFill);
   ObjectSetInteger(0, name, OBJPROP_BACK, true);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}
//+------------------------------------------------------------------+
void ConvertToBroken(string srcZone, string srcLabel,
                     string brkZone, string brkLabel,
                     double zHigh, double zLow, bool above)
{
   ObjectDelete(0, brkZone);
   ObjectDelete(0, brkLabel);
   datetime t1 = (datetime)ObjectGetInteger(0, srcZone, OBJPROP_TIME, 0);
   if(t1 == 0) t1 = TimeCurrent();
   ObjectDelete(0, srcZone);
   ObjectDelete(0, srcLabel);
   CreateZone(brkZone, t1, zHigh, zLow, InpBrokenColor);
   double mid = (zHigh + zLow) / 2.0;
   CreatePriceLabel(brkLabel, mid, above ? zHigh : zLow, InpBrokenColor, above);
}
//+------------------------------------------------------------------+
//| メイン計算                                                        |
//+------------------------------------------------------------------+
int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   if(rates_total < InpSensitivity * 2 + 1) return(0);
   ArraySetAsSeries(time, true);
   ArraySetAsSeries(high, true);
   ArraySetAsSeries(low, true);
   ArraySetAsSeries(open, true);
   ArraySetAsSeries(close, true);

   // H1以外ではオレンジ非表示
   if(_Period != PERIOD_H1) {
      ObjectsDeleteAll(0, "Orange_");
      ObjectsDeleteAll(0, "Broken_Orange");
      ObjectsDeleteAll(0, "PriceLabel_Orange");
      ObjectsDeleteAll(0, "PriceLabel_Broken_Orange");
   }

   // =================================================================
   // バー確定検出
   // =================================================================
   datetime currentBar = time[0];
   bool isNewBar = (currentBar != g_lastBarTime);
   if(isNewBar) g_lastBarTime = currentBar;

   bool isNewH1Bar = false;
   if(_Period == PERIOD_H1) {
      datetime curH1 = iTime(_Symbol, PERIOD_H1, 0);
      if(curH1 != g_lastH1BarTime) {
         g_lastH1BarTime = curH1;
         isNewH1Bar = true;
      }
   }

   // =================================================================
   // ブレイク判定（バー確定時のみ）
   // =================================================================
   if(isNewBar)
   {
      double confirmed = close[1];

      // 黄緑ブレイク: 確定足が上端を上抜け
      if(g_hasResZone && confirmed > g_resZoneHigh) {
         ConvertToBroken("AutoRes_Zone", "PriceLabel_Res",
                         "Broken_Res", "PriceLabel_Broken_Res",
                         g_resZoneHigh, g_resZoneLow, true);
         g_hasResZone = false;
      }
      // ピンクブレイク: 確定足が下端を下抜け
      if(g_hasSupZone && confirmed < g_supZoneLow) {
         ConvertToBroken("AutoSup_Zone", "PriceLabel_Sup",
                         "Broken_Sup", "PriceLabel_Broken_Sup",
                         g_supZoneHigh, g_supZoneLow, false);
         g_hasSupZone = false;
      }
   }

   // H1バー確定時: オレンジブレイク判定
   if(isNewH1Bar)
   {
      double confirmed = close[1];
      if(g_hasSellZone && confirmed > g_sellZoneHigh) {
         ConvertToBroken("Orange_Sell", "PriceLabel_Orange_Sell",
                         "Broken_Orange_Sell", "PriceLabel_Broken_Orange_Sell",
                         g_sellZoneHigh, g_sellZoneLow, true);
         g_hasSellZone = false;
      }
      if(g_hasBuyZone && confirmed < g_buyZoneLow) {
         ConvertToBroken("Orange_Buy", "PriceLabel_Orange_Buy",
                         "Broken_Orange_Buy", "PriceLabel_Broken_Orange_Buy",
                         g_buyZoneHigh, g_buyZoneLow, false);
         g_hasBuyZone = false;
      }
   }

   // =================================================================
   // 統合ピボット検出（サンドイッチ構造）
   //   上方: 1番目 → オレンジ売り, 2番目 → 黄緑（抵抗帯）
   //   下方: 1番目 → オレンジ買い, 2番目 → ピンク（支持帯）
   // =================================================================
   double current_price = close[0];

   // --- 上方ピボット検出 ---
   if(!g_hasSellZone || !g_hasResZone)
   {
      int foundAbove = 0;
      for(int i = InpSensitivity; i < rates_total - InpSensitivity; i++)
      {
         if(foundAbove >= 2) break;
         bool isPivotHigh = true;
         for(int k = 1; k <= InpSensitivity; k++)
            if(high[i-k] > high[i] || high[i+k] > high[i]) { isPivotHigh = false; break; }
         if(!isPivotHigh) continue;
         if(high[i] <= current_price) continue;  // 現在価格より上のみ

         // ブレイク済みと同一価格ならスキップ
         if(foundAbove == 0 && ObjectFind(0, "Broken_Orange_Sell") >= 0) {
            double bH = ObjectGetDouble(0, "Broken_Orange_Sell", OBJPROP_PRICE, 0);
            if(MathAbs(high[i] - bH) < _Point * 10) continue;
         }
         if(foundAbove == 1 && ObjectFind(0, "Broken_Res") >= 0) {
            double bH = ObjectGetDouble(0, "Broken_Res", OBJPROP_PRICE, 0);
            if(MathAbs(high[i] - bH) < _Point * 10) continue;
         }

         foundAbove++;
         if(foundAbove == 1 && !g_hasSellZone && _Period == PERIOD_H1)
         {
            // 1番目 → オレンジ売り（H1のみ、H1バー確定時のみ更新）
            if(isNewH1Bar || !g_hasSellZone) {
               double zHigh = high[i];
               double pipsFactor = _Point * 10;
               double maxW = InpZoneMaxPips * pipsFactor;
               double zLow = MathMax(MathMax(open[i], close[i]), zHigh - maxW);
               ObjectDelete(0, "Orange_Sell");
               ObjectDelete(0, "PriceLabel_Orange_Sell");
               CreateZone("Orange_Sell", time[i], zHigh, zLow, InpOrangeColor);
               double mid = (zHigh + zLow) / 2.0;
               CreatePriceLabel("PriceLabel_Orange_Sell", mid, zHigh, InpOrangeColor, true);
               g_sellZoneHigh = zHigh; g_sellZoneLow = zLow;
               g_hasSellZone = true;
               ObjectDelete(0, "Broken_Orange_Sell");
               ObjectDelete(0, "PriceLabel_Broken_Orange_Sell");
            }
         }
         else if(foundAbove == 1 && (g_hasSellZone || _Period != PERIOD_H1))
         {
            // オレンジ既存 or H1以外 → この1番目は黄緑にカウントアップ
            foundAbove++;
         }

         if(foundAbove == 2 && !g_hasResZone)
         {
            // 2番目 → 黄緑（抵抗帯）
            double resHigh = high[i];
            double resLow  = MathMax(open[i], close[i]);
            ObjectDelete(0, "AutoRes_Zone");
            ObjectDelete(0, "PriceLabel_Res");
            CreateZone("AutoRes_Zone", time[i], resHigh, resLow, InpResColor);
            double resMid = (resHigh + resLow) / 2.0;
            CreatePriceLabel("PriceLabel_Res", resMid, resHigh, InpResColor, true);
            g_resZoneHigh = resHigh; g_resZoneLow = resLow;
            g_hasResZone = true;
            ObjectDelete(0, "Broken_Res");
            ObjectDelete(0, "PriceLabel_Broken_Res");
         }
      }
   }

   // --- 下方ピボット検出 ---
   if(!g_hasBuyZone || !g_hasSupZone)
   {
      int foundBelow = 0;
      for(int i = InpSensitivity; i < rates_total - InpSensitivity; i++)
      {
         if(foundBelow >= 2) break;
         bool isPivotLow = true;
         for(int k = 1; k <= InpSensitivity; k++)
            if(low[i-k] < low[i] || low[i+k] < low[i]) { isPivotLow = false; break; }
         if(!isPivotLow) continue;
         if(low[i] >= current_price) continue;  // 現在価格より下のみ

         // ブレイク済みと同一価格ならスキップ
         if(foundBelow == 0 && ObjectFind(0, "Broken_Orange_Buy") >= 0) {
            double bL = ObjectGetDouble(0, "Broken_Orange_Buy", OBJPROP_PRICE, 1);
            if(MathAbs(low[i] - bL) < _Point * 10) continue;
         }
         if(foundBelow == 1 && ObjectFind(0, "Broken_Sup") >= 0) {
            double bL = ObjectGetDouble(0, "Broken_Sup", OBJPROP_PRICE, 1);
            if(MathAbs(low[i] - bL) < _Point * 10) continue;
         }

         foundBelow++;
         if(foundBelow == 1 && !g_hasBuyZone && _Period == PERIOD_H1)
         {
            if(isNewH1Bar || !g_hasBuyZone) {
               double zLow = low[i];
               double pipsFactor = _Point * 10;
               double maxW = InpZoneMaxPips * pipsFactor;
               double zHigh = MathMin(MathMin(open[i], close[i]), zLow + maxW);
               ObjectDelete(0, "Orange_Buy");
               ObjectDelete(0, "PriceLabel_Orange_Buy");
               CreateZone("Orange_Buy", time[i], zHigh, zLow, InpOrangeColor);
               double mid = (zHigh + zLow) / 2.0;
               CreatePriceLabel("PriceLabel_Orange_Buy", mid, zLow, InpOrangeColor, false);
               g_buyZoneHigh = zHigh; g_buyZoneLow = zLow;
               g_hasBuyZone = true;
               ObjectDelete(0, "Broken_Orange_Buy");
               ObjectDelete(0, "PriceLabel_Broken_Orange_Buy");
            }
         }
         else if(foundBelow == 1 && (g_hasBuyZone || _Period != PERIOD_H1))
         {
            foundBelow++;
         }

         if(foundBelow == 2 && !g_hasSupZone)
         {
            double supHigh = MathMin(open[i], close[i]);
            double supLow  = low[i];
            ObjectDelete(0, "AutoSup_Zone");
            ObjectDelete(0, "PriceLabel_Sup");
            CreateZone("AutoSup_Zone", time[i], supLow, supHigh, InpSupColor);
            double supMid = (supHigh + supLow) / 2.0;
            CreatePriceLabel("PriceLabel_Sup", supMid, supLow, InpSupColor, false);
            g_supZoneHigh = supHigh; g_supZoneLow = supLow;
            g_hasSupZone = true;
            ObjectDelete(0, "Broken_Sup");
            ObjectDelete(0, "PriceLabel_Broken_Sup");
         }
      }
   }

   // 既存ゾーンのラベル位置を最新バーに更新
   if(g_hasResZone)
      CreatePriceLabel("PriceLabel_Res", (g_resZoneHigh+g_resZoneLow)/2.0, g_resZoneHigh, InpResColor, true);
   if(g_hasSupZone)
      CreatePriceLabel("PriceLabel_Sup", (g_supZoneHigh+g_supZoneLow)/2.0, g_supZoneLow, InpSupColor, false);
   if(g_hasSellZone)
      CreatePriceLabel("PriceLabel_Orange_Sell", (g_sellZoneHigh+g_sellZoneLow)/2.0, g_sellZoneHigh, InpOrangeColor, true);
   if(g_hasBuyZone)
      CreatePriceLabel("PriceLabel_Orange_Buy", (g_buyZoneHigh+g_buyZoneLow)/2.0, g_buyZoneLow, InpOrangeColor, false);

   // =================================================================
   // SR Levels JSON出力（フェーズ判定用）
   // =================================================================
   if(isNewBar)
      WriteSRLevelsJSON();

   ChartRedraw();
   return(rates_total);
}
//+------------------------------------------------------------------+
//| SRレベルをJSONファイルに書き出し（chart_uploader経由でSupabaseへ）   |
//+------------------------------------------------------------------+
void WriteSRLevelsJSON()
{
   string filePath = "AATM_Charts\\sr_levels.json";
   int handle = FileOpen(filePath, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(handle == INVALID_HANDLE) return;

   string json = "{\n";
   json += "  \"symbol\": \"" + _Symbol + "\",\n";
   json += "  \"updated_at\": \"" + TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + "\",\n";
   json += "  \"current_price\": " + DoubleToString(SymbolInfoDouble(_Symbol, SYMBOL_BID), _Digits) + ",\n";
   json += "  \"zones\": [\n";

   bool first = true;

   // 黄緑（抵抗帯）
   if(g_hasResZone) {
      if(!first) json += ",\n";
      json += "    {\"type\":\"resistance\",\"color\":\"green\",\"high\":" + DoubleToString(g_resZoneHigh, _Digits)
            + ",\"low\":" + DoubleToString(g_resZoneLow, _Digits) + ",\"broken\":false}";
      first = false;
   }
   // ピンク（支持帯）
   if(g_hasSupZone) {
      if(!first) json += ",\n";
      json += "    {\"type\":\"support\",\"color\":\"pink\",\"high\":" + DoubleToString(g_supZoneHigh, _Digits)
            + ",\"low\":" + DoubleToString(g_supZoneLow, _Digits) + ",\"broken\":false}";
      first = false;
   }
   // オレンジ売り
   if(g_hasSellZone) {
      if(!first) json += ",\n";
      json += "    {\"type\":\"orange_sell\",\"color\":\"orange\",\"high\":" + DoubleToString(g_sellZoneHigh, _Digits)
            + ",\"low\":" + DoubleToString(g_sellZoneLow, _Digits) + ",\"broken\":false}";
      first = false;
   }
   // オレンジ買い
   if(g_hasBuyZone) {
      if(!first) json += ",\n";
      json += "    {\"type\":\"orange_buy\",\"color\":\"orange\",\"high\":" + DoubleToString(g_buyZoneHigh, _Digits)
            + ",\"low\":" + DoubleToString(g_buyZoneLow, _Digits) + ",\"broken\":false}";
      first = false;
   }
   // ブレイク済みゾーン（チャートオブジェクトから取得）
   string brokenNames[] = {"Broken_Res", "Broken_Sup", "Broken_Orange_Sell", "Broken_Orange_Buy"};
   string brokenTypes[] = {"broken_res", "broken_sup", "broken_orange_sell", "broken_orange_buy"};
   for(int b = 0; b < 4; b++) {
      if(ObjectFind(0, brokenNames[b]) >= 0) {
         double bHigh = ObjectGetDouble(0, brokenNames[b], OBJPROP_PRICE, 0);
         double bLow  = ObjectGetDouble(0, brokenNames[b], OBJPROP_PRICE, 1);
         if(bHigh > 0 && bLow > 0) {
            if(!first) json += ",\n";
            json += "    {\"type\":\"" + brokenTypes[b] + "\",\"color\":\"slategray\",\"high\":"
                  + DoubleToString(bHigh, _Digits) + ",\"low\":" + DoubleToString(bLow, _Digits) + ",\"broken\":true}";
            first = false;
         }
      }
   }

   json += "\n  ]\n}";
   FileWriteString(handle, json);
   FileClose(handle);
}
