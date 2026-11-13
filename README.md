# Colorado Snow

A simple phone app for Colorado ski resorts: what's open, opening days, fresh snow and snow on the way.

Two views: a **map** with every resort's number on it (next 3 days, 7 days, last 24 hours, base depth, or opening and
closing days; tap a resort for details) and a **list** you can sort by snow coming, opening day or name. The map's
*Snow on the ground* switch overlays NOAA's daily snow-depth analysis.

**On Android:** open the site in Chrome, tap ⋮ → *Add to Home screen*. It then opens like a normal app.

## Where the data comes from

| What | Source | Covers |
|---|---|---|
| Open/closed, lifts, runs, 24/48 hr snow, base | [Colorado Ski Country USA feed](https://snow.coloradoski.com/view/publicreport-feed) | 20 member resorts |
| Snow and temperature forecast (7 days) | [National Weather Service](https://www.weather.gov/documentation/services-web-api) | All 26 resorts |
| Snow on the ground (map layer) | [NOAA NOHRSC snow analysis](https://www.nohrsc.noaa.gov/nsa/) | Everywhere, daily |
| Planned opening dates | Hand-entered in `src/resorts.js` (`PLANNED`) | Vail, Beaver Creek, Breckenridge, Keystone, Crested Butte, Wolf Creek |

Vail Resorts' sites block automated requests, so those mountains show planned dates instead of a live status.

## How it runs

A GitHub Action (`.github/workflows/update.yml`) runs every 30 minutes: it runs the tests, fetches fresh data into
`public/data.json` and publishes `public/` to GitHub Pages. There is no server.

## Each fall

Update `PLANNED` in `src/resorts.js` with the new season's dates for the resorts without a live feed.
Seasons without an entry show "Opening date TBA" instead of stale dates.

## Local development

```sh
npm run build    # fetch live data into public/data.json
npm run preview  # http://localhost:8787
npm test
```

No npm dependencies; needs Node 20+. Leaflet 1.9.4 (BSD-2) is vendored in `public/vendor/leaflet/`.
Map tiles come from OpenTopoMap (no key needed).
