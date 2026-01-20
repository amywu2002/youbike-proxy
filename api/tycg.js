
// 使用 Node.js Runtime（Vercel API Route 支援）
export const config = { runtime: "nodejs" };

export default async function handler(req) {
  const TARGET =
    "https://opendata.tycg.gov.tw/api/v1/dataset.datastore?rid=a1b4714b-3b75-4ff8-a8f2-cc377e4eaa0f&limit=10000";

  try {
    const r = await fetch(TARGET, { redirect: "follow" });

    // 桃園資料有時會回 HTML 或錯誤頁，所以先用 text() 再交給前端解析
    const body = await r.text();

    return new Response(body, {
      status: r.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  } catch (err) {
    // 500 處理
    return new Response(
      JSON.stringify({ error: String(err) }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
}
