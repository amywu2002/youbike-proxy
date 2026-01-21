
// 檔名：api/tycg.js
// 桃園 YouBike 高穩代理 v3：TDX 優先（Station+Availability 伺服器端合併）→ 再並行 TY_NEW/TY_OLD。
// 統一輸出 { result: { records: [...] } }；支援 ?debug=1；帶 X-Source / X-Count / X-HTTP。
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

  const urlParams = new URL(req.url, "http://localhost");
  const wantDebug = urlParams.searchParams.get("debug") === "1";

  // === 來源定義 ===
  // 桃園新/舊（皆帶 offset/limit）
  const TY_NEW = "https://opendata.tycg.gov.tw/api/v1/dataset.datastore?rid=a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f&offset=0&limit=10000";
  const TY_OLD = "https://data.tycg.gov.tw/api/v1/rest/datastore/a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f?format=json&offset=0&limit=10000";

  // TDX（中央）Station + Availability（需 Token）
  const TDX_TOKEN = process.env.TDX_TOKEN || "";
  const TDX_STATION = "https://tdx.transportdata.tw/api/basic/v2/Bike/Station/City/Taoyuan?$top=10000&$format=JSON";
  const TDX_AVAIL   = "https://tdx.transportdata.tw/api/basic/v2/Bike/Availability/City/Taoyuan?$top=10000&$format=JSON";

  const H_BASE = {
    "user-agent": "Mozilla/5.0 (compatible; YouBike-Proxy/1.3; +https://vercel.app)",
    "accept": "application/json, text/plain, */*",
    "accept-encoding": "identity",
  };
  const H_TDX = TDX_TOKEN ? { ...H_BASE, Authorization: `Bearer ${TDX_TOKEN}` } : H_BASE;

  // 原生 fetch + timeout
  const fetchWithTimeout = (url, headers, ms = 12000) =>
    new Promise((resolve, reject) => {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), ms);
      fetch(url, { headers, redirect: "follow", signal: ctrl.signal })
        .then((r) => { clearTimeout(id); resolve(r); })
        .catch((e) => { clearTimeout(id); reject(e); });
    });

  // === 解析器：標準化到 { result: { records } } ===
  const toNormalizedTY = (text) => {
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    let records = [];
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
          if (Array.isArray(inner)) records = inner;
          else if (Array.isArray(inner?.result?.records)) records = inner.result.records;
          else records = [];
        } catch { records = []; }
      }
    }
    return { result: { records } };
  };

  // === 解析器：TDX Station + Availability Join → 標準化 ===
  const normalizeTDX = (stationArr, availArr) => {
    const byId = new Map();

    // 先放 Station（靜態站點）
    for (const s of (Array.isArray(stationArr) ? stationArr : [])) {
      const id = s.StationID ?? s.sno;
      if (!id) continue;
      byId.set(id, {
        sno: id,
        sna: s.StationName?.Zh_tw ?? s.sna ?? "",
        ar:  s.StationAddress?.Zh_tw ?? s.ar ?? "",
        lat: s.StationPosition?.PositionLat ?? s.lat,
        lng: s.StationPosition?.PositionLon ?? s.lng,
        tot: s.BikesCapacity ?? null,  // 容量（若來源未提供則為 null）
        sbi: 0,
        bemp: 0,
        act: "0",
      });
    }

    // 再合併 Availability（即時）
    for (const a of (Array.isArray(availArr) ? availArr : [])) {
      const id = a.StationID ?? a.sno;
      if (!id) continue;
      const r = byId.get(id) ?? {
        sno: id,
        sna: a.StationName?.Zh_tw ?? "",
        ar:  a.StationAddress?.Zh_tw ?? "",
        lat: a.StationPosition?.PositionLat,
        lng: a.StationPosition?.PositionLon,
        tot: null,
        sbi: 0,
        bemp: 0,
        act: "0",
      };
      r.sbi = a.AvailableRentBikes ?? r.sbi ?? 0;
      r.bemp = a.AvailableReturnBikes ?? r.bemp ?? 0;
      r.act = (a.ServiceStatus === 1 || a.ServiceStatus === "1") ? "1" : "0";
      byId.set(id, r);
    }

    return { result: { records: Array.from(byId.values()) } };
  };

  // === 診斷封裝 ===
  const hitOne = async (url, headers, tag, parser = "ty") => {
    try {
      const r = await fetchWithTimeout(url, headers);
      const status = r.status;
      const text = await r.text();
      const normalized = parser === "ty" ? toNormalizedTY(text) : { result: { records: [] } };
      const count = normalized?.result?.records?.length || 0;
      const snippet = text.slice(0, 600);
      return { tag, url, ok: r.ok, status, count, normalized, rawText: text, snippet };
    } catch (e) {
      return { tag, url, ok: false, status: 0, count: 0, normalized: { result: { records: [] } }, rawText: String(e), snippet: String(e) };
    }
  };

  // 本次請求期間放寬 TLS（處理桃園新平台偶發憑證鏈問題）
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  try {
    let chosen = null;
    let diagnostics = [];

    // ① 嘗試 TDX（若有 Token：並行抓取 Station + Availability，成功就直接用）
    if (TDX_TOKEN) {
      const [rS, rA] = await Promise.allSettled([
        fetchWithTimeout(TDX_STATION, H_TDX),
        fetchWithTimeout(TDX_AVAIL, H_TDX),
      ]);

      if (rS.status === "fulfilled" && rA.status === "fulfilled") {
        const sText = await rS.value.text();
        const aText = await rA.value.text();

        let sJson, aJson;
        try { sJson = JSON.parse(sText); } catch { sJson = []; }
        try { aJson = JSON.parse(aText); } catch { aJson = []; }

        const sArr = Array.isArray(sJson) ? sJson : (sJson?.result?.records ?? []);
        const aArr = Array.isArray(aJson) ? aJson : (aJson?.result?.records ?? []);

        const normalized = normalizeTDX(sArr, aArr);
        const count = normalized?.result?.records?.length || 0;

        diagnostics.push({
          tag: "TDX_STATION", url: TDX_STATION, ok: true, status: rS.value.status, count: sArr.length, snippet: sText.slice(0, 300)
        });
        diagnostics.push({
          tag: "TDX_AVAIL", url: TDX_AVAIL, ok: true, status: rA.value.status, count: aArr.length, snippet: aText.slice(0, 300)
        });

        if (count >= 1) {
          chosen = { tag: "TDX_JOIN", url: "TDX_JOIN(Station+Availability)", status: 200, count, normalized };
        }
      } else {
        // 收集 TDX 失敗診斷
        if (rS.status === "rejected") diagnostics.push({ tag: "TDX_STATION", url: TDX_STATION, ok: false, status: 0, count: 0, snippet: String(rS.reason) });
        if (rA.status === "rejected") diagnostics.push({ tag: "TDX_AVAIL", url: TDX_AVAIL, ok: false, status: 0, count: 0, snippet: String(rA.reason) });
      }
    }

    // ② 若 TDX 未命中 → 並行嘗試 TY_NEW / TY_OLD；挑 HTTP OK 且筆數最多者
    if (!chosen) {
      const tries = await Promise.all([
        hitOne(TY_NEW, H_BASE, "TY_NEW", "ty"),
        hitOne(TY_OLD, H_BASE, "TY_OLD", "ty"),
      ]);
      diagnostics.push(...tries);

      let best = tries.filter(x => x.ok).sort((a, b) => b.count - a.count)[0];
      if (!best) best = tries.sort((a, b) => b.count - a.count)[0]; // 都非 OK 就挑筆數最多的，可能仍為 0

      chosen = { tag: best.tag, url: best.url, status: best.status, count: best.count, normalized: best.normalized };
    }

    // === 回應 ===
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
    res.setHeader("X-Source", `${chosen.tag}:${chosen.url}`);
    res.setHeader("X-Count", String(chosen.count));
    res.setHeader("X-HTTP", String(chosen.status));

    if (wantDebug) {
      res.status(200).send(JSON.stringify({
        success: true,
        chosen: { tag: chosen.tag, url: chosen.url, status: chosen.status, count: chosen.count },
        diagnostics,
        result: chosen.normalized.result
      }));
      return;
    }

    res.status(200).send(JSON.stringify(chosen.normalized));
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
