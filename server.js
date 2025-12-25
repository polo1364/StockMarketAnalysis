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

// HTTP 请求辅助函数（优先使用 fetch，axios 作为备用）
async function httpRequest(url, options = {}) {
    // 优先尝试原生 fetch（在 Railway 上可能更可靠）
    try {
        console.log(`尝试使用原生 fetch: ${url.substring(0, 80)}...`);
        const fetchResponse = await fetch(url, {
            ...options,
            signal: AbortSignal.timeout(30000) // 30 秒超时
        });
        return fetchResponse;
    } catch (fetchErr) {
        console.log(`fetch 失败，尝试 axios:`, fetchErr.message);
        
        // 如果 fetch 失败，尝试 axios
        try {
            const response = await axios.get(url, {
                headers: options.headers || {},
                timeout: 30000, // 增加到 30 秒
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
            console.error(`axios 也失败 (${url.substring(0, 80)}...):`, JSON.stringify(errorDetails, null, 2));
            throw new Error(`HTTP 请求失败: ${fetchErr.message || err.message}`);
        }
    }
}

// 获取股票数据的函数（使用多种数据源）
async function fetchStockData(ticker) {
    // 处理台股代号（支持4位和5位数字）
    const stockCode = ticker.replace(/^0+/, ''); // 移除前导零，TWSE API 不需要前导零
    const stockCodePadded = stockCode.padStart(4, '0'); // 补齐到4位
    
    // 方案 1: 使用台湾证券交易所 OpenAPI（官方 API，最可靠）
    try {
        console.log(`尝试 TWSE OpenAPI: ${stockCodePadded}`);
        
        // TWSE 即時報價 API
        const twseUrl = `https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL`;
        
        const twseResponse = await httpRequest(twseUrl, {
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (twseResponse.ok) {
            const twseData = await twseResponse.json();
            console.log(`TWSE API 返回数据，共 ${Array.isArray(twseData) ? twseData.length : 0} 只股票`);
            
            // 查找匹配的股票（支持多种格式：4位数字、带前导零等）
            const stock = Array.isArray(twseData) ? twseData.find(s => {
                const code = String(s.Code || '').trim();
                return code === stockCodePadded || 
                       code === stockCode || 
                       code === ticker.padStart(4, '0');
            }) : null;
            
            if (stock) {
                console.log(`✅ TWSE API 成功: ${stock.Code} (${stock.Name}), 价格: ${stock.ClosingPrice}`);
                
                // 解析价格数据（TWSE API 返回的可能是字符串，需要移除千分位逗号）
                const closingPrice = parseFloat(String(stock.ClosingPrice || 0).replace(/,/g, '')) || 0;
                const previousClose = parseFloat(String(stock.PreviousClosingPrice || stock.ClosingPrice || 0).replace(/,/g, '')) || closingPrice;
                const changePercent = previousClose > 0 
                    ? ((closingPrice - previousClose) / previousClose * 100)
                    : 0;
                
                // 解析成交量（移除千分位逗号）
                const volume = parseInt(String(stock.TradeVolume || 0).replace(/,/g, '')) || 0;
                const highestPrice = parseFloat(String(stock.HighestPrice || closingPrice).replace(/,/g, '')) || closingPrice;
                const lowestPrice = parseFloat(String(stock.LowestPrice || closingPrice).replace(/,/g, '')) || closingPrice;
                
                return {
                    longName: stock.Name || ticker,
                    shortName: stock.Code || ticker,
                    regularMarketPrice: closingPrice,
                    regularMarketChangePercent: changePercent,
                    trailingPE: null,
                    marketCap: null,
                    regularMarketVolume: volume,
                    regularMarketPreviousClose: previousClose,
                    regularMarketDayHigh: highestPrice,
                    regularMarketDayLow: lowestPrice,
                    fiftyTwoWeekHigh: null,
                    fiftyTwoWeekLow: null
                };
            } else {
                console.log(`TWSE API 未找到股票代码: ${stockCodePadded} (尝试了: ${stockCodePadded}, ${stockCode}, ${ticker.padStart(4, '0')})`);
            }
        } else {
            console.log(`TWSE API 返回状态码: ${twseResponse.status}`);
        }
    } catch (err) {
        console.error(`TWSE API 失败:`, err.message);
    }
    
    // 方案 2: 使用 CORS 代理服务（Yahoo Finance 备用方案）
    let symbolsToTry = [ticker.toUpperCase()];
    
    // 如果是纯数字，尝试添加台股后缀（优先尝试 .TW）
    if (/^\d{4,5}$/.test(ticker)) {
        symbolsToTry.push(ticker + '.TW');
        symbolsToTry.push(ticker + '.TWO');
    }
    
    const primarySymbol = symbolsToTry[1] || symbolsToTry[0]; // 优先尝试 .TW
    
    try {
        console.log(`尝试使用 CORS 代理: ${primarySymbol}`);
        // 使用公共 CORS 代理
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${primarySymbol}?interval=1d&range=1d`)}`;
        
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
                console.log(`✅ CORS 代理成功: ${primarySymbol}, 价格: ${meta.regularMarketPrice}`);
                const changePercent = meta.regularMarketPrice && meta.chartPreviousClose 
                    ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100)
                    : (meta.regularMarketChangePercent || 0);
                
                // 优先使用中文名称（longName 通常是中文）
                const stockName = meta.longName || meta.shortName || ticker;
                
                return {
                    longName: stockName,
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
        console.error(`CORS 代理失败 (${primarySymbol}):`, err.message);
    }
    
    // 如果主要符号失败，尝试其他符号
    for (const symbol of symbolsToTry) {
        if (symbol === primarySymbol) continue; // 已经尝试过了
        
        try {
            console.log(`尝试使用 CORS 代理: ${symbol}`);
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
                    
                    const stockName = meta.longName || meta.shortName || ticker;
                    
                    return {
                        longName: stockName,
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
    
    // 方案 3: 返回模拟数据（用于演示）
    // 注意：Railway 无法直接访问 Yahoo Finance，所以跳过其他会超时的 API
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

// 请求超时处理（Railway 可能有超时限制）
const REQUEST_TIMEOUT = 50000; // 50 秒（Railway 通常是 60 秒，留出缓冲）

// --- API 端点：分析股票 ---
app.post('/api/analyze', async (req, res) => {
    console.log('=== POST /api/analyze 被调用 ===');
    console.log('请求体:', JSON.stringify(req.body));
    console.log('请求头 x-api-key:', req.headers['x-api-key'] ? '存在' : '不存在');
    
    const { ticker, style } = req.body;
    const apiKey = req.headers['x-api-key'];
    
    // 设置超时（在验证之后）
    let timeoutId;
    const setupTimeout = () => {
        timeoutId = setTimeout(() => {
            if (!res.headersSent) {
                console.error('请求超时');
                res.status(504).json({ 
                    error: '請求超時，請稍後再試。股票數據獲取或 AI 分析時間過長。' 
                });
            }
        }, REQUEST_TIMEOUT);
    };
    
    // 清理超时器
    const clearTimeoutSafe = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    };
    
    res.on('finish', clearTimeoutSafe);
    res.on('close', clearTimeoutSafe);
    
    // 在验证通过后设置超时
    setupTimeout();

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

        // 构建提示词（明确要求使用中文）
        const prompt = `
你是一位專業的股票分析師，請使用繁體中文進行分析（專業術語如 PE、ROE、EPS 等可保留英文縮寫）。

請根據以下股票數據，以「${style}」的投資風格進行分析：

股票代號: ${ticker}
公司名稱: ${marketData.name}
當前價格: ${marketData.price}
漲跌幅: ${marketData.change}
本益比 (PE): ${marketData.pe}
市值: ${marketData.marketCap.toLocaleString()}
成交量: ${marketData.volume.toLocaleString()}
前收盤價: ${marketData.previousClose}
今日最高: ${marketData.dayHigh}
今日最低: ${marketData.dayLow}
52週最高: ${marketData.fiftyTwoWeekHigh}
52週最低: ${marketData.fiftyTwoWeekLow}

請以 JSON 格式回覆，所有內容都使用繁體中文（專業術語可保留英文縮寫），包含以下欄位：
{
  "summary": "簡短市場總結（1-2句話，使用繁體中文）",
  "analysis": "詳細分析（3-5段，使用繁體中文，專業術語如 PE、ROE、EPS、PEG 等可保留英文縮寫）",
  "action": "BUY / SELL / HOLD",
  "risk_level": "Low / Medium / High",
  "bullish_points": ["看多理由1（繁體中文）", "看多理由2（繁體中文）", "看多理由3（繁體中文）"],
  "bearish_points": ["風險警示1（繁體中文）", "風險警示2（繁體中文）", "風險警示3（繁體中文）"]
}

重要提醒：
1. 所有文字內容必須使用繁體中文
2. 專業術語如 PE、ROE、EPS、PEG、PB、PS、ROA、ROE、EBITDA、DCF 等可保留英文縮寫
3. 公司名稱、行業名稱等應使用中文
4. 請確保回覆是有效的 JSON 格式，不要包含任何額外的文字或 markdown 格式
`;

        // 设置 Gemini API 超时
        const geminiTimeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Gemini API 超时')), 30000)
        );
        
        const result = await Promise.race([
            model.generateContent(prompt),
            geminiTimeout
        ]);
        
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
        clearTimeoutSafe();
        
        if (res.headersSent) {
            console.warn('响应已发送，跳过（可能是超时处理已触发）');
            return;
        }
        
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
        clearTimeoutSafe();
        
        if (res.headersSent) {
            console.error('错误发生时响应已发送（可能是超时处理已触发）');
            return;
        }
        
        console.error('分析錯誤:', error);
        console.error('錯誤堆棧:', error.stack);
        console.error('錯誤詳情:', {
            message: error.message,
            name: error.name,
            ticker: ticker,
            hasApiKey: !!apiKey
        });
        
        // 處理超時錯誤
        if (error.message && (error.message.includes('超时') || error.message.includes('timeout') || error.message.includes('TIMEOUT'))) {
            return res.status(504).json({ 
                error: '請求超時，請稍後再試。股票數據獲取或 AI 分析時間過長。' 
            });
        }
        
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

        // 返回詳細錯誤信息
        res.status(500).json({ 
            error: '伺服器錯誤: ' + (error.message || '未知錯誤')
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

