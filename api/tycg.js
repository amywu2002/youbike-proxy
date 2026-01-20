
// 檔名：api/tycg.js
export const config = { runtime: "edge" };

export default async function handler(req) {
  // 建議使用桃園新平台 API（/api-docs 有說明），以 RID 讀 Datastore 內容
  const TARGET =
    "https://opendata.tycg.gov.tw/api/v1/dataset.datastore?rid=a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f";

  // CORS 預檢
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // 轉拋到桃園來源
  const r = await fetch(TARGET, { cache: "no-store", redirect: "follow" });
  const body = await r.arrayBuffer();

  // 回傳 JSON + CORS
  return new Response(body, {
    status: r.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      // 你要快取也可以改這行，例如 "Cache-Control": "s-maxage=15, stale-while-revalidate=30"
    },
  });
}
``
