const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// FinMind API 配置
const FINMIND_API_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJkYXRlIjoiMjAyNi0wMS0wNyAxODo1Njo0OSIsInVzZXJfaWQiOiJwb2xvMTM2NCIsImVtYWlsIjoicmlnaHQ4MDYyNkBob3RtYWlsLmNvbSIsImlwIjoiNDkuMTU5LjIwOS41OSJ9.WdjSDnee45a_EHlwd7GPAtYu8yNb58ysi4_BxWNRzr4';
const FINMIND_API_BASE_URL = 'https://api.finmindtrade.com/api/v4/data';

// 中間件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ========== 技術指標計算函數 ==========
function calculateMA(data, period) {
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
        const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        result.push(sum / period);
    }
    return result;
}

function calculateRSI(prices, period = 14) {
    const result = [];
    const gains = [];
    const losses = [];
    
    for (let i = 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? -change : 0);
    }
    
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
        
        const rs = avgGain / (avgLoss || 0.0001);
        const rsi = 100 - (100 / (1 + rs));
        result.push(rsi);
    }
    
    return result;
}

function calculateEMA(data, period) {
    const multiplier = 2 / (period + 1);
    const result = [data[0]];
    
    for (let i = 1; i < data.length; i++) {
        result.push((data[i] - result[result.length - 1]) * multiplier + result[result.length - 1]);
    }
    
    return result;
}

function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const emaFast = calculateEMA(prices, fastPeriod);
    const emaSlow = calculateEMA(prices, slowPeriod);
    
    const macdLine = [];
    const minLength = Math.min(emaFast.length, emaSlow.length);
    for (let i = 0; i < minLength; i++) {
        macdLine.push(emaFast[emaFast.length - minLength + i] - emaSlow[emaSlow.length - minLength + i]);
    }
    
    const signalLine = calculateEMA(macdLine, signalPeriod);
    const histogram = [];
    const signalLength = signalLine.length;
    for (let i = 0; i < signalLength; i++) {
        histogram.push(macdLine[macdLine.length - signalLength + i] - signalLine[i]);
    }
    
    return { macd: macdLine, signal: signalLine, histogram };
}

function calculateBollingerBands(prices, period = 20, stdDev = 2) {
    const ma = calculateMA(prices, period);
    const result = { upper: [], middle: ma, lower: [] };
    
    for (let i = period - 1; i < prices.length; i++) {
        const slice = prices.slice(i - period + 1, i + 1);
        const mean = ma[ma.length - (prices.length - i)];
        const variance = slice.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / period;
        const standardDeviation = Math.sqrt(variance);
        
        result.upper.push(mean + (stdDev * standardDeviation));
        result.lower.push(mean - (stdDev * standardDeviation));
    }
    
    return result;
}

function calculateTechnicalIndicators(history) {
    if (!history || history.length < 14) {
        return null;
    }
    
    const sorted = [...history].sort((a, b) => {
        const dateA = a.date.split('/').map(Number);
        const dateB = b.date.split('/').map(Number);
        const yearA = dateA[0] + 1911;
        const yearB = dateB[0] + 1911;
        if (yearA !== yearB) return yearA - yearB;
        if (dateA[1] !== dateB[1]) return dateA[1] - dateB[1];
        return dateA[2] - dateB[2];
    });
    
    const closes = sorted.map(h => parseFloat(h.close) || 0);
    const volumes = sorted.map(h => parseInt(h.volume) || 0);
    const highs = sorted.map(h => parseFloat(h.high) || 0);
    const lows = sorted.map(h => parseFloat(h.low) || 0);
    
    const ma5 = calculateMA(closes, 5);
    const ma10 = calculateMA(closes, 10);
    const ma20 = calculateMA(closes, 20);
    const rsi = calculateRSI(closes, 14);
    const macd = calculateMACD(closes);
    const bollinger = calculateBollingerBands(closes, 20);
    const volumeMA = calculateMA(volumes, 20);
    
    const support = Math.min(...lows.slice(-20));
    const resistance = Math.max(...highs.slice(-20));
    
    return {
        ma5: ma5[ma5.length - 1],
        ma10: ma10[ma10.length - 1],
        ma20: ma20[ma20.length - 1],
        rsi: rsi[rsi.length - 1],
        macd: macd.macd[macd.macd.length - 1],
        signal: macd.signal[macd.signal.length - 1],
        histogram: macd.histogram[macd.histogram.length - 1],
        bollingerUpper: bollinger.upper[bollinger.upper.length - 1],
        bollingerMiddle: bollinger.middle[bollinger.middle.length - 1],
        bollingerLower: bollinger.lower[bollinger.lower.length - 1],
        volumeMA: volumeMA[volumeMA.length - 1],
        support: support,
        resistance: resistance,
        currentPrice: closes[closes.length - 1]
    };
}

