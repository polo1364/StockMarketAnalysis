const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

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

// HTTP 请求辅助函数（使用 axios 作为 fetch 的备用）
async function httpRequest(url, options = {}) {
    try {
        // 使用 axios（在 Railway 上更可靠）
        const response = await axios.get(url, {
            headers: options.headers || {},
            timeout: 15000,
            validateStatus: () => true, // 接受所有状态码
            maxRedirects: 5
        });
        
        // 返回类似 fetch 的响应对象
        return {
            ok: response.status >= 200 && response.status < 400,
            status: response.status,
            statusText: response.statusText,
            json: async () => {
                if (typeof response.data === 'string') {
                    return JSON.parse(response.data);
                }
                return response.data;
            },
            text: async () => {
                if (typeof response.data === 'string') {
                    return response.data;
                }
                return JSON.stringify(response.data);
            }
        };
    } catch (err) {
        // 详细的错误信息
        const errorDetails = {
            message: err.message,
            code: err.code,
            errno: err.errno,
            syscall: err.syscall,
            address: err.address,
            port: err.port,
            response: err.response ? {
                status: err.response.status,
                statusText: err.response.statusText,
                data: err.response.data
            } : null
        };
        console.error(`axios 请求失败 (${url}):`, JSON.stringify(errorDetails, null, 2));
        
        // 如果 axios 失败，尝试原生 fetch
        try {
            console.log('尝试使用原生 fetch...');
            const fetchResponse = await fetch(url, options);
            return fetchResponse;
        } catch (fetchErr) {
            console.error(`fetch 也失败:`, fetchErr.message, fetchErr.cause);
            throw new Error(`HTTP 请求失败: ${err.message || fetchErr.message}. 详情: ${JSON.stringify(errorDetails)}`);
        }
    }
}

