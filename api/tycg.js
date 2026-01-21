
// 檔名：api/tycg.js
// 功能：抓桃園 YouBike（新/舊平台自動回退），並「標準化輸出」成 { result: { records: [...] } }。
// 備註：Zero‑Config Node.js Serverless Function；不使用外部 import，僅於本次請求期間放寬 TLS 驗證。

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

  // 來源端點（先新平台，失敗或非 2xx 再回舊平台）
  const TY_NEW =
    "https://opendata.tycg.gov.tw/api/v1/dataset.datastore?rid=a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f&limit=10000";
  const TY_OLD =
    "https://data.tycg.gov.tw/api/v1/rest/datastore/a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f?format=json";

  const H = {
    "user-agent":
      "Mozilla/5.0 (compatible; YouBike-Proxy/1.0; +https://vercel.app)",
    accept: "application/json, text/plain, */*",
    "accept-encoding": "identity",
  };

  // 原生 fetch + timeout（避免長時間卡住）
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

  // 僅在本次請求期間放寬 TLS 驗證（解決 unable to verify the first certificate）
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  try {
    // 先新平台；失敗/非 2xx → 再舊平台
    let r = await fetchWithTimeout(TY_NEW).catch(() => null);
    if (!r || !r.ok) r = await fetchWithTimeout(TY_OLD);

    const text = await r.text();

    // 嘗試解析來源（可能是陣列、物件、或字串化 JSON）
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text; // 非 JSON（極少數）→ 先原樣保留
    }

    // === 標準化：轉成 { result: { records: [...] } } ===
    let records = [];

    if (Array.isArray(data)) {
      // 來源直接是陣列
      records = data;
    } else if (data && typeof data === "object") {
      if (Array.isArray(data.result?.records)) {
        // Datastore 樣式
        records = data.result.records;
      } else if (data.payload) {
        // payload 可能是字串或陣列
        try {
          const inner =
            typeof data.payload === "string"
              ? JSON.parse(data.payload)
              : data.payload;
          if (Array.isArray(inner)) {
            records = inner;
          } else if (Array.isArray(inner?.result?.records)) {
            records = inner.result.records;
          }
        } catch {
          // payload 非 JSON → 保持空陣列
          records = [];
        }
      }
    }

    const normalized = { result: { records } };

    // 回傳 JSON + CORS
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(200).send(JSON.stringify(normalized));
  } catch (err) {
    // 失敗時也回 JSON（含錯誤細節，便於前端與你排查）
    res.setHeader("Access-Control-Allow-Origin", "*");
    res
      .status(500)
      .json({
        error: String(err),
        name: err?.name || null,
        cause: err?.cause ? String(err.cause) : null,
      });
  } finally {
    // 還原 TLS 設定（避免影響同環境的其他執行）
    if (prev !== undefined) process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    else delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  }
}
