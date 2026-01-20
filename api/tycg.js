// 檔名：api/tycg.js
export const config = { runtime: "edge" };

export default async function handler(req) {
  const TARGET =
    "https://opendata.tycg.gov.tw/api/v1/dataset.datastore?rid=a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f";

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

  const r = await fetch(TARGET, { cache: "no-store", redirect: "follow" });
  const body = await r.arrayBuffer();

  return new Response(body, {
    status: r.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }
  });
}
