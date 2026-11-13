# Powdar

A simple phone app for Colorado ski resorts: one map with every resort's snow forecast, base depth, or opening and
closing days, and a pull-up list. Tap any resort for its 7-day forecast, live report and season dates.

**On Android:** open the site in Chrome, tap ⋮ → *Install app* (or *Add to Home screen*).

## Where the data comes from

| What | Source | Covers |
|---|---|---|
| Open/closed, lifts, runs, 24/48 hr snow, base | [Colorado Ski Country USA feed](https://snow.coloradoski.com/view/publicreport-feed) | 20 member resorts |
| Snow forecast (7 days) | Blend of the [National Weather Service](https://www.weather.gov/documentation/services-web-api) and four models via [Open-Meteo](https://open-meteo.com) (ECMWF, GFS/HRRR, GEM, ICON) at mid-mountain elevation | All 26 resorts |
| Snow on the ground (map layer) | [NOAA NOHRSC snow analysis](https://www.nohrsc.noaa.gov/nsa/) | Everywhere, daily |
| Planned opening dates | Hand-entered in `src/resorts.js` (`PLANNED`) | Vail, Beaver Creek, Breckenridge, Keystone, Crested Butte, Wolf Creek |

Vail Resorts' sites block automated requests, so those mountains show planned dates instead of a live status.

### How the forecast works

Each model's hourly precipitation and temperature, adjusted to the resort's mid-mountain elevation, becomes snow using a
temperature-based snow-to-liquid ratio (wet near freezing, fluffier in the cold). The app shows the middle of the five
forecasts as the headline and the 2nd-lowest to 2nd-highest as the likely range. If the models are unreachable it
falls back to the Weather Service alone.

## How it runs

A GitHub Action (`.github/workflows/update.yml`) runs every 30 minutes: it runs the tests, fetches fresh data into
`public/data.json` and publishes `public/` to GitHub Pages. There is no server.

## Each fall

Update `PLANNED` in `src/resorts.js` with the new season's dates for the resorts without a live feed.
Seasons without an entry show "Opening date TBA" instead of stale dates.

## Local development

```sh
npm run build    # fetch live data into public/data.json
npm run preview  # http://localhost:8787 (file URLs keep a literal __V__ locally; CI stamps it)
npm test
```

No npm dependencies; needs Node 20+. Leaflet 1.9.4 (BSD-2) is vendored in `public/vendor/leaflet/`.
Map tiles come from OpenTopoMap (no key needed).
