
// 檔名：api/tycg.js
import { Agent } from 'undici';

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

const UA = "Mozilla/5.0 (compatible; YouBike-Proxy/1.0; +https://vercel.app)";
const H = { "user-agent": UA, "accept": "application/json, */*", "accept-encoding": "identity" };

const TY_NEW = "https://opendata.tycg.gov.tw/api/v1/dataset.datastore?rid=a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f&limit=10000";
const TY_OLD = "https://data.tycg.gov.tw/api/v1/rest/datastore/a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f?format=json";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).end();
    return;
  }

  const fetchOne = (url, ms = 12000) =>
    new Promise((resolve, reject) => {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), ms);
      fetch(url, { headers: H, redirect: "follow", dispatcher: insecureAgent, signal: ctrl.signal })
        .then(r => { clearTimeout(id); resolve(r); })
        .catch(e => { clearTimeout(id); reject(e); });
    });

  try {
    // 先打新平台，失敗再回舊平台
    let r = await fetchOne(TY_NEW).catch(() => null);
    if (!r || !r.ok) r = await fetchOne(TY_OLD);

    const text = await r.text();

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(r.status).send(text);
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).json({ error: String(err), name: err?.name || null, cause: err?.cause ? String(err.cause) : null });
  }
}
``
