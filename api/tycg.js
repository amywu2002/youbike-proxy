
// 檔名：api/tycg.js
// 桃園 YouBike 高穩代理 v2：並行抓取（新平台 / TDX / 舊平台），選「筆數最多」且 HTTP OK 的來源。
// 輸出標準化 { result: { records: [...] } }，加上 X-Source / X-Count，支援 ?debug=1 回傳診斷。
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
    "https://opendata.tycg.gov.tw/api/v1/dataset.datastore?rid=a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f&offset=0&limit=10000";
  const TY_OLD =
    "https://data.tycg.gov.tw/api/v1/rest/datastore/a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f?format=json&offset=0&limit=10000";

  // TDX（中央備援）
  const TDX_TOKEN = process.env.TDX_TOKEN || "";
  // 這個端點僅示意：實務上你可能用 Station + Availability join 的彙整端點
  const TDX_URL =
    "https://tdx.transportdata.tw/api/advanced/v2/Bike/Availability/City/Taoyuan?$top=10000&$format=JSON";

  const H_BASE = {
    "user-agent": "Mozilla/5.0 (compatible; YouBike-Proxy/1.2; +https://vercel.app)",
    accept: "application/json, text/plain, */*",
    "accept-encoding": "identity",
  };
  const H_TDX = TDX_TOKEN ? { ...H_BASE, Authorization: `Bearer ${TDX_TOKEN}` } : H_BASE;

  const urlParams = new URL(req.url, "http://localhost");
  const wantDebug = urlParams.searchParams.get("debug") === "1";

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
  const toNormalized = (text, tag) => {
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    let records = [];

    if (tag === "TDX") {
      // Availability 端點：假設回 [{StationID, AvailableRentBikes, AvailableReturnBikes, ServiceStatus, StationPosition...}, ...]
      const rows = Array.isArray(data) ? data : (data?.result?.records ?? []);
      records = rows.map((s) => ({
        sno: s.StationID ?? s.sno,
        sna: s.StationName?.Zh_tw ?? s.sna ?? "",
        ar: s.StationAddress?.Zh_tw ?? s.ar ?? "",
        lat: s.StationPosition?.PositionLat ?? s.lat,
        lng: s.StationPosition?.PositionLon ?? s.lng,
        sbi: s.AvailableRentBikes ?? s.sbi ?? 0,
        bemp: s.AvailableReturnBikes ?? s.bemp ?? 0,
        act: s.ServiceStatus === 1 ? "1" : (s.act ?? "0"),
      }));
      return { result: { records } };
    }

    // 桃園平台（新/舊）
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

  // 單一來源流程（回診斷資訊）
  const hitOne = async (url, headers, tag) => {
    try {
      const r = await fetchWithTimeout(url, headers);
      const status = r.status;
      const text = await r.text();
      const normalized = toNormalized(text, tag);
      const count = normalized?.result?.records?.length || 0;
      // debug payload 收斂：只保留前 600 字元，避免巨量輸出
      const snippet = text.slice(0, 600);
      return { tag, url, ok: r.ok, status, count, normalized, snippet };
    } catch (e) {
      return { tag, url, ok: false, status: 0, count: 0, normalized: { result: { records: [] } }, snippet: String(e) };
    }
  };

  // 本次請求期間放寬 TLS（解決 unable to verify the first certificate）
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  try {
    // 並行嘗試（TDX 無 Token 則不發）
    const promises = [
      hitOne(TY_NEW, H_BASE, "TY_NEW"),
      hitOne(TY_OLD, H_BASE, "TY_OLD"),
    ];
    if (TDX_TOKEN) promises.push(hitOne(TDX_URL, H_TDX, "TDX"));

    const results = await Promise.all(promises);

    // 選擇規則：HTTP ok 且 count 最大；若皆非 ok，取 count 最大者（仍回 200 但 count 可能為 0，方便前端看到 debug）
    let best = results
      .filter(x => x.ok)
      .sort((a, b) => b.count - a.count)[0];

    if (!best) {
      best = results.sort((a, b) => b.count - a.count)[0]; // 皆非 ok 時的 fallback
    }

    const { normalized, url, tag, count, status } = {
      normalized: best.normalized, url: best.url, tag: best.tag, count: best.count, status: best.status
    };

    // 回應
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
    res.setHeader("X-Source", `${tag}:${url}`);
    res.setHeader("X-Count", String(count));
    res.setHeader("X-HTTP", String(status));

    if (wantDebug) {
      // 調試模式：附上三來源的診斷（狀態碼、筆數、前 600 字元）
      res.status(200).send(JSON.stringify({
        success: true,
        chosen: { tag, url, status, count },
        diagnostics: results.map(r => ({
          tag: r.tag, url: r.url, ok: r.ok, status: r.status, count: r.count, snippet: r.snippet
        })),
        result: normalized.result
      }));
      return;
    }

    // 正常模式：只回標準化資料
    res.status(200).send(JSON.stringify(normalized));
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).json({
      error: String(err),
      name: err?.name || null,
      cause: err?.cause ? String(err.cause) : null
    });
  } finally {
    if (prev !== undefined) process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    else delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  }
}
