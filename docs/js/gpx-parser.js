// GPX parser: XML → track + computed stats
// One GPX file = one track. We compute distance via Haversine, moving time,
// elevation gain/loss, max/avg speed, bbox, and downsample for map rendering.

const R_EARTH_M = 6371000;
const MOVING_SPEED_KMH = 2;       // below this, treat as stopped
const MAX_GAP_SEC = 30;           // gap longer than this = paused
const SPEED_OUTLIER_KMH = 250;    // ignore impossible GPS jumps
const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000; // GPX times are UTC; shift to UTC+8 for display

function parseTrackpointTime(text) {
  if (!text) return null;
  const d = new Date(text);
  if (isNaN(d)) return null;
  return new Date(d.getTime() + UTC8_OFFSET_MS);
}

const parser = new DOMParser();

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(a));
}

// Pull a track datestamp out of the filename like "20260312_110126.gpx"
// (RunningFree convention). Falls back to first point time.
function parseFilenameTime(filename) {
  const m = filename.match(/(\d{8})_(\d{6})/);
  if (!m) return null;
  const d = m[1], t = m[2];
  const iso = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}`;
  const local = new Date(iso);
  return isNaN(local) ? null : local;
}

export function parseGPX(xmlText, filename) {
  const doc = parser.parseFromString(xmlText, 'text/xml');
  // querySelector isn't supported by every minimal DOM (e.g. xmldom);
  // getElementsByTagName works everywhere we care about.
  const errNodes = doc.getElementsByTagName('parsererror');
  if (errNodes && errNodes.length > 0) throw new Error(`GPX parse error in ${filename}`);

  const trkptNodes = doc.getElementsByTagName('trkpt');
  if (trkptNodes.length === 0) return null;

  const points = [];
  for (let i = 0; i < trkptNodes.length; i++) {
    const n = trkptNodes[i];
    const lat = parseFloat(n.getAttribute('lat'));
    const lon = parseFloat(n.getAttribute('lon'));
    if (!isFinite(lat) || !isFinite(lon)) continue;

    const eleEl = n.getElementsByTagName('ele')[0];
    const timeEl = n.getElementsByTagName('time')[0];
    const speedEl = n.getElementsByTagName('speed')[0];

    const ele = eleEl ? parseFloat(eleEl.textContent) : null;
    const time = timeEl ? parseTrackpointTime(timeEl.textContent) : null;
    const speed = speedEl ? parseFloat(speedEl.textContent) : null; // km/h per source

    points.push({ lat, lon, ele, time, speed });
  }
  if (points.length < 2) return null;

  // ---- Aggregate stats ----
  let distance = 0;
  let movingTime = 0;
  let totalTime = 0;
  let elevationGain = 0;
  let elevationLoss = 0;
  let maxSpeed = 0;
  let speedSum = 0, speedCount = 0;
  let movingSpeedSum = 0, movingSpeedCount = 0;

  let minLat = points[0].lat, maxLat = points[0].lat;
  let minLon = points[0].lon, maxLon = points[0].lon;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];

    if (b.lat < minLat) minLat = b.lat; else if (b.lat > maxLat) maxLat = b.lat;
    if (b.lon < minLon) minLon = b.lon; else if (b.lon > maxLon) maxLon = b.lon;

    const segDist = haversine(a.lat, a.lon, b.lat, b.lon);
    distance += segDist;

    const dt = (a.time && b.time) ? (b.time - a.time) / 1000 : 1;
    if (dt > 0 && dt < MAX_GAP_SEC) {
      totalTime += dt;
      // Prefer GPX speed if present, else derive from segDist/dt
      const segSpeed = (b.speed != null && isFinite(b.speed)) ? b.speed : (segDist / dt) * 3.6;
      if (segSpeed >= MOVING_SPEED_KMH) {
        movingTime += dt;
        movingSpeedSum += segSpeed;
        movingSpeedCount++;
      }
      if (segSpeed < SPEED_OUTLIER_KMH && segSpeed > maxSpeed) maxSpeed = segSpeed;
      speedSum += segSpeed;
      speedCount++;
    }

    if (a.ele != null && b.ele != null) {
      const dEle = b.ele - a.ele;
      if (dEle > 0) elevationGain += dEle;
      else elevationLoss += -dEle;
    }
  }

  const startTime = points[0].time || parseFilenameTime(filename);
  const endTime = points[points.length - 1].time || startTime;

  // Downsample for map rendering: keep at most ~400 points per track,
  // preserving the start/end and visually significant turns is overkill —
  // simple stride works fine at zoomed-out scale.
  const stride = Math.max(1, Math.floor(points.length / 400));
  const polyline = [];
  for (let i = 0; i < points.length; i += stride) {
    polyline.push([points[i].lat, points[i].lon]);
  }
  // Always keep last point so the line ends where the ride ended
  const last = points[points.length - 1];
  const lastInPoly = polyline[polyline.length - 1];
  if (!lastInPoly || lastInPoly[0] !== last.lat || lastInPoly[1] !== last.lon) {
    polyline.push([last.lat, last.lon]);
  }

  return {
    filename,
    startTime: startTime ? startTime.toISOString() : null,
    endTime: endTime ? endTime.toISOString() : null,
    duration: totalTime,
    movingTime,
    distance,                              // meters
    maxSpeed,                              // km/h
    avgSpeed: speedCount ? speedSum / speedCount : 0,
    avgMovingSpeed: movingSpeedCount ? movingSpeedSum / movingSpeedCount : 0,
    elevationGain,
    elevationLoss,
    bbox: { minLat, maxLat, minLon, maxLon },
    pointCount: points.length,
    polyline,                              // [[lat,lon], ...] downsampled
  };
}

export function trackCenter(track) {
  const b = track.bbox;
  return [(b.minLat + b.maxLat) / 2, (b.minLon + b.maxLon) / 2];
}
