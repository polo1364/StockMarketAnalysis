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

// --- 辅助函数：计算技术指标 ---
function calculateTechnicalIndicators(history) {
    if (!history || history.length < 14) {
        return null;
    }
    
    // 按日期排序（从旧到新）
    const sorted = [...history].sort((a, b) => {
        const dateA = a.date.split('/').map(Number);
        const dateB = b.date.split('/').map(Number);
        const yearA = dateA[0] + 1911;
        const yearB = dateB[0] + 1911;
        if (yearA !== yearB) return yearA - yearB;
        if (dateA[1] !== dateB[1]) return dateA[1] - dateB[1];
        return dateA[2] - dateB[2];
    });
    
    const closes = sorted.map(h => h.close);
    const volumes = sorted.map(h => h.volume);
    const highs = sorted.map(h => h.high);
    const lows = sorted.map(h => h.low);
    
    // 计算移动平均线 (MA)
    const ma5 = calculateMA(closes, 5);
    const ma10 = calculateMA(closes, 10);
    const ma20 = calculateMA(closes, 20);
    
    // 计算RSI (相对强弱指标)
    const rsi = calculateRSI(closes, 14);
    
    // 计算MACD
    const macd = calculateMACD(closes);
    
    // 计算布林带
    const bollinger = calculateBollingerBands(closes, 20);
    
    // 计算成交量移动平均
    const volumeMA = calculateMA(volumes, 20);
    
    // 计算支撑位和阻力位
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

// 计算移动平均线
function calculateMA(data, period) {
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
        const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        result.push(sum / period);
    }
    return result;
}

// 计算RSI
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

// 计算MACD
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

// 计算EMA (指数移动平均)
function calculateEMA(data, period) {
    const multiplier = 2 / (period + 1);
    const result = [data[0]];
    
    for (let i = 1; i < data.length; i++) {
        result.push((data[i] - result[result.length - 1]) * multiplier + result[result.length - 1]);
    }
    
    return result;
}

// 计算布林带
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

