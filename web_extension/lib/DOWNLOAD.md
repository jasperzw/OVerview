# Required: download Leaflet into this directory

Chrome/Firefox MV3 extensions cannot load remote scripts, so Leaflet must be bundled locally.

Run from the repo root:

```bash
cd web_extension/lib
curl -LO https://unpkg.com/leaflet@1.9.4/dist/leaflet.js
curl -LO https://unpkg.com/leaflet@1.9.4/dist/leaflet.css
# Images Leaflet needs:
mkdir -p images
curl -L https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png    -o images/marker-icon.png
curl -L https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png -o images/marker-icon-2x.png
curl -L https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png  -o images/marker-shadow.png
```
