const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const yahooFinance = require('yahoo-finance2').default;

const app = express();
const PORT = 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // 提供静态文件服务（HTML文件）

// --- API 端点：分析股票 ---
app.post('/api/analyze', async (req, res) => {
    const { ticker, style } = req.body;
    const apiKey = req.headers['x-api-key'];

    // 验证 API Key
    if (!apiKey) {
        return res.status(401).json({ error: '缺少 API Key' });
    }

    if (!ticker) {
        return res.status(400).json({ error: '缺少股票代號' });
    }

    try {
        // --- 1. 从 Yahoo Finance 获取股票数据 ---
        console.log(`正在获取股票数据: ${ticker}`);
        const quote = await yahooFinance.quote(ticker);
        
        if (!quote || !quote.regularMarketPrice) {
            return res.status(404).json({ 
                analysis: `找不到股票代號 "${ticker}"，請確認代號是否正確。` 
            });
        }

        // 提取市场数据
        const marketData = {
            name: quote.longName || quote.shortName || ticker,
            price: quote.regularMarketPrice || 0,
            change: quote.regularMarketChangePercent 
                ? `${quote.regularMarketChangePercent.toFixed(2)}%` 
                : '0%',
            pe: quote.trailingPE ? quote.trailingPE.toFixed(2) : 'N/A',
            marketCap: quote.marketCap || 0,
            volume: quote.regularMarketVolume || 0,
            previousClose: quote.regularMarketPreviousClose || 0,
            dayHigh: quote.regularMarketDayHigh || 0,
            dayLow: quote.regularMarketDayLow || 0,
            fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh || 0,
            fiftyTwoWeekLow: quote.fiftyTwoWeekLow || 0
        };

        // --- 2. 使用 Gemini AI 进行分析 ---
        console.log(`正在使用 Gemini AI 分析股票...`);
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

        // 构建提示词
        const prompt = `
你是一位專業的股票分析師。請根據以下股票數據，以「${style}」的投資風格進行分析。

股票代號: ${ticker}
公司名稱: ${marketData.name}
當前價格: $${marketData.price}
漲跌幅: ${marketData.change}
本益比 (PE): ${marketData.pe}
市值: $${marketData.marketCap.toLocaleString()}
成交量: ${marketData.volume.toLocaleString()}
前收盤價: $${marketData.previousClose}
今日最高: $${marketData.dayHigh}
今日最低: $${marketData.dayLow}
52週最高: $${marketData.fiftyTwoWeekHigh}
52週最低: $${marketData.fiftyTwoWeekLow}

請以 JSON 格式回覆，包含以下欄位：
{
  "summary": "簡短市場總結（1-2句話）",
  "analysis": "詳細分析（3-5段）",
  "action": "BUY / SELL / HOLD",
  "risk_level": "Low / Medium / High",
  "bullish_points": ["看多理由1", "看多理由2", "看多理由3"],
  "bearish_points": ["風險警示1", "風險警示2", "風險警示3"]
}

請確保回覆是有效的 JSON 格式，不要包含任何額外的文字或 markdown 格式。
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let aiText = response.text().trim();

        // 清理 AI 回應（移除可能的 markdown 代碼塊）
        aiText = aiText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        let aiAnalysis;
        try {
            aiAnalysis = JSON.parse(aiText);
        } catch (parseError) {
            console.error('AI 回應解析失敗:', aiText);
            // 如果解析失敗，使用預設值
            aiAnalysis = {
                summary: "AI 分析暫時無法取得，請稍後再試。",
                analysis: aiText || "無法解析 AI 回應。",
                action: "HOLD",
                risk_level: "Medium",
                bullish_points: [],
                bearish_points: []
            };
        }

        // --- 3. 返回結果 ---
        res.json({
            market_data: marketData,
            summary: aiAnalysis.summary || "分析完成",
            analysis: aiAnalysis.analysis || "",
            action: aiAnalysis.action || "HOLD",
            risk_level: aiAnalysis.risk_level || "Medium",
            bullish_points: aiAnalysis.bullish_points || [],
            bearish_points: aiAnalysis.bearish_points || []
        });

    } catch (error) {
        console.error('分析錯誤:', error);
        
        // 處理 Gemini API 錯誤
        if (error.message && error.message.includes('API_KEY')) {
            return res.status(401).json({ error: 'API Key 無效或過期' });
        }

        // 處理 Yahoo Finance 錯誤
        if (error.message && error.message.includes('Not Found')) {
            return res.status(404).json({ 
                analysis: `找不到股票代號 "${ticker}"，請確認代號是否正確。` 
            });
        }

        res.status(500).json({ 
            error: '伺服器錯誤: ' + error.message 
        });
    }
});

// 健康檢查端點
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: '伺服器運行中' });
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`\n🚀 伺服器已啟動！`);
    console.log(`📊 前端網頁: http://localhost:${PORT}`);
    console.log(`🔌 API 端點: http://localhost:${PORT}/api/analyze\n`);
});

