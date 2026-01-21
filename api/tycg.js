
// 檔名：api/tycg.js（CommonJS 版；不用 package.json）
// Node.js Serverless Function；對桃園來源放寬 TLS 驗證（僅此來源）

const { Agent } = require('undici');

const insecureAgent = new Agent({
  connect: { rejectUnauthorized: false } // 放寬 TLS 驗證（只用在這個 dispatcher）
});

const UA = "Mozilla/5.0 (compatible; YouBike-Proxy/1.0; +https://vercel.app)";
const COMMON_HEADERS = {
  "user-agent": UA,
  "accept": "application/json, text/plain, */*",
  "accept-encoding": "identity"
};

const TY_NEW = "https://opendata.tycg.gov.tw/api/v1/dataset.datastore?rid=a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f&limit=10000";
const TY_OLD = "https://data.tycg.gov.tw/api/v1/rest/datastore/a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f?format=json";

module.exports = async function handler(req, res) {
  // CORS 預檢
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).end();
    return;
  }

  const fetchWithTimeout = async (url, ms = 12000) => {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, {
        method: "GET",
        headers: COMMON_HEADERS,
        redirect: "follow",
        dispatcher: insecureAgent, // 關鍵：使用 undici Agent 放寬 TLS
        signal: ctrl.signal
      });
    } finally {
      clearTimeout(id);
    }
  };

  const trySources = async () => {
    const sources = [TY_NEW, TY_OLD];
    let lastErr;
    for (const url of sources) {
      try {
        const r = await fetchWithTimeout(url);
        if (r.ok) return { r, url };
        if (r.status >= 500 || r.status === 429) {
          await new Promise(s => setTimeout(s, 500));
          continue;
        }
        return { r, url };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  };

  try {
    const { r, url } = await trySources();
    const text = await r.text();

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("X-Source", url);
    res.status(r.status).send(text);
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).json({
      error: String(err),
      name: err?.name || null,
      cause: err?.cause ? String(err.cause) : null
    });
  }
};
