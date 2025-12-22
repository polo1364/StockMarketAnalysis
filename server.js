const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// yahoo-finance2 v3 导入和初始化
const YahooFinance = require('yahoo-finance2');
let yahooFinance;

// 尝试不同的初始化方式
if (typeof YahooFinance === 'function') {
    yahooFinance = new YahooFinance();
} else if (YahooFinance.default && typeof YahooFinance.default === 'function') {
    yahooFinance = new YahooFinance.default();
} else if (YahooFinance.default) {
    yahooFinance = YahooFinance.default;
} else {
    yahooFinance = YahooFinance;
}

// 配置 yahoo-finance2（如果支持）
if (yahooFinance && yahooFinance.setGlobalConfig) {
    yahooFinance.setGlobalConfig({
        queue: {
            concurrency: 1,
            timeout: 30000
        }
    });
}

console.log('yahoo-finance2 初始化完成');
console.log('类型:', typeof yahooFinance);
console.log('可用方法:', Object.keys(yahooFinance || {}));

// 获取股票数据的函数（使用多种数据源）
async function fetchStockData(ticker) {
    // 处理台股代号（添加 .TW 或 .TWO 后缀）
    let symbol = ticker.toUpperCase();
    if (/^\d{4}$/.test(symbol)) {
        // 如果是4位数字，可能是台股
        symbol = symbol + '.TW';
    }
    
    // 方案 1: 尝试 yahoo-finance2 库
    if (yahooFinance && typeof yahooFinance.quote === 'function') {
        try {
            console.log('尝试 yahoo-finance2...');
            const quote = await yahooFinance.quote(symbol);
            if (quote && quote.regularMarketPrice) {
                console.log('yahoo-finance2 成功');
                return quote;
            }
        } catch (err) {
            console.error('yahoo-finance2 失败:', err.message);
        }
    }
    
    // 方案 2: Yahoo Finance Chart API (通常不需要认证)
    try {
        console.log('尝试 Yahoo Chart API...');
        const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
        
        const chartResponse = await fetch(chartUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        
        if (chartResponse.ok) {
            const chartData = await chartResponse.json();
            const result = chartData?.chart?.result?.[0];
            const meta = result?.meta;
            
            if (meta && meta.regularMarketPrice) {
                console.log('Yahoo Chart API 成功');
                return {
                    longName: meta.longName || meta.shortName || ticker,
                    shortName: meta.shortName || ticker,
                    regularMarketPrice: meta.regularMarketPrice,
                    regularMarketChangePercent: meta.regularMarketPrice && meta.chartPreviousClose 
                        ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100)
                        : 0,
                    trailingPE: null,
                    marketCap: null,
                    regularMarketVolume: meta.regularMarketVolume,
                    regularMarketPreviousClose: meta.chartPreviousClose || meta.previousClose,
                    regularMarketDayHigh: meta.regularMarketDayHigh,
                    regularMarketDayLow: meta.regularMarketDayLow,
                    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
                    fiftyTwoWeekLow: meta.fiftyTwoWeekLow
                };
            }
        }
    } catch (err) {
        console.error('Yahoo Chart API 失败:', err.message);
    }
    
    // 方案 3: 使用 Finnhub 免费 API（不需要 API Key 的基本功能）
    try {
        console.log('尝试 Finnhub API...');
        // Finnhub 需要 API Key，这里使用演示数据作为后备
        throw new Error('跳过 Finnhub，使用演示数据');
    } catch (err) {
        console.log('Finnhub 跳过');
    }
    
    // 方案 4: 返回模拟数据（用于演示）
    console.log('所有 API 都失败，返回演示数据...');
    
    // 根据股票代号生成一致的演示数据
    const hash = ticker.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const basePrice = (hash % 900) + 100; // 100-1000 范围的价格
    const changePercent = ((hash % 20) - 10) / 10; // -1% 到 +1% 的变化
    
    return {
        longName: `${ticker.toUpperCase()} (演示數據)`,
        shortName: ticker.toUpperCase(),
        regularMarketPrice: basePrice,
        regularMarketChangePercent: changePercent,
        trailingPE: (hash % 30) + 10,
        marketCap: basePrice * 1000000000,
        regularMarketVolume: (hash % 10000000) + 1000000,
        regularMarketPreviousClose: basePrice * (1 - changePercent / 100),
        regularMarketDayHigh: basePrice * 1.02,
        regularMarketDayLow: basePrice * 0.98,
        fiftyTwoWeekHigh: basePrice * 1.3,
        fiftyTwoWeekLow: basePrice * 0.7,
        _isDemo: true // 标记为演示数据
    };
}

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // 提供静态文件服务（HTML文件）

// 请求日志中间件（用于调试）
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

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
        
        // 使用封装的函数获取股票数据（自动使用备用方案）
        const quote = await fetchStockData(ticker);
        
        if (!quote || !quote.regularMarketPrice) {
            return res.status(404).json({ 
                analysis: `找不到股票代號 "${ticker}"，請確認代號是否正確。` 
            });
        }

        // 提取市场数据
        const isDemo = quote._isDemo === true;
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
            fiftyTwoWeekLow: quote.fiftyTwoWeekLow || 0,
            isDemo: isDemo
        };
        
        if (isDemo) {
            console.log('注意：使用演示數據');
        }

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
        console.error('錯誤堆棧:', error.stack);
        console.error('錯誤詳情:', {
            message: error.message,
            name: error.name,
            ticker: ticker,
            hasApiKey: !!apiKey
        });
        
        // 處理 Gemini API 錯誤
        if (error.message && (error.message.includes('API_KEY') || error.message.includes('API key'))) {
            return res.status(401).json({ error: 'API Key 無效或過期' });
        }

        // 處理 Yahoo Finance 錯誤
        if (error.message && (error.message.includes('Not Found') || error.message.includes('Invalid symbol') || error.message.includes('not found'))) {
            return res.status(404).json({ 
                error: `找不到股票代號 "${ticker}"，請確認代號是否正確。`,
                analysis: `找不到股票代號 "${ticker}"，請確認代號是否正確。`
            });
        }

        // 返回詳細錯誤信息（僅在開發環境）
        res.status(500).json({ 
            error: '伺服器錯誤: ' + (error.message || '未知錯誤'),
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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

