// Fila de estación: [id, lat, lon, rótulo, dirección, municipio, provIdx, horario, ...precios en orden de data.fuels]
const FUEL_NAMES = { g95: "Gasolina 95", g98: "Gasolina 98", goa: "Gasóleo A", gop: "Gasóleo Premium", glp: "GLP", gnc: "GNC" };
const NEAR_KM = 10;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (v) => v.toFixed(3).replace(".", ",") + " €";

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = {
  data: null, history: {}, fuel: store.get("fuel", "goa"), province: store.get("province", "38"),
  tab: "screen", me: null, favs: new Set(store.get("favs", [])), rows: [], mean: 0,
};

// --- Mapa -------------------------------------------------------------------
const dark = matchMedia("(prefers-color-scheme: dark)").matches;
const map = L.map("map", { preferCanvas: true, zoomControl: true }).setView([40.2, -3.6], 6);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, className: dark ? "tiles-dark" : "", attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COLORS = ["--c0", "--c1", "--c2", "--c3", "--c4"].map(cssVar);
function colorIdx(price) {
  const pct = (price / state.mean - 1) * 100;
  return pct < -5 ? 0 : pct < -2 ? 1 : pct <= 2 ? 2 : pct <= 5 ? 3 : 4;
}

const cluster = L.markerClusterGroup({
  chunkedLoading: true, showCoverageOnHover: false, maxClusterRadius: 60, disableClusteringAtZoom: 14,
  iconCreateFunction(c) {
    const ms = c.getAllChildMarkers();
    const avg = ms.reduce((s, m) => s + m.options.price, 0) / ms.length;
    const n = ms.length, size = n < 50 ? 34 : n < 500 ? 42 : 50;
    return L.divIcon({
      html: `<div class="cluster" style="width:${size}px;height:${size}px;background:${COLORS[colorIdx(avg)]}">${n}</div>`,
      className: "", iconSize: [size, size],
    });
  },
});
map.addLayer(cluster);
new ResizeObserver(() => map.invalidateSize()).observe($("map"));
let meMarker = null;

// --- Datos ------------------------------------------------------------------
const priceOf = (s, fuel = state.fuel) => s[8 + state.data.fuels.indexOf(fuel)];

async function load() {
  const [st, hist] = await Promise.all([
    fetch("data/stations.json", { cache: "no-cache" }).then((r) => r.json()),
    fetch("data/history.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({})),
  ]);
  state.data = st; state.history = hist;
  const sel = $("province");
  st.provinces.map((p, i) => [p, i]).sort((a, b) => a[0].localeCompare(b[0], "es"))
    .forEach(([p, i]) => sel.add(new Option(p, i)));
  $("fuel").value = state.fuel; sel.value = state.province;
  $("meta").textContent = `${st.stations.length.toLocaleString("es")} gasolineras · ${st.fecha}`;
  render(true);
  autoLocate();
}

function render(fit) {
  const prov = state.province === "" ? null : +state.province;
  state.rows = state.data.stations.filter((s) => priceOf(s) && (prov === null || s[6] === prov));
  const prices = state.rows.map((s) => priceOf(s));
  if (!prices.length) { cluster.clearLayers(); setStats(null); renderList(); return; }
  state.mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  setStats(prov);

  cluster.clearLayers();
  cluster.addLayers(state.rows.map((s) => {
    const p = priceOf(s);
    const m = L.marker([s[1], s[2]], {
      price: p, icon: L.divIcon({ html: `<div class="dot" style="background:${COLORS[colorIdx(p)]}"></div>`, className: "", iconSize: [14, 14] }),
    });
    m.bindPopup(() => popup(s), { maxWidth: 280 });
    m.station = s;
    return m;
  }));
  if (fit) {
    map.invalidateSize(false);
    if (prov === null) map.setView([40.2, -3.6], 6, { animate: false });
    else map.fitBounds(L.latLngBounds(state.rows.map((s) => [s[1], s[2]])), { padding: [20, 20], animate: false });
  }
  renderList();
}

function setStats(prov) {
  if (!state.rows.length) { ["avg", "min", "max", "delta", "minWhere", "maxWhere"].forEach((id) => ($(id).textContent = "—")); return; }
  let min = state.rows[0], max = state.rows[0];
  for (const s of state.rows) { if (priceOf(s) < priceOf(min)) min = s; if (priceOf(s) > priceOf(max)) max = s; }
  $("avg").textContent = eur(state.mean);
  $("min").textContent = eur(priceOf(min)); $("minWhere").textContent = min[5];
  $("max").textContent = eur(priceOf(max)); $("maxWhere").textContent = max[5];

  // Variación frente al día anterior registrado en el histórico
  const scope = prov === null ? "ES" : state.data.provinces[prov];
  const days = Object.keys(state.history).sort();
  const today = state.data.fecha.split(" ")[0].split("/").reverse().join("-");
  const prev = days.filter((d) => d < today).pop();
  const before = prev && state.history[prev][state.fuel]?.[scope];
  const d = $("delta");
  if (before) {
    const diff = state.mean - before, pct = (diff / before) * 100;
    d.className = "d " + (diff > 0 ? "up" : "down");
    d.textContent = `${diff > 0 ? "▲ +" : "▼ "}${diff.toFixed(3).replace(".", ",")} (${pct.toFixed(2).replace(".", ",")}%)`;
  } else { d.className = "d"; d.textContent = "vs ayer: sin datos aún"; }
}

// --- Popup ------------------------------------------------------------------
function popup(s) {
  const rows = state.data.fuels.map((f) => {
    const p = priceOf(s, f);
    return p ? `<tr class="${f === state.fuel ? "sel" : ""}"><td>${FUEL_NAMES[f]}</td><td>${eur(p)}</td></tr>` : "";
  }).join("");
  const fav = state.favs.has(s[0]);
  return `<div class="pop"><h3>${esc(s[3])}</h3><div class="a">${esc(s[4])} · ${esc(s[5])}</div>
    <table>${rows}</table><div class="h">🕒 ${esc(s[7])}</div>
    <div class="act"><button data-fav="${esc(s[0])}">${fav ? "★ Quitar" : "☆ Favorita"}</button>
    <a href="https://www.google.com/maps/dir/?api=1&destination=${s[1]},${s[2]}" target="_blank" rel="noopener">Cómo llegar</a></div></div>`;
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-fav]");
  if (!b) return;
  const id = b.dataset.fav;
  state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
  store.set("favs", [...state.favs]);
  b.textContent = state.favs.has(id) ? "★ Quitar" : "☆ Favorita";
  if (state.tab === "favs") renderList();
});

