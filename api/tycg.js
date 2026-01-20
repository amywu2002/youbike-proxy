
// 檔名：api/tycg.js
// 說明：明確用 Node.js Serverless Function 介面（req, res）

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

  const TARGET =
    "https://opendata.tycg.gov.tw/api/v1/dataset.datastore" +
    "?rid=a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f&limit=10000";

  try {
    const r = await fetch(TARGET, { redirect: "follow" });
    const text = await r.text(); // 直接轉交字串（來源已是 JSON）

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(r.status).send(text);
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res
      .status(500)
      .json({ error: String(err) });
  }
}