// 获取股票数据的函数（使用多种数据源）
async function fetchStockData(ticker) {
    // 处理台股代号（支持4位和5位数字）
    let symbolsToTry = [ticker.toUpperCase()];
    
    // 如果是纯数字，尝试添加台股后缀
    if (/^\d{4,5}$/.test(ticker)) {
        // 4位或5位数字，尝试 .TW 和 .TWO
        symbolsToTry.push(ticker + '.TW');
        symbolsToTry.push(ticker + '.TWO');
    }
    
    // 方案 1: 尝试 yahoo-finance2 库
    if (yahooFinance && typeof yahooFinance.quote === 'function') {
        for (const symbol of symbolsToTry) {
            try {
                console.log(`尝试 yahoo-finance2: ${symbol}`);
                const quote = await yahooFinance.quote(symbol);
                if (quote && quote.regularMarketPrice) {
                    console.log(`yahoo-finance2 成功: ${symbol}`);
                    return quote;
                }
            } catch (err) {
                console.error(`yahoo-finance2 失败 (${symbol}):`, err.message);
            }
        }
    }
    
    // 方案 2: 使用 CORS 代理服务（Railway 网络受限时的首选方案）
    for (const symbol of symbolsToTry) {
        try {
            console.log(`尝试使用 CORS 代理: ${symbol}`);
            // 使用公共 CORS 代理
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`)}`;
            
            const proxyResponse = await httpRequest(proxyUrl, {
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (proxyResponse.ok) {
                const chartData = await proxyResponse.json();
                const result = chartData?.chart?.result?.[0];
                const meta = result?.meta;
                
                if (meta && meta.regularMarketPrice !== undefined && meta.regularMarketPrice !== null) {
                    console.log(`✅ CORS 代理成功: ${symbol}, 价格: ${meta.regularMarketPrice}`);
                    const changePercent = meta.regularMarketPrice && meta.chartPreviousClose 
                        ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100)
                        : (meta.regularMarketChangePercent || 0);
                    
                    return {
                        longName: meta.longName || meta.shortName || ticker,
                        shortName: meta.shortName || meta.symbol || ticker,
                        regularMarketPrice: meta.regularMarketPrice,
                        regularMarketChangePercent: changePercent,
                        trailingPE: meta.trailingPE || null,
                        marketCap: meta.marketCap || null,
                        regularMarketVolume: meta.regularMarketVolume || 0,
                        regularMarketPreviousClose: meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice,
                        regularMarketDayHigh: meta.regularMarketDayHigh || meta.regularMarketPrice,
                        regularMarketDayLow: meta.regularMarketDayLow || meta.regularMarketPrice,
                        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || meta.regularMarketPrice,
                        fiftyTwoWeekLow: meta.fiftyTwoWeekLow || meta.regularMarketPrice
                    };
                }
            }
        } catch (err) {
            console.error(`CORS 代理失败 (${symbol}):`, err.message);
        }
    }
    
    // 方案 2.5: Yahoo Finance Chart API (直接访问，Railway 上可能超时)
    for (const symbol of symbolsToTry) {
        try {
            console.log(`尝试 Yahoo Chart API: ${symbol}`);
            const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
            
            const chartResponse = await httpRequest(chartUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://finance.yahoo.com/'
                }
            });
            
            console.log(`Yahoo Chart API 响应状态: ${chartResponse.status} for ${symbol}`);
            
            if (chartResponse.ok) {
                const chartData = await chartResponse.json();
                console.log(`Yahoo Chart API 响应数据:`, JSON.stringify(chartData).substring(0, 500));
                const result = chartData?.chart?.result?.[0];
                const meta = result?.meta;
                
                if (meta && meta.regularMarketPrice !== undefined && meta.regularMarketPrice !== null) {
                    console.log(`Yahoo Chart API 成功: ${symbol}, 价格: ${meta.regularMarketPrice}`);
                    const changePercent = meta.regularMarketPrice && meta.chartPreviousClose 
                        ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100)
                        : (meta.regularMarketChangePercent || 0);
                    
                    return {
                        longName: meta.longName || meta.shortName || ticker,
                        shortName: meta.shortName || meta.symbol || ticker,
                        regularMarketPrice: meta.regularMarketPrice,
                        regularMarketChangePercent: changePercent,
                        trailingPE: meta.trailingPE || null,
                        marketCap: meta.marketCap || null,
                        regularMarketVolume: meta.regularMarketVolume || 0,
                        regularMarketPreviousClose: meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice,
                        regularMarketDayHigh: meta.regularMarketDayHigh || meta.regularMarketPrice,
                        regularMarketDayLow: meta.regularMarketDayLow || meta.regularMarketPrice,
                        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || meta.regularMarketPrice,
                        fiftyTwoWeekLow: meta.fiftyTwoWeekLow || meta.regularMarketPrice
                    };
                } else {
                    console.log(`Yahoo Chart API 返回数据但无价格: ${symbol}, meta:`, JSON.stringify(meta).substring(0, 200));
                }
            } else {
                const errorText = await chartResponse.text().catch(() => '');
                console.log(`Yahoo Chart API 返回 ${chartResponse.status}: ${symbol}, 错误: ${errorText.substring(0, 200)}`);
            }
        } catch (err) {
            console.error(`Yahoo Chart API 失败 (${symbol}):`, err.message, err.stack);
        }
    }
    
    // 方案 2.5: Yahoo Finance 台湾站点 API
    for (const symbol of symbolsToTry) {
        try {
            console.log(`尝试 Yahoo Finance TW API: ${symbol}`);
            // 移除后缀，使用原始代码
            const twSymbol = symbol.replace(/\.(TW|TWO)$/, '');
            const twUrl = `https://tw.stock.yahoo.com/_td-stock/api/resource/StockServices.stockList;autoComplete=1;query=${encodeURIComponent(twSymbol)};region=TW;lang=zh-Hant-TW`;
            
            const twResponse = await httpRequest(twUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                    'Referer': 'https://tw.stock.yahoo.com/'
                }
            });
            
            if (twResponse.ok) {
                const twData = await twResponse.json();
                console.log(`Yahoo TW API 响应:`, JSON.stringify(twData).substring(0, 500));
                // 这里需要根据实际 API 响应格式解析
            }
        } catch (err) {
            console.error(`Yahoo Finance TW API 失败:`, err.message);
        }
    }
    
    // 方案 3: Yahoo Finance Quote Summary API
    for (const symbol of symbolsToTry) {
        try {
            console.log(`尝试 Yahoo Quote Summary API: ${symbol}`);
            const quoteUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryProfile,price,defaultKeyStatistics`;
            
            const quoteResponse = await httpRequest(quoteUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                }
            });
            
            console.log(`Yahoo Quote Summary API 响应状态: ${quoteResponse.status} for ${symbol}`);
            
            if (quoteResponse.ok) {
                const quoteData = await quoteResponse.json();
                console.log(`Yahoo Quote Summary API 响应数据:`, JSON.stringify(quoteData).substring(0, 500));
                const price = quoteData?.quoteSummary?.result?.[0]?.price;
                const profile = quoteData?.quoteSummary?.result?.[0]?.summaryProfile;
                
                if (price && (price.regularMarketPrice || price.regularMarketPrice?.raw)) {
                    const marketPrice = price.regularMarketPrice?.raw || price.regularMarketPrice;
                    console.log(`Yahoo Quote Summary API 成功: ${symbol}, 价格: ${marketPrice}`);
                    return {
                        longName: profile?.longName || price.longName || price.shortName || ticker,
                        shortName: price.shortName || ticker,
                        regularMarketPrice: marketPrice,
                        regularMarketChangePercent: price.regularMarketChangePercent?.raw || price.regularMarketChangePercent || 0,
                        trailingPE: quoteData?.quoteSummary?.result?.[0]?.defaultKeyStatistics?.trailingPE?.raw || null,
                        marketCap: price.marketCap?.raw || price.marketCap || null,
                        regularMarketVolume: price.regularMarketVolume?.raw || price.regularMarketVolume || 0,
                        regularMarketPreviousClose: price.regularMarketPreviousClose?.raw || price.regularMarketPreviousClose || marketPrice,
                        regularMarketDayHigh: price.regularMarketDayHigh?.raw || price.regularMarketDayHigh || marketPrice,
                        regularMarketDayLow: price.regularMarketDayLow?.raw || price.regularMarketDayLow || marketPrice,
                        fiftyTwoWeekHigh: price.fiftyTwoWeekHigh?.raw || price.fiftyTwoWeekHigh || marketPrice,
                        fiftyTwoWeekLow: price.fiftyTwoWeekLow?.raw || price.fiftyTwoWeekLow || marketPrice
                    };
                } else {
                    console.log(`Yahoo Quote Summary API 无价格数据: ${symbol}`);
                }
            } else {
                const errorText = await quoteResponse.text().catch(() => '');
                console.log(`Yahoo Quote Summary API 返回 ${quoteResponse.status}: ${symbol}, 错误: ${errorText.substring(0, 200)}`);
            }
        } catch (err) {
            console.error(`Yahoo Quote Summary API 失败 (${symbol}):`, err.message, err.stack);
        }
    }
    
    // 方案 3.5: 直接使用 Yahoo Finance 快速报价（最简单的方法）
    for (const symbol of symbolsToTry) {
        try {
            console.log(`尝试 Yahoo Finance 快速报价: ${symbol}`);
            const quickUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=1&newsCount=0`;
            
            const quickResponse = await httpRequest(quickUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'application/json'
                }
            });
            
            if (quickResponse.ok) {
                const quickData = await quickResponse.json();
                const quote = quickData?.quotes?.[0];
                if (quote && quote.regularMarketPrice) {
                    console.log(`Yahoo 快速报价成功: ${symbol}`);
                    return {
                        longName: quote.longname || quote.shortname || ticker,
                        shortName: quote.shortname || ticker,
                        regularMarketPrice: quote.regularMarketPrice,
                        regularMarketChangePercent: quote.regularMarketChangePercent || 0,
                        trailingPE: null,
                        marketCap: null,
                        regularMarketVolume: quote.regularMarketVolume || 0,
                        regularMarketPreviousClose: quote.regularMarketPreviousClose || quote.regularMarketPrice,
                        regularMarketDayHigh: quote.regularMarketDayHigh || quote.regularMarketPrice,
                        regularMarketDayLow: quote.regularMarketDayLow || quote.regularMarketPrice,
                        fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh || quote.regularMarketPrice,
                        fiftyTwoWeekLow: quote.fiftyTwoWeekLow || quote.regularMarketPrice
                    };
                }
            }
        } catch (err) {
            console.error(`Yahoo 快速报价失败 (${symbol}):`, err.message);
        }
    }
    
    // 方案 5: 返回模拟数据（用于演示）
    console.log('========================================');
    console.log(`所有 API 都失败，返回演示数据...`);
    console.log(`尝试的符号: ${symbolsToTry.join(', ')}`);
    console.log(`Railway 服务器可能无法访问外部网络`);
    console.log(`建议：检查 Railway 的网络配置或使用其他部署平台`);
    console.log('========================================');
    
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
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key']
}));

