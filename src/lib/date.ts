export function startOfWeek(d = new Date()) {
  const x = new Date(d);
  const day = x.getDay(); // 0 Sun
  const diff = (day + 6) % 7; // Monday=0
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfMonth(d = new Date()) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function iso(d: Date) {
  return d.toISOString();
}