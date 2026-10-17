function dayKey(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ''
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function metrics(history, days = 7, now = new Date(), typingSpeed = 45) {
  const floor = new Date(now);
  floor.setHours(0, 0, 0, 0);
  floor.setDate(floor.getDate() - Math.max(0, days - 1));
  const rows = history.filter((row) => {
    const date = new Date(row.CreatedAt);
    return !Number.isNaN(date.getTime()) && date <= now && (!days || date >= floor);
  });
  let words = 0,
    seconds = 0,
    corrections = 0;
  const byDay = {},
    apps = new Map();
  for (const row of rows) {
    const w = Math.max(0, Number(row.WordCount) || 0),
      s = Math.max(0, Number(row.DurationSeconds) || 0);
    words += w;
    seconds += s;
    corrections += Number(row.Corrections) || 0;
    const key = dayKey(row.CreatedAt);
    byDay[key] = (byDay[key] || 0) + w;
    const app = row.Application || 'Application';
    apps.set(app, (apps.get(app) || 0) + w);
  }
  return {
    rows,
    words,
    seconds,
    corrections,
    speed: seconds ? Math.round((words / seconds) * 60) : 0,
    saved: Math.max(0, words / Math.max(5, Number(typingSpeed) || 45) - seconds / 60),
    byDay,
    apps: [...apps]
      .map(([name, count]) => ({ name, words: count, percent: words ? (count / words) * 100 : 0 }))
      .sort((a, b) => b.words - a.words),
  };
}
module.exports = { metrics, dayKey };
