# AI 股票分析系統

一個使用 Yahoo Finance 和 Google Gemini AI 的股票分析網頁應用程式。

## 功能特色

- 📊 即時股票報價（來自 Yahoo Finance）
- 🤖 AI 驅動的股票分析（使用 Google Gemini）
- 💎 多種投資風格選擇（價值投資、短線當沖、成長型投資、保守存股）
- 🎨 現代化的 UI 設計
- 🔒 API Key 安全儲存（僅存於瀏覽器）

## 安裝步驟

### 1. 安裝 Node.js 依賴

```bash
npm install
```

### 2. 啟動伺服器

```bash
npm start
```

或者使用開發模式（自動重啟）：

```bash
npm run dev
```

### 3. 開啟網頁

在瀏覽器中開啟：`http://localhost:3000`

### 4. 設定 Google Gemini API Key

1. 首次使用時，網頁會提示輸入 API Key
2. 前往 [Google AI Studio](https://makersuite.google.com/app/apikey) 取得 API Key
3. 將 API Key 貼到輸入框中並點擊「開始連線」

## 使用方式

1. 在搜尋框輸入股票代號（例如：2330、NVDA、TSLA）
2. 選擇投資風格
3. 點擊「AI 分析」按鈕
4. 等待分析結果顯示

## API 端點

### POST `/api/analyze`

分析股票

**請求標頭：**
- `Content-Type: application/json`
- `x-api-key: YOUR_GEMINI_API_KEY`

**請求體：**
```json
{
  "ticker": "2330",
  "style": "價值投資"
}
```

**回應：**
```json
{
  "market_data": {
    "name": "台積電",
    "price": 580,
    "change": "+2.5%",
    "pe": "18.5"
  },
  "summary": "市場總結...",
  "analysis": "詳細分析...",
  "action": "BUY",
  "risk_level": "Medium",
  "bullish_points": ["理由1", "理由2"],
  "bearish_points": ["風險1", "風險2"]
}
```

## 技術棧

- **前端**: HTML + Tailwind CSS + Vanilla JavaScript
- **後端**: Node.js + Express
- **股票數據**: Yahoo Finance API
- **AI 分析**: Google Gemini API

## 部署到 Railway

### 步驟：

1. **註冊 Railway 帳號**
   - 前往 [Railway](https://railway.app) 註冊帳號

2. **連接 GitHub 倉庫**
   - 在 Railway 中點擊 "New Project"
   - 選擇 "Deploy from GitHub repo"
   - 選擇你的倉庫

3. **自動部署**
   - Railway 會自動檢測 Node.js 項目
   - 自動執行 `npm install` 和 `npm start`
   - 部署完成後會提供一個公開 URL

4. **環境變數（可選）**
   - Railway 會自動設置 `PORT` 環境變數
   - 無需額外配置

5. **訪問應用**
   - 部署完成後，使用 Railway 提供的 URL 訪問應用
   - 前端會自動連接到後端 API

### Railway 配置

項目已包含 `railway.json` 配置文件，Railway 會自動使用：
- 構建器：NIXPACKS（自動檢測）
- 啟動命令：`npm start`
- 重啟策略：失敗時自動重啟

## 注意事項

- ⚠️ AI 分析僅供參考，不代表投資建議
- ⚠️ 股市數據可能有延遲
- ⚠️ API Key 請妥善保管，不要分享給他人
- ⚠️ 部署到 Railway 後，前端會自動使用相對路徑連接 API，無需修改配置

## 授權

MIT License

