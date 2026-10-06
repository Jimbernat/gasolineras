#!/bin/zsh
# Robot local: el Ministerio bloquea los servidores de GitHub, así que la descarga se hace desde este Mac.
# Lo ejecuta launchd cada 30 min (~/Library/LaunchAgents/com.jimbernat.gasolineras.plist).
set -euo pipefail
cd "$(dirname "$0")/.."
API="https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
echo "--- $(date '+%Y-%m-%d %H:%M:%S')"
git pull -q --rebase
curl -sf --retry 3 --retry-delay 20 --max-time 180 -A "Mozilla/5.0 (gasolineras-app)" -o "$tmp" "$API"
/usr/bin/python3 scripts/update.py "$tmp"
git add data
if git diff --cached --quiet; then echo "Sin cambios"; exit 0; fi
git -c user.name="gasolineras-robot" -c user.email="jimbernat@mac.com" commit -qm "Datos $(date '+%Y-%m-%d %H:%M')"
git push -q
echo "Subido"
