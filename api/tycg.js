
// 檔名：api/ping.js
export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json({ ok: true, at: new Date().toISOString() });
}
``
