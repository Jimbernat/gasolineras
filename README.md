# Gasolineras

Mapa de precios de carburantes en España, en tiempo real.

- **Datos:** API pública del Ministerio para la Transición Ecológica (se actualiza cada 30 min).
- **Robot:** `.github/workflows/update.yml` ejecuta `scripts/update.py` cada 30 min y guarda `data/stations.json` (estaciones y precios) y `data/history.json` (media diaria por combustible y provincia).
- **Web:** `index.html` + `app.js` + `style.css`, servida con GitHub Pages. Mapa con Leaflet y OpenStreetMap.

Prueba local: `python3 -m http.server 8765` y abrir http://localhost:8765