// ========== FinMind API 調用函數 ==========
async function fetchFromFinMind(dataset, stockCode, startDate, endDate) {
    const url = `${FINMIND_API_BASE_URL}?dataset=${dataset}&data_id=${stockCode}&start_date=${startDate}&end_date=${endDate}&token=${FINMIND_API_TOKEN}`;
    
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`FinMind API 錯誤: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.status !== 200) {
        throw new Error(`FinMind API 錯誤: ${data.msg || '未知錯誤'}`);
    }
    
    return data.data || [];
}

async function fetchStockFinancials(ticker) {
    // 處理股票代碼：保留 5 位數 ETF 代碼（如 00940），4 位數補零
    const cleanTicker = ticker.replace(/\s/g, '').toUpperCase();
    const stockCode = cleanTicker.length >= 5 ? cleanTicker : cleanTicker.replace(/^0+/, '').padStart(4, '0');
    
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setFullYear(endDate.getFullYear() - 1);
        
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        
        let pe = null, dividendYield = null, pb = null;
        
        // 獲取本益比、殖利率、股價淨值比（從 TaiwanStockPER）
        try {
            const perData = await fetchFromFinMind('TaiwanStockPER', stockCode, startDateStr, endDateStr);
            if (perData && perData.length > 0) {
                const latestPER = perData[perData.length - 1];
                console.log(`TaiwanStockPER 資料欄位:`, Object.keys(latestPER));
                console.log(`TaiwanStockPER 最新資料:`, JSON.stringify(latestPER));
                
                // 本益比
                pe = parseFloat(latestPER.PER || latestPER.per || latestPER.PE_ratio || latestPER.pe_ratio || 0);
                
                // 殖利率
                const dyValue = parseFloat(latestPER.dividend_yield || latestPER.DividendYield || latestPER.Dividend_Yield || 0);
                if (dyValue > 0) {
                    dividendYield = dyValue;
                    console.log(`殖利率: ${dyValue}%`);
                }
                
                // 股價淨值比
                pb = parseFloat(latestPER.PBR || latestPER.pbr || latestPER.PB_ratio || latestPER.pb_ratio || 0);
            }
        } catch (err) {
            console.error('獲取 TaiwanStockPER 失敗:', err.message);
        }
        
        // 如果沒有殖利率，從股利政策計算
        if (!dividendYield || dividendYield <= 0) {
            try {
                const dividendData = await fetchFromFinMind('TaiwanStockDividend', stockCode, startDateStr, endDateStr);
                if (dividendData && dividendData.length > 0) {
                    const latestDividend = dividendData[dividendData.length - 1];
                    console.log('TaiwanStockDividend 資料欄位:', Object.keys(latestDividend));
                    console.log('TaiwanStockDividend 最新資料:', JSON.stringify(latestDividend));
                    
                    const cashDividend = parseFloat(
                        latestDividend.CashEarningsDistribution || 
                        latestDividend.cash_dividend || 
                        latestDividend.CashDividend ||
                        latestDividend.cash_earnings_distribution ||
                        0
                    );
                    if (cashDividend > 0) {
                        dividendYield = cashDividend; // 暫存現金股利，稍後用股價計算殖利率
                        console.log(`現金股利: ${cashDividend}`);
                    }
                }
            } catch (err) {
                console.error('獲取股息資料失敗:', err.message);
            }
        }
        
        
        return {
            pe: pe && pe > 0 ? pe : null,
            dividendYield: dividendYield && dividendYield > 0 ? dividendYield : null,
            pb: pb && pb > 0 ? pb : null
        };
    } catch (err) {
        console.error('獲取財務指標失敗:', err);
        return { pe: null, dividendYield: null, pb: null };
    }
}

async function fetchStockHistory(ticker, days = 30) {
    // 處理股票代碼：保留 5 位數 ETF 代碼（如 00940），4 位數補零
    const cleanTicker = ticker.replace(/\s/g, '').toUpperCase();
    const stockCode = cleanTicker.length >= 5 ? cleanTicker : cleanTicker.replace(/^0+/, '').padStart(4, '0');
    
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days * 2);
        
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        
        const priceData = await fetchFromFinMind('TaiwanStockPrice', stockCode, startDateStr, endDateStr);
        
        if (!priceData || priceData.length === 0) {
            return [];
        }
        
        const allHistory = priceData.map(item => {
            try {
                const date = new Date(item.date || item.Date);
                const rocYear = date.getFullYear() - 1911;
                const dateStr = `${rocYear}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
                
                const close = parseFloat(item.close || item.Close || 0) || 0;
                const open = parseFloat(item.open || item.Open || close) || close;
                const high = parseFloat(item.max || item.Max || item.high || item.High || close) || close;
                const low = parseFloat(item.min || item.Min || item.low || item.Low || close) || close;
                const volume = parseInt(item.Trading_Volume || item.trading_volume || item.volume || 0) || 0;
                
                return {
                    date: dateStr,
                    volume: volume,
                    amount: 0,
                    open: open,
                    high: high,
                    low: low,
                    close: close,
                    change: 0,
                    transactions: 0
                };
            } catch (e) {
                return null;
            }
        }).filter(item => item !== null && item.close > 0);
        
        // 計算漲跌
        for (let i = 1; i < allHistory.length; i++) {
            allHistory[i].change = allHistory[i].close - allHistory[i - 1].close;
        }
        
        // 排序
        allHistory.sort((a, b) => {
            const dateA = a.date.split('/').map(Number);
            const dateB = b.date.split('/').map(Number);
            const yearA = dateA[0] + 1911;
            const yearB = dateB[0] + 1911;
            if (yearA !== yearB) return yearA - yearB;
            if (dateA[1] !== dateB[1]) return dateA[1] - dateB[1];
            return dateA[2] - dateB[2];
        });
        
        return allHistory.slice(-days);
    } catch (err) {
        console.error('獲取歷史數據失敗:', err);
        return [];
    }
}

