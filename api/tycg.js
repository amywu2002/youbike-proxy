
// 檔名：api/tycg.js
// Vercel Node.js Serverless Function 版本（不宣告 config）
export default async function handler(req, res) {
  // CORS 預檢
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).end();
    return;
  }

  // 你要抓的桃園 Datastore 端點（加上 limit）
  const TARGET =
    "https://opendata.tycg.gov.tw/api/v1/dataset.datastore" +
    "?rid=a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f&limit=10000";

  // 共用 headers（加 UA、關壓縮）
  const commonHeaders = {
    "user-agent": "Mozilla/5.0 (compatible; YouBike-Proxy/1.0; +https://vercel.app)",
    "accept": "application/json, text/plain, */*",
    "accept-encoding": "identity"
  };

  // 簡易的 fetch with timeout
  const fetchWithTimeout = async (url, options = {}, ms = 8000) => {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(id);
    }
  };

  // 簡易 retry：最多 3 次（超時、連線失敗時重試）
  const fetchWithRetry = async (url, options = {}, tries = 3) => {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetchWithTimeout(url, options, 10000);
        if (r.ok) return r;
        // 非 2xx：若是 5xx/429 可再試，其它直接回傳
        if (r.status >= 500 || r.status === 429) {
          await new Promise(s => setTimeout(s, 500 * (i + 1)));
          continue;
        }
        return r;
      } catch (err) {
        lastErr = err;
        // 被 abort / 連線失敗才重試
        await new Promise(s => setTimeout(s, 500 * (i + 1)));
      }
    }
    throw lastErr;
  };

  try {
    const r = await fetchWithRetry(
      TARGET,
      {
        method: "GET",
        headers: commonHeaders,
        redirect: "follow", // 跟隨 30x
        // cache: "no-store"  // 可選；一般不強制
      },
      3
    );

    const text = await r.text(); // 直接轉交文字（來源已是 JSON）
    // 設 CORS 與 JSON Content-Type
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(r.status).send(text);
  } catch (err) {
    // 把錯誤詳細資訊回傳，方便你在瀏覽器就能看到是 timeout / TLS / 其他
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).json({
      error: String(err),
      name: err?.name || null,
      cause: err?.cause ? String(err.cause) : null
    });
  }
}
