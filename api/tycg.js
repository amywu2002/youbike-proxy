<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8" />
<title>YouBike站點地圖</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0" />

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />

<style>
body {
  margin: 0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

#map {
  height: 100vh;
  width: 100%;
}

/* 左上 */
#count {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 1000;
  background: #fff;
  padding: 6px 10px;
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0,0,0,.15);
  font-size: 14px;
}

/* 上方控制 */
#controls {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  gap: 8px;
  max-width: calc(100vw - 24px);
}

#controls input,
#controls select {
  padding: 8px 10px;
  font-size: 14px;
  border-radius: 8px;
  border: 1px solid #ccc;
  background: #fff;
  box-shadow: 0 2px 6px rgba(0,0,0,.15);
}

/* Marker 顏色 */
.marker.green  { --c:#7AC943; }
.marker.yellow { --c:#F5A623; }
.marker.red    { --c:#A80000; }

.leaflet-div-icon {
  background: transparent !important;
  border: none !important;
}

.marker svg {
  width: 60px;
  height: 68px;
}

/* +- 右上 */
.leaflet-top.leaflet-left {
  right: 12px;
  left: auto;
}

/* 🟦 藍色定位點 */
.user-dot {
  width: 18px;
  height: 18px;
  background: #1A73E8;
  border-radius: 50%;
  border: 3px solid #fff;
  box-shadow: 0 0 10px rgba(0,0,0,.45);
}
</style>
</head>

<body>

<div id="count">站點：--</div>

<div id="controls">
  <select id="city">
    <option value="all">城市</option>
    <option value="ty">桃園</option>
    <option value="nt">新北</option>
    <option value="tp">臺北</option>
  </select>

  <input id="search" placeholder="搜尋站點名稱或地址…" />

  <select id="statusFilter">
    <option value="all">全部</option>
    <option value="green">正常</option>
    <option value="yellow">無車</option>
    <option value="red">無位</option>
  </select>
</div>

<div id="map"></div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<script>
const TAIPEI_API =
  "https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json";
const TAOYUAN_API = "stations.json";
const NEWTAI_API = "https://cool-block-affbntpc-youbike-proxy.amywu2.workers.dev/ntpc";

/* 地圖 */
const map = L.map("map").setView([25.03, 121.55], 11);
map.zoomControl.setPosition("topright");

/* ✅ 關鍵：建立「最高層」pane */
map.createPane("userLocation");
map.getPane("userLocation").style.zIndex = 650;

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap"
}).addTo(map);

let markers = [];
let dataTP = [];
let dataTY = [];
let userMarker = null;

/* ===== 使用者定位（自動） ===== */
function locateUser() {
  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    if (!userMarker) {
      userMarker = L.marker([lat, lng], {
        pane: "userLocation",
        zIndexOffset: 0,
        icon: L.divIcon({
          className: "",
          iconSize: [24, 24],
          html: `<div class="user-dot"></div>`
        })
      }).addTo(map);

      map.setView([lat, lng], 14);
    } else {
      userMarker.setLatLng([lat, lng]);
    }
  });
}
locateUser();

/* ===== 工具 ===== */
function clearMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
}

function getStatus(b, r) {
  if (r === 0) return "red";
  if (b === 0) return "yellow";
  return "green";
}

function makeMarkerHTML(b, r, status) {
  return `
  <div class="marker ${status}">
    <svg viewBox="0 0 64 72">
      <path d="M32 2 C20 2 10 12 10 26
               C10 44 32 68 32 68
               C32 68 54 44 54 26
               C54 12 44 2 32 2Z"
        fill="var(--c)" stroke="#fff" stroke-width="3"/>
      <line x1="20" y1="30" x2="44" y2="30"
        stroke="#fff" stroke-width="2"/>
      <text x="32" y="24" text-anchor="middle"
        font-size="16" font-weight="700" fill="#fff">${b}</text>
      <text x="32" y="48" text-anchor="middle"
        font-size="16" font-weight="600" fill="#fff">${r}</text>
    </svg>
  </div>`;
}

/* ===== Render ===== */
function render() {
  clearMarkers();

  const kw = search.value.trim();
  const cityF = city.value;
  const statusF = statusFilter.value;

  let list = [];
  if (cityF === "all" || cityF === "ty") list = list.concat(dataTY);
  if (cityF === "all" || cityF === "tp") list = list.concat(dataTP);
  if (cityF === "all" || cityF === "nt") list = list.concat(dataNT);

  list = list.filter(s => {
    const st = getStatus(s.borrow, s.ret);
    if (statusF !== "all" && st !== statusF) return false;
    if (kw && !s.name.includes(kw) && !s.addr.includes(kw)) return false;
    return true;
  });

  list.forEach(s => {
    const marker = L.marker([s.lat, s.lng], {
      icon: L.divIcon({
        iconSize: [60, 68],
        iconAnchor: [30, 68],
        html: makeMarkerHTML(s.borrow, s.ret, getStatus(s.borrow, s.ret))
      })
    }).addTo(map)
      .bindPopup(`
        <b>${s.name}</b><br>
        地址：${s.addr}<br>
        可借：${s.borrow}<br>
        可還：${s.ret}
      `);

    markers.push(marker);
  });

  count.textContent = `站點：${markers.length}站`;
}

/* ===== 資料 ===== */
fetch(TAOYUAN_API).then(r => r.json()).then(j => {
  dataTY = Object.values(j.retVal).map(s => ({
    name: s.sna,
    addr: s.ar || "",
    lat: Number(s.lat),
    lng: Number(s.lng),
    borrow: Number(s.sbi),
    ret: Number(s.bemp)
  }));
  render();
});
  
fetch(NEWTAI_API)
  .then(r => r.json())
  .then(j => {
    dataNT = j.map(s => ({
      name: s.sna,
      addr: s.ar || "",
      lat: Number(s.lat),
      lng: Number(s.lng),
      borrow: Number(s.sbi_quantity),
      ret: Number(s.bemp)
    }));
    render();
  });
  
fetch(TAIPEI_API).then(r => r.json()).then(j => {
  dataTP = j.map(s => ({
    name: s.sna,
    addr: s.ar || "",
    lat: Number(s.latitude),
    lng: Number(s.longitude),
    borrow: Number(s.available_rent_bikes),
    ret: Number(s.available_return_bikes)
  }));
  render();
});

search.addEventListener("input", render);
statusFilter.addEventListener("change", render);
city.addEventListener("change", render);
</script>

</body>
</html>