async function fetchStockData(ticker) {
    // 處理股票代碼：保留 5 位數 ETF 代碼（如 00940），4 位數補零
    const cleanTicker = ticker.replace(/\s/g, '').toUpperCase();
    const stockCode = cleanTicker.length >= 5 ? cleanTicker : cleanTicker.replace(/^0+/, '').padStart(4, '0');
    
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 30);
        
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        
        const priceData = await fetchFromFinMind('TaiwanStockPrice', stockCode, startDateStr, endDateStr);
        
        if (!priceData || priceData.length === 0) {
            return null;
        }
        
        const latestPrice = priceData[priceData.length - 1];
        const previousPrice = priceData.length > 1 ? priceData[priceData.length - 2] : latestPrice;
        
        const closingPrice = parseFloat(latestPrice.close || latestPrice.Close || 0) || 0;
        const previousClose = parseFloat(previousPrice.close || previousPrice.Close || closingPrice) || closingPrice;
        const volume = parseInt(latestPrice.Trading_Volume || latestPrice.trading_volume || latestPrice.volume || 0) || 0;
        const highestPrice = parseFloat(latestPrice.max || latestPrice.Max || latestPrice.high || latestPrice.High || closingPrice) || closingPrice;
        const lowestPrice = parseFloat(latestPrice.min || latestPrice.Min || latestPrice.low || latestPrice.Low || closingPrice) || closingPrice;
        
        const isTradingDay = volume > 0 && closingPrice > 0;
        const changePercent = previousClose > 0 && isTradingDay
            ? ((closingPrice - previousClose) / previousClose * 100)
            : 0;
        
        // 獲取股票名稱
        let stockName = stockCode;
        try {
            const infoUrl = `${FINMIND_API_BASE_URL}?dataset=TaiwanStockInfo&token=${FINMIND_API_TOKEN}`;
            const infoResponse = await fetch(infoUrl);
            if (infoResponse.ok) {
                const infoData = await infoResponse.json();
                if (infoData.status === 200 && infoData.data && infoData.data.length > 0) {
                    const stockInfo = infoData.data.find(s => String(s.stock_id || '').trim() === stockCode);
                    if (stockInfo) {
                        stockName = stockInfo.stock_name || stockInfo.name || stockCode;
                    }
                }
            }
        } catch (err) {
            console.error('獲取股票名稱失敗:', err.message);
        }
        
        // 獲取財務指標
        const financials = await fetchStockFinancials(ticker);
        
        // 計算股息率（如果有現金股利數據）
        let dividendYield = financials.dividendYield;
        if (dividendYield && closingPrice > 0) {
            dividendYield = (dividendYield / closingPrice) * 100;
        }
        
        // 獲取 52 週高低
        let fiftyTwoWeekHigh = closingPrice, fiftyTwoWeekLow = closingPrice;
        try {
            const yearHistory = await fetchStockHistory(ticker, 250);
            if (yearHistory && yearHistory.length > 0) {
                const prices = yearHistory.map(h => parseFloat(h.close)).filter(p => p > 0);
                if (prices.length > 0) {
                    fiftyTwoWeekHigh = Math.max(...prices);
                    fiftyTwoWeekLow = Math.min(...prices);
                }
            }
        } catch (err) {
            console.error('計算52週最高/最低失敗:', err.message);
        }
        
        return {
            longName: stockName,
            shortName: stockCode,
            regularMarketPrice: closingPrice,
            regularMarketChangePercent: changePercent,
            trailingPE: financials.pe,
            dividendYield: dividendYield,
            pb: financials.pb,
            marketCap: null,
            regularMarketVolume: volume,
            regularMarketPreviousClose: previousClose,
            regularMarketDayHigh: highestPrice,
            regularMarketDayLow: lowestPrice,
            fiftyTwoWeekHigh: fiftyTwoWeekHigh,
            fiftyTwoWeekLow: fiftyTwoWeekLow
        };
    } catch (err) {
        console.error('獲取股票數據失敗:', err);
        return null;
    }
}

