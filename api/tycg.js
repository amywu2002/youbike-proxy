
// 檔名：api/tycg.js
// 桃園 YouBike 高穩代理：新平台 → TDX → 舊平台；標準化輸出 { result: { records: [...] } }
// Zero‑Config Node.js Serverless；無外部 import；僅於本次請求期間放寬 TLS。

export default async function handler(req, res) {
  // CORS 預檢
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).end();
    return;
  }

  // 來源端點
  const TY_NEW =
    "https://opendata.tycg.gov.tw/api/v1/dataset.datastore?rid=a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f&limit=10000";
  const TY_OLD =
    "https://data.tycg.gov.tw/api/v1/rest/datastore/a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f?format=json&limit=10000";

  // 🚦 TDX（中央備援）：請先到 Vercel → Settings → Environment Variables 新增 TDX_TOKEN
  // 範例 API（以 YouBike 桃園站點即時資料為例，實際請依 TDX 文件與你的授權 Token 調整路徑）
  // 若你目前沒有 Token，這個來源會被自動略過，不影響服務。
  const TDX_TOKEN = process.env.TDX_TOKEN || "";
  const TDX_URL =
    "https://tdx.transportdata.tw/api/advanced/v2/Bike/Station/City/Taoyuan?$top=10000&$format=JSON";

  const H_BASE = {
    "user-agent": "Mozilla/5.0 (compatible; YouBike-Proxy/1.1; +https://vercel.app)",
    accept: "application/json, text/plain, */*",
    "accept-encoding": "identity",
  };
  const H_TDX = TDX_TOKEN ? { ...H_BASE, Authorization: `Bearer ${TDX_TOKEN}` } : H_BASE;

  // 原生 fetch + timeout
  const fetchWithTimeout = (url, headers, ms = 12000) =>
    new Promise((resolve, reject) => {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), ms);
      fetch(url, { headers, redirect: "follow", signal: ctrl.signal })
        .then((r) => {
          clearTimeout(id);
          resolve(r);
        })
        .catch((e) => {
          clearTimeout(id);
          reject(e);
        });
    });

  // 來源 → 統一成 { result: { records } }
  const toNormalized = (text, sourceTag) => {
    // sourceTag 用來辨識解析策略（例如 TDX 與 桃園平台欄位差異）
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    let records = [];

    if (sourceTag === "TDX") {
      // 依 TDX 的站點/即時資料欄位形塑（此處示意常見欄位，實務請對照你實際取用的 TDX端點）
      // 假設 data 為陣列
      const rows = Array.isArray(data) ? data : data?.result?.records ?? [];
      records = rows.map((s) => ({
        sno: s.StationID || s.sno,
        sna: s.StationName?.Zh_tw || s.sna,
        ar: s.StationAddress?.Zh_tw || s.ar,
        lat: s.StationPosition?.PositionLat ?? s.lat,
        lng: s.StationPosition?.PositionLon ?? s.lng,
        sbi: s.AvailableRentBikes ?? s.sbi, // TDX 即時可借
        bemp: s.AvailableReturnBikes ?? s.bemp,
        act: s.ServiceStatus === 1 ? "1" : (s.act ?? "0"),
      }));
      return { result: { records } };
    }

    // 桃園平台（新/舊）的常見 3 種外觀：陣列、{result:{records}}, {payload:"[...]"}
    if (Array.isArray(data)) {
      records = data;
    } else if (data && typeof data === "object") {
      if (Array.isArray(data.result?.records)) {
        records = data.result.records;
      } else if (Object.prototype.hasOwnProperty.call(data, "payload")) {
        try {
          const inner =
            typeof data.payload === "string" && data.payload !== ""
              ? JSON.parse(data.payload)
              : data.payload;
          if (Array.isArray(inner)) {
            records = inner;
          } else if (Array.isArray(inner?.result?.records)) {
            records = inner.result.records;
          } else {
            records = [];
          }
        } catch {
          records = [];
        }
      }
    }
    return { result: { records } };
  };

  // 檢查筆數（避免空 payload / 殘缺）
  const MIN_COUNT = 200;

  // 本次請求期間放寬 TLS（解決 unable to verify the first certificate）
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  try {
    let hit = null;

    // ① 新平台
    try {
      const r = await fetchWithTimeout(TY_NEW, H_BASE);
      const text = await r.text();
      const normalized = toNormalized(text, "TY_NEW");
      const count = normalized?.result?.records?.length || 0;
      if (r.ok && count >= MIN_COUNT) {
        hit = { normalized, url: TY_NEW, count, status: r.status };
      }
    } catch (_) {}

    // ② TDX（有 Token 才嘗試；若沒有 Token，直接略過）
    if (!hit && TDX_TOKEN) {
      try {
        const r = await fetchWithTimeout(TDX_URL, H_TDX);
        const text = await r.text();
        const normalized = toNormalized(text, "TDX");
        const count = normalized?.result?.records?.length || 0;
        if (r.ok && count >= MIN_COUNT) {
          hit = { normalized, url: "TDX", count, status: r.status };
        }
      } catch (_) {}
    }

    // ③ 舊平台
    if (!hit) {
      const r = await fetchWithTimeout(TY_OLD, H_BASE);
      const text = await r.text();
      const normalized = toNormalized(text, "TY_OLD");
      const count = normalized?.result?.records?.length || 0;
      if (r.ok && count >= 1) {
        hit = { normalized, url: TY_OLD, count, status: r.status };
      } else {
        throw new Error(`All sources failed or insufficient data (count=${count})`);
      }
    }

    // 回傳
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
    res.setHeader("X-Source", hit.url);
    res.setHeader("X-Count", String(hit.count));
    res.status(200).send(JSON.stringify(hit.normalized));
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).json({
      error: String(err),
      name: err?.name || null,
      cause: err?.cause ? String(err.cause) : null,
    });
  } finally {
    if (prev !== undefined) process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    else delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  }
}
