import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface AIInsightResult {
  symbol: string;
  signal: 'BUY' | 'HOLD' | 'SELL' | 'STRONG BUY' | 'STRONG SELL';
  confidence: number;
  sentiment: string;
  reasoning: string;
  timestamp: string;
}

const cache: Record<string, { result: AIInsightResult; timestamp: number }> = {};
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function generateAIInsight(symbol: string, exchange: string, retries = 3, delay = 5000): Promise<AIInsightResult> {
  const cacheKey = `${symbol}_${exchange}`;
  if (cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < CACHE_DURATION) {
    return cache[cacheKey].result;
  }

  const prompt = `
    You are an advanced quantitative AI and portfolio manager ("Deep Mind AI ALGO").
    Analyze the current market sentiment, facts, fundamentals, and live news for the ETF/Stock: ${symbol} (Exchange: ${exchange}).
    Determine if this is a BUY, HOLD, SELL, STRONG BUY, or STRONG SELL right now.
    Provide a confidence score (0-100).
    Provide a brief sentiment summary (e.g., "Bullish", "Bearish", "Neutral").
    Provide a detailed reasoning based on recent news, macroeconomic factors, and technical indicators.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        toolConfig: { includeServerSideToolInvocations: true },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            signal: {
              type: Type.STRING,
              enum: ['BUY', 'HOLD', 'SELL', 'STRONG BUY', 'STRONG SELL'],
              description: "The trading signal"
            },
            confidence: {
              type: Type.NUMBER,
              description: "Confidence score from 0 to 100"
            },
            sentiment: {
              type: Type.STRING,
              description: "Short sentiment summary"
            },
            reasoning: {
              type: Type.STRING,
              description: "Detailed reasoning for the signal"
            }
          },
          required: ["signal", "confidence", "sentiment", "reasoning"]
        }
      }
    });

    let result;
    try {
      result = JSON.parse(response.text || "{}");
    } catch (e) {
      console.error("Failed to parse AI insight JSON:", response.text, e);
      result = {};
    }
    
    const insightResult: AIInsightResult = {
      symbol,
      signal: result.signal || 'HOLD',
      confidence: result.confidence || 50,
      sentiment: result.sentiment || 'Neutral',
      reasoning: result.reasoning || 'Insufficient data to form a strong conclusion.',
      timestamp: new Date().toISOString()
    };

    cache[cacheKey] = { result: insightResult, timestamp: Date.now() };
    return insightResult;
  } catch (error: any) {
    if (error.status === 429 && retries > 0) {
      console.warn(`Rate limit hit for ${symbol}. Retrying in ${delay}ms... (${retries} retries left)`);
      await sleep(delay);
      return generateAIInsight(symbol, exchange, retries - 1, delay * 2);
    }
    console.error("Error generating AI insight:", error);
    throw error;
  }
}