// 处理 OPTIONS 预检请求
app.options('*', (req, res) => {
    res.sendStatus(200);
});

app.use(express.json());

// 请求日志中间件（用于调试）
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    if (req.method === 'POST') {
        console.log('POST 请求体:', JSON.stringify(req.body));
    }
    next();
});

// 测试端点
app.get('/api/test', (req, res) => {
    console.log('GET /api/test 被调用');
    res.json({ status: 'ok', message: 'API 正常運行', time: new Date().toISOString() });
});

// 测试 POST 端点
app.post('/api/test', (req, res) => {
    console.log('POST /api/test 被调用');
    console.log('请求体:', req.body);
    res.json({ 
        status: 'ok', 
        message: 'POST API 正常運行', 
        received: req.body,
        time: new Date().toISOString() 
    });
});

// 列出所有路由的端点（用于调试）
app.get('/api/routes', (req, res) => {
    const routes = [];
    app._router.stack.forEach((middleware) => {
        if (middleware.route) {
            routes.push({
                path: middleware.route.path,
                methods: Object.keys(middleware.route.methods)
            });
        }
    });
    res.json({ routes, message: '当前注册的路由' });
});

// --- API 端点：分析股票 ---
app.post('/api/analyze', async (req, res) => {
    console.log('=== POST /api/analyze 被调用 ===');
    console.log('请求体:', JSON.stringify(req.body));
    console.log('请求头 x-api-key:', req.headers['x-api-key'] ? '存在' : '不存在');
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
        
        // 使用 gemini-2.5-flash 模型（最新版本，更快更强）
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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

// 静态文件服务（只处理非 API 请求）
app.use((req, res, next) => {
    // 跳过所有 API 请求
    if (req.path.startsWith('/api') || req.path === '/health') {
        return next();
    }
    // 使用静态文件服务
    express.static('.', { index: false })(req, res, next);
});

// 所有其他 GET 请求返回 index.html（SPA 支持）
app.get('*', (req, res) => {
    // 确保不拦截 API 请求
    if (req.path.startsWith('/api') || req.path === '/health') {
        return res.status(404).json({ error: 'API 端点不存在' });
    }
    res.sendFile('index.html', { root: '.' });
});

// 啟動伺服器
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 伺服器已啟動！`);
    console.log(`📊 端口: ${PORT}`);
    console.log(`📊 前端網頁: http://localhost:${PORT}`);
    console.log(`🔌 API 端點: http://localhost:${PORT}/api/analyze`);
    console.log(`🧪 測試端點: http://localhost:${PORT}/api/test`);
    console.log(`📋 路由列表: http://localhost:${PORT}/api/routes`);
    console.log(`\n已註冊的路由:`);
    console.log(`  - GET  /api/test`);
    console.log(`  - GET  /api/routes`);
    console.log(`  - POST /api/analyze`);
    console.log(`  - GET  /health`);
    console.log(`  - GET  /* (静态文件)\n`);
});