// --- Geolocalización -------------------------------------------------------
function autoLocate() {
  if (!navigator.geolocation || state.province !== "38") return;
  navigator.geolocation.getCurrentPosition((pos) => {
    const [lat, lon] = [pos.coords.latitude, pos.coords.longitude];
    let nearest = state.data.stations[0];
    let minDist = km([lat, lon], [nearest[1], nearest[2]]);
    for (const s of state.data.stations) {
      const dist = km([lat, lon], [s[1], s[2]]);
      if (dist < minDist) { nearest = s; minDist = dist; }
    }
    const prov = String(nearest[6]);
    if (prov !== state.province) {
      state.province = prov;
      store.set("province", prov);
      $("province").value = prov;
      render(true);
    }
  }, () => {}, { enableHighAccuracy: false, timeout: 5000 });
}

// --- Lista lateral ----------------------------------------------------------
function km(a, b) {
  const R = 6371, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function renderList() {
  const ol = $("list");
  let items = [], empty = "";
  if (state.tab === "screen") {
    const b = map.getBounds();
    items = state.rows.filter((s) => b.contains([s[1], s[2]]));
    empty = "No hay gasolineras en esta zona del mapa.";
  } else if (state.tab === "near") {
    if (!state.me) { ol.innerHTML = `<li class="empty">Pulsa <b>📍 Cerca de mí</b> para ver las más baratas a menos de ${NEAR_KM} km.</li>`; return; }
    // Todas las provincias: cerca de ti no importa el filtro
    items = state.data.stations.filter((s) => priceOf(s) && km(state.me, [s[1], s[2]]) <= NEAR_KM);
    empty = `No hay gasolineras con este combustible a menos de ${NEAR_KM} km.`;
  } else {
    items = state.data.stations.filter((s) => state.favs.has(s[0]) && priceOf(s));
    empty = "Aún no tienes favoritas. Abre una gasolinera en el mapa y pulsa ☆ Favorita.";
  }
  items.sort((a, b) => priceOf(a) - priceOf(b));
  if (!items.length) { ol.innerHTML = `<li class="empty">${empty}</li>`; return; }
  ol.innerHTML = items.slice(0, 100).map((s) => {
    const dist = state.me ? ` · ${km(state.me, [s[1], s[2]]).toFixed(1).replace(".", ",")} km` : "";
    return `<li data-id="${esc(s[0])}"><span class="n">${esc(s[3])}</span><span class="p" style="color:${COLORS[colorIdx(priceOf(s))]}">${eur(priceOf(s))}</span><span class="a">${esc(s[5])}${dist}</span></li>`;
  }).join("");
}

$("list").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  const m = cluster.getLayers().find((m) => m.station[0] === li.dataset.id);
  if (m) cluster.zoomToShowLayer(m, () => m.openPopup());
  else {
    const s = state.data.stations.find((s) => s[0] === li.dataset.id);
    L.popup().setLatLng([s[1], s[2]]).setContent(popup(s)).openOn(map);
    map.setView([s[1], s[2]], 15);
  }
  if (matchMedia("(max-width: 760px)").matches) $("map").scrollIntoView({ behavior: "smooth" });
});

// --- Controles --------------------------------------------------------------
$("fuel").addEventListener("change", (e) => { state.fuel = e.target.value; store.set("fuel", state.fuel); render(false); });
$("province").addEventListener("change", (e) => { state.province = e.target.value; store.set("province", state.province); render(true); });
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
function setTab(t) {
  state.tab = t;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  renderList();
}
map.on("moveend", () => state.tab === "screen" && renderList());

$("locate").addEventListener("click", () => {
  if (!navigator.geolocation) return alert("Tu navegador no permite geolocalización.");
  $("locate").textContent = "📍 Buscando…";
  navigator.geolocation.getCurrentPosition((pos) => {
    state.me = [pos.coords.latitude, pos.coords.longitude];
    if (meMarker) meMarker.remove();
    meMarker = L.marker(state.me, { icon: L.divIcon({ html: '<div class="me"></div>', className: "", iconSize: [16, 16] }), zIndexOffset: 1000 }).addTo(map);
    map.setView(state.me, 13);
    $("locate").textContent = "📍 Cerca de mí";
    setTab("near");
  }, () => { $("locate").textContent = "📍 Cerca de mí"; alert("No se pudo obtener tu ubicación."); }, { enableHighAccuracy: true, timeout: 10000 });
});

load().catch((err) => { $("meta").textContent = "Error cargando datos"; console.error(err); });
