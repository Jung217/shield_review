// Aggregate per-track records into a Wrapped-style summary.
// Pure functions, no DOM access — call once after parsing, store result.

const DOW_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const HOUR_LABEL = h => `${String(h).padStart(2,'0')}`;

export function computeSummary(tracks) {
  if (!tracks || tracks.length === 0) {
    return { empty: true };
  }

  let totalDistance = 0;
  let totalDuration = 0;
  let totalMovingTime = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;
  let totalPoints = 0;

  let longestTrack = tracks[0];
  let fastestTrack = tracks[0];

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;

  const byHour = new Array(24).fill(0);
  const byHourDistance = new Array(24).fill(0);
  const byDow = new Array(7).fill(0);
  const byDowDistance = new Array(7).fill(0);
  const byMonth = {};        // 'YYYY-MM' → { count, distance, duration }
  const speedHisto = new Array(20).fill(0); // 0–10, 10–20, …, 190+ km/h

  const activeDays = new Set();

  for (const t of tracks) {
    totalDistance += t.distance;
    totalDuration += t.duration;
    totalMovingTime += t.movingTime;
    totalElevationGain += t.elevationGain;
    totalElevationLoss += t.elevationLoss;
    totalPoints += t.pointCount;

    if (t.distance > longestTrack.distance) longestTrack = t;
    if (t.maxSpeed > fastestTrack.maxSpeed) fastestTrack = t;

    if (t.bbox.minLat < minLat) minLat = t.bbox.minLat;
    if (t.bbox.maxLat > maxLat) maxLat = t.bbox.maxLat;
    if (t.bbox.minLon < minLon) minLon = t.bbox.minLon;
    if (t.bbox.maxLon > maxLon) maxLon = t.bbox.maxLon;

    if (t.startTime) {
      const d = new Date(t.startTime);
      const h = d.getHours();
      const dow = d.getDay();
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`;
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

      byHour[h]++;
      byHourDistance[h] += t.distance;
      byDow[dow]++;
      byDowDistance[dow] += t.distance;

      if (!byMonth[ym]) byMonth[ym] = { count: 0, distance: 0, duration: 0 };
      byMonth[ym].count++;
      byMonth[ym].distance += t.distance;
      byMonth[ym].duration += t.duration;

      activeDays.add(ymd);
    }

    const bucket = Math.min(19, Math.floor(t.maxSpeed / 10));
    speedHisto[bucket]++;
  }

  // Longest streak of consecutive active days
  const sortedDays = [...activeDays].sort();
  let longestStreak = 0, currentStreak = 0, prev = null;
  let streakEnd = null, longestStreakEnd = null;
  for (const day of sortedDays) {
    if (prev) {
      const diff = (new Date(day) - new Date(prev)) / 86400000;
      if (diff === 1) currentStreak++;
      else currentStreak = 1;
    } else {
      currentStreak = 1;
    }
    if (currentStreak > longestStreak) {
      longestStreak = currentStreak;
      longestStreakEnd = day;
    }
    prev = day;
  }
  const longestStreakStart = longestStreakEnd
    ? offsetDay(longestStreakEnd, -(longestStreak - 1))
    : null;

  // Earliest / latest start hour (with full timestamps for context)
  let earliest = null, latest = null;
  for (const t of tracks) {
    if (!t.startTime) continue;
    const d = new Date(t.startTime);
    const minutesOfDay = d.getHours() * 60 + d.getMinutes();
    if (earliest == null || minutesOfDay < earliest.minutes) {
      earliest = { minutes: minutesOfDay, track: t };
    }
    if (latest == null || minutesOfDay > latest.minutes) {
      latest = { minutes: minutesOfDay, track: t };
    }
  }

  // Coverage area (bbox in km²) — rough but visually meaningful
  const dLat = maxLat - minLat;
  const dLon = maxLon - minLon;
  const meanLat = (minLat + maxLat) / 2;
  const kmPerDegLat = 110.574;
  const kmPerDegLon = 111.320 * Math.cos(meanLat * Math.PI / 180);
  const coverageKm2 = Math.max(0, dLat * kmPerDegLat * dLon * kmPerDegLon);

  const peakHour = argmax(byHour);
  const peakDow = argmax(byDow);

  // Date range across the dataset
  const startTimes = tracks.map(t => t.startTime).filter(Boolean).sort();
  const endTimes = tracks.map(t => t.endTime).filter(Boolean).sort();
  const dateStart = startTimes[0] ? new Date(startTimes[0]) : null;
  const dateEnd = endTimes[endTimes.length - 1] ? new Date(endTimes[endTimes.length - 1]) : null;
  const spanDays = (dateStart && dateEnd) ? Math.max(1, Math.round((dateEnd - dateStart) / 86400000) + 1) : null;

  return {
    empty: false,
    trackCount: tracks.length,
    totalDistance, totalDuration, totalMovingTime,
    totalElevationGain, totalElevationLoss, totalPoints,
    dateRange: {
      start: dateStart ? dateStart.toISOString() : null,
      end: dateEnd ? dateEnd.toISOString() : null,
      spanDays,
    },
    daysActive: activeDays.size,
    longestStreak,
    longestStreakRange: longestStreakStart && longestStreakEnd
      ? { start: longestStreakStart, end: longestStreakEnd } : null,
    longestTrack: stripPolyline(longestTrack),
    fastestTrack: stripPolyline(fastestTrack),
    earliestRide: earliest ? {
      minutes: earliest.minutes, time: earliest.track.startTime,
      filename: earliest.track.filename,
    } : null,
    latestRide: latest ? {
      minutes: latest.minutes, time: latest.track.startTime,
      filename: latest.track.filename,
    } : null,
    byHour, byHourDistance, byDow, byDowDistance, byMonth,
    speedHisto,
    bbox: { minLat, maxLat, minLon, maxLon },
    coverageKm2,
    peakHour, peakDow,
    labels: { dow: DOW_LABELS, hour: Array.from({length:24}, (_,i)=>HOUR_LABEL(i)) },
  };
}

function argmax(arr) {
  let idx = 0, best = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > best) { best = arr[i]; idx = i; }
  }
  return idx;
}

function offsetDay(ymd, days) {
  const d = new Date(ymd);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function stripPolyline(t) {
  // Keep polyline so dashboard can show mini-maps, but remove deep refs.
  return { ...t };
}

// ============ Formatters ============
export function fmtKm(meters)   { return (meters / 1000).toFixed(meters >= 100000 ? 0 : 1); }
export function fmtKmFull(meters){ return `${fmtKm(meters)} km`; }
export function fmtDuration(sec) {
  if (!sec || sec < 0) return '0 分鐘';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h === 0) return `${m} 分鐘`;
  if (h < 24) return `${h} 小時 ${m} 分`;
  const d = Math.floor(h / 24);
  return `${d} 天 ${h % 24} 小時`;
}
export function fmtSpeed(kmh)   { return `${kmh.toFixed(1)} km/h`; }
export function fmtTimeOfDay(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}
export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const date = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  return `${date} ${time}`;
}
