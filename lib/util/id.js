export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function slugify(input, fallback = "item") {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || fallback;
}

// Filesystem-safe timestamp with millisecond precision so two artifacts
// produced in the same second do not collide on disk (approvals,
// grill sessions, reviews, discoveries all use this for their id).
export function timestampStamp(date = new Date()) {
  const iso = date.toISOString();
  return iso.replace(/[:T]/g, "-").replace(/\.(\d+)Z$/, "-$1Z");
}
