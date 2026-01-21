
// 檔名：api/tycg.js
// Node.js Serverless Function（Zero‑Config）。無外部 import，減少崩潰點。

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

  // 來源端點（先新平台，失敗再回舊平台）
  const TY_NEW =
    "https://opendata.tycg.gov.tw/api/v1/dataset.datastore?rid=a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f&limit=10000";
  const TY_OLD =
    "https://data.tycg.gov.tw/api/v1/rest/datastore/a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f?format=json";

  const H = {
    "user-agent": "Mozilla/5.0 (compatible; YouBike-Proxy/1.0; +https://vercel.app)",
    accept: "application/json, text/plain, */*",
    "accept-encoding": "identity",
  };

  // fetch + timeout（使用原生 fetch）
  const fetchWithTimeout = (url, ms = 12000) =>
    new Promise((resolve, reject) => {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), ms);
      fetch(url, { headers: H, redirect: "follow", signal: ctrl.signal })
        .then((r) => {
          clearTimeout(id);
          resolve(r);
        })
        .catch((e) => {
          clearTimeout(id);
          reject(e);
        });
    });

  // 只在本次請求期間放寬 TLS 驗證
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  try {
    // 先打新平台；失敗或非 2xx 再回舊平台
    let r = await fetchWithTimeout(TY_NEW).catch(() => null);
    if (!r || !r.ok) r = await fetchWithTimeout(TY_OLD);

    const text = await r.text();

    // 回應 JSON + CORS
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(r.status).send(text);
  } catch (err) {
    // 把錯誤細節回傳，方便你觀察
    res.setHeader("Access-Control-Allow-Origin", "*");
    res
      .status(500)
      .json({ error: String(err), name: err?.name || null, cause: err?.cause ? String(err.cause) : null });
  } finally {
    // 還原 TLS 設定（避免影響同環境的其他執行）
    if (prev !== undefined) process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    else delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  }
}