// 获取股票历史数据的函数（用于图表显示）
async function fetchStockHistory(ticker, days = 30) {
    const stockCode = ticker.replace(/^0+/, '');
    const stockCodePadded = stockCode.padStart(4, '0');
    
    // 检查是否是 ETF（5位数字代码通常是 ETF）
    const isETF = /^\d{5}$/.test(ticker) || ticker.length === 5;
    
    try {
        // 如果是 ETF，尝试使用 Yahoo Finance 获取历史数据
        if (isETF) {
            console.log(`检测到 ETF: ${ticker}，尝试使用 Yahoo Finance 获取历史数据`);
            
            // 尝试使用 Yahoo Finance API（通过 CORS 代理）
            const symbolsToTry = [
                ticker + '.TW',
                ticker + '.TWO',
                ticker
            ];
            
            for (const symbol of symbolsToTry) {
                try {
                    // 使用 Yahoo Finance Chart API 获取历史数据
                    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1mo`)}`;
                    
                    const response = await httpRequest(proxyUrl, {
                        headers: {
                            'Accept': 'application/json'
                        }
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        const result = data?.chart?.result?.[0];
                        
                        if (result && result.timestamp && result.indicators) {
                            const timestamps = result.timestamp || [];
                            const quotes = result.indicators.quote[0] || {};
                            const closes = quotes.close || [];
                            const opens = quotes.open || [];
                            const highs = quotes.high || [];
                            const lows = quotes.low || [];
                            const volumes = quotes.volume || [];
                            
                            const history = [];
                            for (let i = 0; i < timestamps.length; i++) {
                                const timestamp = timestamps[i];
                                const close = closes[i];
                                const open = opens[i];
                                const high = highs[i];
                                const low = lows[i];
                                const volume = volumes[i];
                                
                                if (close && close > 0) {
                                    const date = new Date(timestamp * 1000);
                                    // 转换为民国年格式：113/12/25
                                    const rocYear = date.getFullYear() - 1911;
                                    const dateStr = `${rocYear}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
                                    
                                    history.push({
                                        date: dateStr,
                                        volume: Math.round(volume || 0),
                                        amount: 0,
                                        open: open || close,
                                        high: high || close,
                                        low: low || close,
                                        close: close,
                                        change: i > 0 ? (close - (closes[i - 1] || close)) : 0,
                                        transactions: 0
                                    });
                                }
                            }
                            
                            if (history.length > 0) {
                                // 只取最近 N 天
                                const recentHistory = history.slice(-days);
                                console.log(`✅ 从 Yahoo Finance 获取 ETF 历史数据成功: ${symbol}, 共 ${recentHistory.length} 天`);
                                return recentHistory;
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Yahoo Finance 获取 ${symbol} 历史数据失败:`, err.message);
                    continue;
                }
            }
        }
        
        // 使用 TWSE API 获取历史数据（普通股票）
        // TWSE STOCK_DAY API 需要指定日期，格式：YYYYMMDD
        const today = new Date();
        let allHistory = [];
        
        // 尝试获取最近3个月的数据（每个月尝试多个日期，因为可能遇到非交易日）
        for (let monthOffset = 0; monthOffset < 3; monthOffset++) {
            const targetDate = new Date(today);
            targetDate.setMonth(targetDate.getMonth() - monthOffset);
            
            // 尝试该月的多个日期（1号、15号、最后一天）
            const datesToTry = [];
            datesToTry.push(`${targetDate.getFullYear()}${String(targetDate.getMonth() + 1).padStart(2, '0')}01`);
            datesToTry.push(`${targetDate.getFullYear()}${String(targetDate.getMonth() + 1).padStart(2, '0')}15`);
            
            // 获取该月最后一天
            const lastDay = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
            datesToTry.push(`${lastDay.getFullYear()}${String(lastDay.getMonth() + 1).padStart(2, '0')}${String(lastDay.getDate()).padStart(2, '0')}`);
            
            for (const monthDate of datesToTry) {
                try {
                    console.log(`尝试获取历史数据: ${stockCodePadded}, 日期: ${monthDate}`);
                    const twseUrl = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${monthDate}&stockNo=${stockCodePadded}`;
                    
                    const response = await httpRequest(twseUrl, {
                        headers: {
                            'Accept': 'application/json'
                        }
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        console.log(`历史数据 API 响应: ${monthDate}, 状态: ${data.stat || 'unknown'}, 消息: ${data.msg || 'N/A'}`);
                        
                        // 检查 API 返回状态
                        if (data.stat && data.stat !== 'OK') {
                            console.log(`API 返回错误状态: ${data.stat}, 消息: ${data.msg || 'N/A'}`);
                            continue;
                        }
                        
                        if (data && data.data && Array.isArray(data.data) && data.data.length > 0) {
                            console.log(`✅ 获取到 ${data.data.length} 条历史数据记录`);
                            
                            // 解析 TWSE 返回的数据格式
                            // 格式: [日期, 成交股數, 成交金額, 開盤價, 最高價, 最低價, 收盤價, 漲跌價差, 成交筆數]
                            const monthHistory = data.data.map(item => {
                                try {
                                    if (!item || !Array.isArray(item) || item.length < 7) {
                                        return null;
                                    }
                                    
                                    return {
                                        date: item[0],
                                        volume: parseInt(String(item[1] || '0').replace(/,/g, '')) || 0,
                                        amount: parseFloat(String(item[2] || '0').replace(/,/g, '')) || 0,
                                        open: parseFloat(String(item[3] || '0').replace(/,/g, '')) || 0,
                                        high: parseFloat(String(item[4] || '0').replace(/,/g, '')) || 0,
                                        low: parseFloat(String(item[5] || '0').replace(/,/g, '')) || 0,
                                        close: parseFloat(String(item[6] || '0').replace(/,/g, '')) || 0,
                                        change: parseFloat(String(item[7] || '0').replace(/,/g, '')) || 0,
                                        transactions: parseInt(String(item[8] || '0').replace(/,/g, '')) || 0
                                    };
                                } catch (e) {
                                    console.error(`解析历史数据项失败:`, item, e);
                                    return null;
                                }
                            }).filter(item => item !== null && item.date);
                            
                            // 过滤掉交易量为0的数据（可能是休市日），但保留价格数据
                            const validHistory = monthHistory.filter(item => item.close > 0);
                            console.log(`有效历史数据: ${validHistory.length} 条（过滤后，原始: ${monthHistory.length} 条）`);
                            
                            // 合并数据，避免重复
                            for (const item of validHistory) {
                                if (!allHistory.find(h => h.date === item.date)) {
                                    allHistory.push(item);
                                }
                            }
                            
                            // 如果已经获取足够的数据，就停止
                            if (allHistory.length >= days) {
                                console.log(`已获取足够的历史数据: ${allHistory.length} 条`);
                                break;
                            }
                            
                            // 如果这个日期成功获取到数据，就不需要尝试该月的其他日期了
                            if (validHistory.length > 0) {
                                break;
                            }
                        } else {
                            console.log(`月份 ${monthDate} 没有数据或数据格式错误`);
                        }
                    } else {
                        console.log(`历史数据 API 返回状态码: ${response.status}`);
                        const errorText = await response.text().catch(() => '');
                        console.log(`错误响应: ${errorText.substring(0, 200)}`);
                    }
                } catch (err) {
                    console.error(`获取 ${monthDate} 的数据失败:`, err.message);
                    continue;
                }
            }
            
            // 如果已经获取足够的数据，就停止
            if (allHistory.length >= days) {
                break;
            }
        }
        
        // 按日期排序（从旧到新）
        allHistory.sort((a, b) => {
            try {
                const dateA = a.date.split('/').map(Number);
                const dateB = b.date.split('/').map(Number);
                // 民国年转西元年比较
                const yearA = dateA[0] + 1911;
                const yearB = dateB[0] + 1911;
                if (yearA !== yearB) return yearA - yearB;
                if (dateA[1] !== dateB[1]) return dateA[1] - dateB[1];
                return dateA[2] - dateB[2];
            } catch (e) {
                return 0;
            }
        });
        
        // 只取最近 N 个交易日
        allHistory = allHistory.slice(-days);
        
        if (allHistory.length > 0) {
            console.log(`✅ 获取历史数据成功: ${stockCodePadded}, 共 ${allHistory.length} 个交易日`);
            return allHistory;
        } else {
            console.log(`⚠️ 无法获取历史数据: ${stockCodePadded}, 所有尝试都失败`);
        }
    } catch (err) {
        console.error(`获取历史数据失败:`, err.message);
        console.error(`错误堆栈:`, err.stack);
    }
    
    // 如果失败，返回空数组
    return [];
}

// 获取股票财务指标的函数（本益比、股息率、股價淨值比等）
async function fetchStockFinancials(ticker) {
    const stockCode = ticker.replace(/^0+/, '');
    const stockCodePadded = stockCode.padStart(4, '0');
    
    try {
        // TWSE 本益比、殖利率及股價淨值比 API
        // API: https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL
        const peUrl = `https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL`;
        
        console.log(`尝试获取本益比: ${stockCodePadded}, URL: ${peUrl}`);
        
        const peResponse = await httpRequest(peUrl, {
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (peResponse.ok) {
            const peData = await peResponse.json();
            console.log(`本益比 API 返回数据，类型: ${Array.isArray(peData) ? '数组' : typeof peData}, 长度: ${Array.isArray(peData) ? peData.length : 'N/A'}`);
            
            if (Array.isArray(peData) && peData.length > 0) {
                // 查看第一个数据项的字段结构（用于调试）
                if (peData[0]) {
                    console.log(`本益比 API 数据示例字段:`, Object.keys(peData[0]));
                }
                
                // 查找匹配的股票（支持多种格式，包括 ETF）
                const stockPE = peData.find(s => {
                    const code = String(s.Code || s.代號 || '').trim();
                    // 尝试多种格式匹配（包括带前导零的格式）
                    return code === stockCodePadded || 
                           code === stockCode || 
                           code === ticker.padStart(4, '0') ||
                           code === ticker.padStart(5, '0') ||
                           code === ticker ||
                           (ticker.length === 5 && code === ticker.substring(1)); // ETF: 00940 -> 0940
                });
                
                if (stockPE) {
                    console.log(`找到股票财务指标数据:`, stockPE);
                    
                    // 解析各种财务指标
                    const pe = parseFloat(String(stockPE.PEratio || stockPE.PE || 0).replace(/,/g, '')) || null;
                    const dividendYield = parseFloat(String(stockPE.DividendYield || stockPE['殖利率'] || 0).replace(/,/g, '')) || null;
                    const pb = parseFloat(String(stockPE.PBratio || stockPE.PB || stockPE['股價淨值比'] || 0).replace(/,/g, '')) || null;
                    
                    console.log(`✅ 获取财务指标成功: ${stockCodePadded}, PE: ${pe}, 股息率: ${dividendYield}, PB: ${pb}`);
                    
                    return {
                        pe: pe && pe > 0 ? pe : null,
                        dividendYield: dividendYield && dividendYield > 0 ? dividendYield : null,
                        pb: pb && pb > 0 ? pb : null
                    };
                } else {
                    console.log(`⚠️ 未找到股票代码 ${stockCodePadded} 的财务指标数据`);
                }
            } else {
                console.log(`⚠️ 本益比 API 返回的数据不是数组或为空`);
            }
        } else {
            console.log(`⚠️ 本益比 API 返回状态码: ${peResponse.status}`);
        }
    } catch (err) {
        console.error(`获取本益比失败:`, err.message);
        console.error(`错误堆栈:`, err.stack);
    }
    
    return { pe: null, dividendYield: null, pb: null };
}

// 获取股票数据的函数（使用多种数据源）
async function fetchStockData(ticker) {
    // 处理台股代号（支持4位和5位数字）
    const stockCode = ticker.replace(/^0+/, ''); // 移除前导零，TWSE API 不需要前导零
    const stockCodePadded = stockCode.padStart(4, '0'); // 补齐到4位
    
    // 方案 1: 使用台湾证券交易所 OpenAPI（官方 API，最可靠）
    let peRatio = null;
    
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
                
                // 解析成交量（移除千分位逗号）
                const volume = parseInt(String(stock.TradeVolume || 0).replace(/,/g, '')) || 0;
                
                // 检查是否是交易日：如果成交量为0或价格异常，可能是休市日
                const isTradingDay = volume > 0 && closingPrice > 0;
                
                if (!isTradingDay) {
                    console.log(`⚠️ 今日可能休市或数据异常: 成交量=${volume}, 价格=${closingPrice}`);
                }
                
                const changePercent = previousClose > 0 && isTradingDay
                    ? ((closingPrice - previousClose) / previousClose * 100)
                    : 0;
                
                const highestPrice = parseFloat(String(stock.HighestPrice || closingPrice).replace(/,/g, '')) || closingPrice;
                const lowestPrice = parseFloat(String(stock.LowestPrice || closingPrice).replace(/,/g, '')) || closingPrice;
                
                // 尝试获取财务指标（本益比、股息率、PB等）
                const financials = await fetchStockFinancials(ticker);
                
                // 获取历史数据来计算 52 週最高/最低（获取过去一年的数据）
                let fiftyTwoWeekHigh = null;
                let fiftyTwoWeekLow = null;
                try {
                    const yearHistory = await fetchStockHistory(ticker, 365); // 获取过去一年的数据
                    if (yearHistory && yearHistory.length > 0) {
                        const prices = yearHistory.map(h => h.close).filter(p => p > 0);
                        if (prices.length > 0) {
                            fiftyTwoWeekHigh = Math.max(...prices);
                            fiftyTwoWeekLow = Math.min(...prices);
                            console.log(`✅ 从历史数据计算 52 週最高/最低: 最高=${fiftyTwoWeekHigh}, 最低=${fiftyTwoWeekLow}`);
                        }
                    }
                } catch (err) {
                    console.error(`计算 52 週最高/最低失败:`, err.message);
                }
                
                return {
                    longName: stock.Name || ticker,
                    shortName: stock.Code || ticker,
                    regularMarketPrice: closingPrice,
                    regularMarketChangePercent: changePercent,
                    trailingPE: financials.pe,
                    dividendYield: financials.dividendYield,
                    pb: financials.pb,
                    marketCap: null,
                    regularMarketVolume: volume,
                    regularMarketPreviousClose: previousClose,
                    regularMarketDayHigh: highestPrice,
                    regularMarketDayLow: lowestPrice,
                    fiftyTwoWeekHigh: fiftyTwoWeekHigh,
                    fiftyTwoWeekLow: fiftyTwoWeekLow
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
                
                // 尝试获取财务指标
                const financials = await fetchStockFinancials(ticker);
                
                // 如果 Yahoo Finance 没有提供 52 週数据，尝试从历史数据计算
                let fiftyTwoWeekHigh = meta.fiftyTwoWeekHigh || null;
                let fiftyTwoWeekLow = meta.fiftyTwoWeekLow || null;
                
                if (!fiftyTwoWeekHigh || !fiftyTwoWeekLow || fiftyTwoWeekHigh === meta.regularMarketPrice) {
                    try {
                        const yearHistory = await fetchStockHistory(ticker, 365);
                        if (yearHistory && yearHistory.length > 0) {
                            const prices = yearHistory.map(h => h.close).filter(p => p > 0);
                            if (prices.length > 0) {
                                fiftyTwoWeekHigh = Math.max(...prices);
                                fiftyTwoWeekLow = Math.min(...prices);
                                console.log(`✅ 从历史数据计算 52 週最高/最低: 最高=${fiftyTwoWeekHigh}, 最低=${fiftyTwoWeekLow}`);
                            }
                        }
                    } catch (err) {
                        console.error(`计算 52 週最高/最低失败:`, err.message);
                    }
                }
                
                return {
                    longName: stockName,
                    shortName: meta.shortName || meta.symbol || ticker,
                    regularMarketPrice: meta.regularMarketPrice,
                    regularMarketChangePercent: changePercent,
                    trailingPE: financials.pe || meta.trailingPE || null,
                    dividendYield: financials.dividendYield || null,
                    pb: financials.pb || null,
                    marketCap: meta.marketCap || null,
                    regularMarketVolume: meta.regularMarketVolume || 0,
                    regularMarketPreviousClose: meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice,
                    regularMarketDayHigh: meta.regularMarketDayHigh || meta.regularMarketPrice,
                    regularMarketDayLow: meta.regularMarketDayLow || meta.regularMarketPrice,
                    fiftyTwoWeekHigh: fiftyTwoWeekHigh || meta.regularMarketPrice,
                    fiftyTwoWeekLow: fiftyTwoWeekLow || meta.regularMarketPrice
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
                    
                    // 尝试获取财务指标
                    const financials = await fetchStockFinancials(ticker);
                    
                    // 如果 Yahoo Finance 没有提供 52 週数据，尝试从历史数据计算
                    let fiftyTwoWeekHigh = meta.fiftyTwoWeekHigh || null;
                    let fiftyTwoWeekLow = meta.fiftyTwoWeekLow || null;
                    
                    if (!fiftyTwoWeekHigh || !fiftyTwoWeekLow || fiftyTwoWeekHigh === meta.regularMarketPrice) {
                        try {
                            const yearHistory = await fetchStockHistory(ticker, 365);
                            if (yearHistory && yearHistory.length > 0) {
                                const prices = yearHistory.map(h => h.close).filter(p => p > 0);
                                if (prices.length > 0) {
                                    fiftyTwoWeekHigh = Math.max(...prices);
                                    fiftyTwoWeekLow = Math.min(...prices);
                                    console.log(`✅ 从历史数据计算 52 週最高/最低: 最高=${fiftyTwoWeekHigh}, 最低=${fiftyTwoWeekLow}`);
                                }
                            }
                        } catch (err) {
                            console.error(`计算 52 週最高/最低失败:`, err.message);
                        }
                    }
                    
                    return {
                        longName: stockName,
                        shortName: meta.shortName || meta.symbol || ticker,
                        regularMarketPrice: meta.regularMarketPrice,
                        regularMarketChangePercent: changePercent,
                        trailingPE: financials.pe || meta.trailingPE || null,
                        dividendYield: financials.dividendYield || null,
                        pb: financials.pb || null,
                        marketCap: meta.marketCap || null,
                        regularMarketVolume: meta.regularMarketVolume || 0,
                        regularMarketPreviousClose: meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice,
                        regularMarketDayHigh: meta.regularMarketDayHigh || meta.regularMarketPrice,
                        regularMarketDayLow: meta.regularMarketDayLow || meta.regularMarketPrice,
                        fiftyTwoWeekHigh: fiftyTwoWeekHigh || meta.regularMarketPrice,
                        fiftyTwoWeekLow: fiftyTwoWeekLow || meta.regularMarketPrice
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
    
    const { ticker, style, styles } = req.body;
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
    
    // 确定要使用的分析风格
    let analysisStyles;
    if (styles && Array.isArray(styles) && styles.length > 0) {
        analysisStyles = styles;
    } else if (style) {
        analysisStyles = [style];
    } else {
        // 默认使用所有4种风格
        analysisStyles = ['價值投資', '短線當沖', '成長型投資', '保守存股'];
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
            dividendYield: quote.dividendYield ? quote.dividendYield.toFixed(2) : 'N/A',
            pb: quote.pb ? quote.pb.toFixed(2) : 'N/A',
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

        // --- 2. 获取历史数据和技术指标 ---
        console.log('正在获取历史数据和技术指标...');
        const stockHistory = await fetchStockHistory(ticker, 60); // 获取60天数据用于技术分析
        const technicalIndicators = stockHistory && stockHistory.length >= 14 ? calculateTechnicalIndicators(stockHistory) : null;
        
        if (technicalIndicators) {
            console.log('技术指标计算完成:', {
                RSI: technicalIndicators.rsi?.toFixed(2),
                MACD: technicalIndicators.macd?.toFixed(2),
                MA5: technicalIndicators.ma5?.toFixed(2),
                MA20: technicalIndicators.ma20?.toFixed(2),
                Support: technicalIndicators.support?.toFixed(2),
                Resistance: technicalIndicators.resistance?.toFixed(2)
            });
        }
        
        // --- 3. 使用 Gemini AI 进行多风格分析 ---
        console.log(`正在使用 Gemini AI 分析股票，風格數量: ${analysisStyles.length}`);
        const genAI = new GoogleGenerativeAI(apiKey);
        
        // 使用 gemini-2.5-flash 模型（最新版本，更快更强）
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        
        // 获取当前日期和时间
        const now = new Date();
        const currentDate = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        
        // 并行分析所有风格
        const analysisPromises = analysisStyles.map(async (currentStyle) => {
            try {
                console.log(`正在分析風格: ${currentStyle}`);
                
                // 构建技术指标说明
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
                
                // 构建提示词（明确要求使用中文和最新数据）
                const prompt = `
你是一位資深專業的股票分析師，擁有20年以上的投資經驗，請使用繁體中文進行深度分析（專業術語如 PE、ROE、EPS、RSI、MACD 等可保留英文縮寫）。

**重要提醒：當前日期為 ${currentDate} ${currentTime}，請使用最新的市場數據和資訊進行分析。請基於最新的價格、成交量、技術指標等進行綜合判斷。**

請根據以下**最新**股票數據，以「${currentStyle}」的投資風格進行專業深度分析：

【基本資料】
股票代號: ${ticker}
公司名稱: ${marketData.name}
當前價格: ${marketData.price}
漲跌幅: ${marketData.change}
本益比 (PE): ${marketData.pe}
市淨率 (PB): ${marketData.pb || 'N/A'}
股息率: ${marketData.dividendYield || 'N/A'}
市值: ${marketData.marketCap.toLocaleString()}
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
  "summary": "簡短市場總結（1-2句話，使用繁體中文，請基於最新數據和當前市場狀況）",
  "analysis": "詳細專業分析（5-8段，使用繁體中文，必須包含：1)基本面分析（財務指標、盈利能力、成長性）2)技術面分析（技術指標解讀、趨勢判斷、關鍵價位）3)市場面分析（行業地位、競爭優勢、市場環境）4)風險評估（系統性風險、個股風險、流動性風險）5)投資建議（具體操作建議、時機選擇）",
  "action": "買進 / 賣出 / 持有",
  "risk_level": "高 / 中 / 低",
  "target_price": "目標價位（具體數字，例如：1600-1650）",
  "stop_loss": "止損價位（具體數字，例如：1450）",
  "time_horizon": "投資時程建議（例如：短期1-3個月 / 中期3-6個月 / 長期6-12個月）",
  "position_sizing": "建議倉位配置（例如：輕倉10-20% / 中倉30-40% / 重倉50%以上）",
  "bullish_points": ["看多理由1（繁體中文，基於最新數據和技術分析，必須具體）", "看多理由2（繁體中文，必須具體）", "看多理由3（繁體中文，必須具體）", "看多理由4（繁體中文，必須具體）"],
  "bearish_points": ["風險警示1（繁體中文，基於最新數據和技術分析，必須具體）", "風險警示2（繁體中文，必須具體）", "風險警示3（繁體中文，必須具體）"],
  "key_levels": {
    "support": "關鍵支撐位（具體數字）",
    "resistance": "關鍵阻力位（具體數字）",
    "breakout": "突破價位（具體數字，如果適用）"
  },
  "industry_comparison": "行業對比分析（與同業比較PE、PB、成長性等，繁體中文）",
  "catalyst": "潛在催化劑（可能影響股價的重大事件或因素，繁體中文）"
}

重要提醒：
1. 所有文字內容必須使用繁體中文
2. 專業術語如 PE、ROE、EPS、PEG、PB、PS、ROA、EBITDA、DCF、RSI、MACD、MA、KD、布林帶等可保留英文縮寫
3. 公司名稱、行業名稱等應使用中文
4. 請確保回覆是有效的 JSON 格式，不要包含任何額外的文字或 markdown 格式
5. **請基於當前日期 ${currentDate} 的最新市場數據進行分析，考慮最新的價格走勢、成交量變化等技術指標**
6. **分析時請考慮最新的市場動態、行業趨勢和公司基本面變化**
7. **請特別強調「${currentStyle}」投資風格的觀點和建議，並提供具體的操作建議**
8. **必須提供具體的目標價、止損價和關鍵價位，不能只說「建議關注」等模糊表述**
9. **分析必須深入專業，包含基本面、技術面、市場面的綜合判斷**
10. **風險評估必須具體明確，不能泛泛而談**
`;

        // 设置 Gemini API 超时（增加到45秒，因为分析更复杂）
        const geminiTimeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Gemini API 超时')), 45000)
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
            // 尝试找到JSON对象（使用非贪婪匹配，找到第一个完整的JSON对象）
            const jsonMatch = aiText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                let jsonStr = jsonMatch[0];
                
                // 使用更简单的方法：转义字符串值中的所有控制字符
                // 这个方法会正确处理JSON字符串值中的换行符等
                let inString = false;
                let escaped = false;
                let result = '';
                
                for (let i = 0; i < jsonStr.length; i++) {
                    const char = jsonStr[i];
                    
                    if (escaped) {
                        result += char;
                        escaped = false;
                        continue;
                    }
                    
                    if (char === '\\') {
                        result += char;
                        escaped = true;
                        continue;
                    }
                    
                    if (char === '"') {
                        inString = !inString;
                        result += char;
                        continue;
                    }
                    
                    if (inString) {
                        // 在字符串值中，转义控制字符
                        if (char === '\n') result += '\\n';
                        else if (char === '\r') result += '\\r';
                        else if (char === '\t') result += '\\t';
                        else if (char === '\f') result += '\\f';
                        else if (char === '\b') result += '\\b';
                        else if (char === '\v') result += '\\v';
                        else if (char.charCodeAt(0) < 32) {
                            // 其他控制字符，转换为Unicode转义
                            result += '\\u' + ('0000' + char.charCodeAt(0).toString(16)).slice(-4);
                        } else {
                            result += char;
                        }
                    } else {
                        // 在JSON结构外，移除或替换控制字符
                        if (char === '\n' || char === '\r' || char === '\t') {
                            result += ' ';
                        } else if (char.charCodeAt(0) < 32) {
                            // 忽略其他控制字符
                        } else {
                            result += char;
                        }
                    }
                }
                
                // 尝试解析
                aiAnalysis = JSON.parse(result);
            } else {
                throw new Error('無法找到 JSON');
            }
        } catch (parseError) {
            console.error(`解析 ${currentStyle} 風格分析失敗:`, parseError.message);
            console.error(`原始回應前500字符:`, aiText.substring(0, 500));
            
            // 尝试更宽松的解析方式
            try {
                // 尝试修复常见的JSON问题
                let fixedJson = aiText
                    .replace(/\n/g, ' ')
                    .replace(/\r/g, ' ')
                    .replace(/\t/g, ' ')
                    .replace(/,(\s*[}\]])/g, '$1')  // 移除尾随逗号
                    .replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":'); // 给未引用的键加引号
                
                const jsonMatch2 = fixedJson.match(/\{[\s\S]*\}/);
                if (jsonMatch2) {
                    aiAnalysis = JSON.parse(jsonMatch2[0]);
                    console.log(`使用修复后的JSON解析成功`);
                } else {
                    throw new Error('無法修復 JSON');
                }
            } catch (fixError) {
                // 如果还是失败，返回默认值
                aiAnalysis = {
                    summary: "AI 分析暫時無法取得，請稍後再試。",
                    analysis: `無法解析 AI 回應。錯誤: ${parseError.message}。原始回應: ${aiText.substring(0, 200)}...`,
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
                
                return aiAnalysis;
            } catch (err) {
                console.error(`分析風格 ${currentStyle} 失敗:`, err.message);
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
        });

        // --- 3. 获取历史数据（用于图表，如果之前没有获取或需要更多数据） ---
        const chartHistory = stockHistory && stockHistory.length >= 30 ? stockHistory.slice(-30) : await fetchStockHistory(ticker, 30);
        
        // --- 4. 等待所有分析完成 ---
        const analyses = await Promise.all(analysisPromises);
        
        // --- 5. 返回結果 ---
        clearTimeoutSafe();
        
        if (res.headersSent) {
            console.warn('响应已发送，跳过（可能是超时处理已触发）');
            return;
        }
        
        // 如果只有一个风格，保持向后兼容
        if (analysisStyles.length === 1) {
            const singleAnalysis = analyses[0] || {};
            res.json({
                market_data: marketData,
                technical_indicators: technicalIndicators,
                summary: singleAnalysis.summary,
                analysis: singleAnalysis.analysis,
                action: singleAnalysis.action,
                risk_level: singleAnalysis.risk_level,
                target_price: singleAnalysis.target_price,
                stop_loss: singleAnalysis.stop_loss,
                time_horizon: singleAnalysis.time_horizon,
                position_sizing: singleAnalysis.position_sizing,
                bullish_points: singleAnalysis.bullish_points,
                bearish_points: singleAnalysis.bearish_points,
                key_levels: singleAnalysis.key_levels,
                industry_comparison: singleAnalysis.industry_comparison,
                catalyst: singleAnalysis.catalyst,
                history: chartHistory
            });
        } else {
            // 多个风格，返回所有分析结果
            const formattedAnalyses = analyses.map((analysis, index) => ({
                style: analysisStyles[index],
                summary: analysis.summary || '分析中...',
                analysis: analysis.analysis || '分析中...',
                action: analysis.action || '持有',
                risk_level: analysis.risk_level || '中',
                target_price: analysis.target_price || 'N/A',
                stop_loss: analysis.stop_loss || 'N/A',
                time_horizon: analysis.time_horizon || 'N/A',
                position_sizing: analysis.position_sizing || 'N/A',
                bullish_points: analysis.bullish_points || [],
                bearish_points: analysis.bearish_points || [],
                key_levels: analysis.key_levels || {},
                industry_comparison: analysis.industry_comparison || 'N/A',
                catalyst: analysis.catalyst || 'N/A'
            }));
            
            console.log(`返回 ${formattedAnalyses.length} 个风格的分析结果`);
            
            res.json({
                market_data: marketData,
                technical_indicators: technicalIndicators,
                analyses: formattedAnalyses,
                history: chartHistory
            });
        }

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