// ========== Gemini AI 分析 ==========
async function analyzeWithGemini(marketData, technicalIndicators, style, ticker, apiKey) {
    try {
        const now = new Date();
        const currentDate = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        
        let technicalInfo = '';
        if (technicalIndicators) {
            technicalInfo = `
技術指標分析：
- RSI (相對強弱指標): ${technicalIndicators.rsi?.toFixed(2)} ${technicalIndicators.rsi > 70 ? '(超買)' : technicalIndicators.rsi < 30 ? '(超賣)' : '(正常)'}
- MACD: ${technicalIndicators.macd?.toFixed(2)}, 信號線: ${technicalIndicators.signal?.toFixed(2)}, 柱狀圖: ${technicalIndicators.histogram?.toFixed(2)}
- 移動平均線: MA5=${technicalIndicators.ma5?.toFixed(2)}, MA10=${technicalIndicators.ma10?.toFixed(2)}, MA20=${technicalIndicators.ma20?.toFixed(2)}
- 布林帶: 上軌=${technicalIndicators.bollingerUpper?.toFixed(2)}, 中軌=${technicalIndicators.bollingerMiddle?.toFixed(2)}, 下軌=${technicalIndicators.bollingerLower?.toFixed(2)}
- 技術支撐位: ${technicalIndicators.support?.toFixed(2)}
- 技術阻力位: ${technicalIndicators.resistance?.toFixed(2)}
- 當前價格相對位置: ${((marketData.price - technicalIndicators.support) / (technicalIndicators.resistance - technicalIndicators.support) * 100).toFixed(1)}%
`;
        }
        
        const prompt = `
你是一位資深專業的股票分析師，擁有20年以上的投資經驗，請使用繁體中文進行深度分析（專業術語如 PE、ROE、EPS、RSI、MACD 等可保留英文縮寫）。

**重要提醒：當前日期為 ${currentDate} ${currentTime}，請使用最新的市場數據和資訊進行分析。**

請根據以下**最新**股票數據，以「${style}」的投資風格進行專業深度分析：

【基本資料】
股票代號: ${ticker}
公司名稱: ${marketData.name}
當前價格: ${marketData.price}
漲跌幅: ${marketData.change}
本益比 (PE): ${marketData.pe || 'N/A'}
市淨率 (PB): ${marketData.pb || 'N/A'}
股息率: ${marketData.dividendYield ? marketData.dividendYield.toFixed(2) + '%' : 'N/A'}
市值: ${marketData.marketCap ? marketData.marketCap.toLocaleString() : 'N/A'}
成交量: ${marketData.volume.toLocaleString()}
前收盤價: ${marketData.previousClose}
今日最高: ${marketData.dayHigh}
今日最低: ${marketData.dayLow}
52週最高: ${marketData.fiftyTwoWeekHigh}
52週最低: ${marketData.fiftyTwoWeekLow}

${technicalInfo}

【分析要求】
請以 JSON 格式回覆，所有內容都使用繁體中文（專業術語可保留英文縮寫），包含以下欄位：
{
  "summary": "簡短市場總結（1-2句話）",
  "analysis": "詳細專業分析（2-4段）",
  "action": "買進 / 賣出 / 持有",
  "risk_level": "高 / 中 / 低",
  "target_price": "目標價位（具體數字）",
  "stop_loss": "止損價位（具體數字）",
  "time_horizon": "投資時程建議",
  "position_sizing": "建議倉位配置",
  "bullish_points": ["看多理由1", "看多理由2", "看多理由3"],
  "bearish_points": ["風險警示1", "風險警示2"],
  "key_levels": {
    "support": "關鍵支撐位",
    "resistance": "關鍵阻力位",
    "breakout": "突破價位"
  },
  "industry_comparison": "行業對比分析",
  "catalyst": "潛在催化劑"
}

重要提醒：
1. 所有文字內容必須使用繁體中文
2. 請確保回覆是有效的 JSON 格式
3. 請特別強調「${style}」投資風格的觀點
4. 必須提供具體的目標價、止損價
`;

        // 嘗試多個 Gemini API 端點
        // 使用 Gemini 2.5 Flash
        const apiEndpoints = [
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`,
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
        ];
        
        let response = null;
        let lastError = null;
        
        for (let i = 0; i < apiEndpoints.length; i++) {
            try {
                const apiUrl = apiEndpoints[i];
                console.log(`嘗試 Gemini API 端點 ${i + 1}: ${apiUrl.split('?')[0]}`);
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000);
                
                response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }]
                    }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (response.ok) {
                    console.log(`✅ Gemini API 端點 ${i + 1} 成功`);
                    break;
                } else {
                    const errorData = await response.json().catch(() => ({}));
                    const errorMsg = errorData.error?.message || response.statusText;
                    console.warn(`❌ 端點 ${i + 1} 失敗: ${errorMsg}`);
                    lastError = new Error(`Gemini API 錯誤: ${errorMsg}`);
                    // 繼續嘗試下一個端點
                    continue;
                }
            } catch (err) {
                lastError = err;
                console.warn(`❌ 端點 ${i + 1} 異常:`, err.message);
                // 繼續嘗試下一個端點
                continue;
            }
        }
        
        if (!response || !response.ok) {
            throw lastError || new Error('所有 Gemini API 端點都失敗');
        }
        
        const result = await response.json();
        let aiText = '';
        
        if (result.candidates?.[0]?.content?.parts) {
            aiText = result.candidates[0].content.parts.map(part => part.text).join('').trim();
        } else {
            throw new Error('Gemini API 回應格式錯誤');
        }
        
        aiText = aiText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            let jsonStr = jsonMatch[0];
            // 清理 JSON 字串
            jsonStr = jsonStr.replace(/[\n\r\t]/g, ' ').replace(/\s+/g, ' ');
            return JSON.parse(jsonStr);
        }
        
        throw new Error('無法找到 JSON');
    } catch (err) {
        console.error(`分析風格 ${style} 失敗:`, err.message);
        return {
            summary: "分析失敗，請稍後再試。",
            analysis: `無法獲取分析結果。錯誤: ${err.message}`,
            action: "持有",
            risk_level: "中",
            target_price: "N/A",
            stop_loss: "N/A",
            time_horizon: "N/A",
            position_sizing: "N/A",
            bullish_points: [],
            bearish_points: [],
            key_levels: {},
            industry_comparison: "N/A",
            catalyst: "N/A"
        };
    }
}

// ========== API 路由 ==========

// 分析股票 API
app.post('/api/analyze', async (req, res) => {
    try {
        const { ticker, apiKey } = req.body;
        
        if (!ticker) {
            return res.status(400).json({ error: '請提供股票代號' });
        }
        
        if (!apiKey) {
            return res.status(400).json({ error: '請提供 Gemini API Key' });
        }
        
        console.log(`開始分析股票: ${ticker}`);
        
        // 獲取股票數據
        const stockData = await fetchStockData(ticker);
        if (!stockData) {
            return res.status(404).json({ error: '找不到股票數據' });
        }
        
        console.log(`股票數據獲取成功: ${stockData.longName}`);
        
        // 獲取歷史數據
        const history = await fetchStockHistory(ticker, 30);
        console.log(`歷史數據: ${history.length} 筆`);
        
        // 計算技術指標
        const technicalIndicators = calculateTechnicalIndicators(history);
        
        // 準備市場數據
        const marketData = {
            name: stockData.longName,
            price: stockData.regularMarketPrice,
            change: `${stockData.regularMarketChangePercent >= 0 ? '+' : ''}${stockData.regularMarketChangePercent.toFixed(2)}%`,
            pe: stockData.trailingPE,
            pb: stockData.pb,
            dividendYield: stockData.dividendYield,
            marketCap: stockData.marketCap || 0,
            volume: stockData.regularMarketVolume,
            previousClose: stockData.regularMarketPreviousClose,
            dayHigh: stockData.regularMarketDayHigh,
            dayLow: stockData.regularMarketDayLow,
            fiftyTwoWeekHigh: stockData.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: stockData.fiftyTwoWeekLow
        };
        
        // 執行 AI 分析（四種風格）
        const styles = ['價值投資', '短線當沖', '成長型投資', '保守存股'];
        const analyses = [];
        
        for (const style of styles) {
            console.log(`分析風格: ${style}`);
            const analysis = await analyzeWithGemini(marketData, technicalIndicators, style, ticker, apiKey);
            analyses.push(analysis);
        }
        
        // 返回結果
        res.json({
            marketData,
            analyses,
            history,
            technicalIndicators,
            styles
        });
        
    } catch (err) {
        console.error('分析錯誤:', err);
        res.status(500).json({ error: err.message || '伺服器錯誤' });
    }
});

// 獲取股票數據 API
app.get('/api/stock/:ticker', async (req, res) => {
    try {
        const { ticker } = req.params;
        const stockData = await fetchStockData(ticker);
        
        if (!stockData) {
            return res.status(404).json({ error: '找不到股票數據' });
        }
        
        res.json(stockData);
    } catch (err) {
        console.error('獲取股票數據錯誤:', err);
        res.status(500).json({ error: err.message || '伺服器錯誤' });
    }
});

// 獲取歷史數據 API
app.get('/api/history/:ticker', async (req, res) => {
    try {
        const { ticker } = req.params;
        const days = parseInt(req.query.days) || 30;
        const history = await fetchStockHistory(ticker, days);
        
        res.json(history);
    } catch (err) {
        console.error('獲取歷史數據錯誤:', err);
        res.status(500).json({ error: err.message || '伺服器錯誤' });
    }
});

// 首頁
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 啟動伺服器
app.listen(PORT, '0.0.0.0', () => {
    console.log(`伺服器運行於 port ${PORT}`);
    console.log('使用 FinMind API 獲取台股數據');
    console.log('環境:', process.env.NODE_ENV || 'development');
});

