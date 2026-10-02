/* FAST AMINOS WELLNESS · Progress Tracker
 *
 * How the numbers work
 *   - Every check-in runs the US Navy tape formula (waist, neck, hips for women, height).
 *   - On gym days the trainer also records an Omron reading. The gap between the
 *     Omron and the tape estimate is that client's correction.
 *   - Home check-ins use tape + the most recent correction, so they stay in line
 *     with the gym number without needing the device.
 *
 * Add ?demo to the URL for a sample trainer view, or ?demo=client for the client view.
 * Nothing is saved in demo mode.
 */
(function () {
"use strict";

/* ---------- small helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { if (v === "" || v == null) return null; const n = typeof v === "number" ? v : parseFloat(v); return isFinite(n) ? n : null; };
const f1 = n => n == null ? "–" : (Math.round(n * 10) / 10).toFixed(1);
const sgn = n => (n > 0 ? "+" : n < 0 ? "−" : "±") + f1(Math.abs(n));
const pad = n => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const toDate = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const days = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
const fmtD = (s, yr) => toDate(s).toLocaleDateString("en-US", yr ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
const ageAt = (dob, at) => { if (!dob) return null; const b = toDate(dob), d = toDate(at); let a = d.getFullYear() - b.getFullYear(); if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) a--; return a; };
const htStr = h => h ? `${Math.floor(h / 12)}′${Math.round((h % 12) * 2) / 2}″` : "";
const firstName = n => String(n || "").trim().split(/\s+/)[0] || "there";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "x" + Math.random().toString(36).slice(2) + Date.now().toString(36));
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3600); }
function banner(msg) { $("#banner").hidden = !msg; $("#bannerText").textContent = msg || ""; }

const ICON_OK = `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_WARN = `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5L11 10.5H1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6 5v2.4M6 8.9v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

/* ---------- body composition math ---------- */
function navy(sex, h, waist, neck, hip) {
  if (!h || !waist || !neck) return null;
  let v;
  if (sex === "male") { const d = waist - neck; if (d <= 0) return null; v = 86.010 * Math.log10(d) - 70.041 * Math.log10(h) + 36.76; }
  else { if (!hip) return null; const d = waist + hip - neck; if (d <= 0) return null; v = 163.205 * Math.log10(d) - 97.684 * Math.log10(h) - 78.387; }
  return (v > 2 && v < 70) ? v : null;
}
function offsetAt(cal, date) { let off = null; for (const k of cal) { if (k.date <= date) off = k.off; } if (off == null && cal.length) off = cal[0].off; return off; }
function series(c, entries) {
  const es = entries.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.createdAt).localeCompare(String(b.createdAt)));
  const rows = es.map(e => ({ e, tape: navy(c.sex, c.height, e.waist, e.neck, e.hip) }));
  const cal = rows.filter(r => r.e.omron != null && r.tape != null).map(r => ({ date: r.e.date, off: r.e.omron - r.tape }));
  rows.forEach((r, i) => {
    r.offset = offsetAt(cal, r.e.date);
    if (r.e.omron != null) { r.bf = r.e.omron; r.src = "omron"; }
    else if (r.tape != null) { r.bf = r.tape + (r.offset ?? 0); r.src = r.offset != null ? "cal" : "tape"; }
    else { r.bf = null; r.src = null; }
    r.lean = (r.bf != null && r.e.weight) ? r.e.weight * (1 - r.bf / 100) : null;
    r.fat = (r.bf != null && r.e.weight) ? r.e.weight * r.bf / 100 : null;
    r.flags = [];
    const p = rows[i - 1];
    /* Tape is optional, so compare tape with the last check-in that has tape. */
    const pt = rows.slice(0, i).reverse().find(x => x.e.waist != null || x.e.neck != null);
    if (pt) {
      const dt = Math.max(days(pt.e.date, r.e.date), 1);
      if (pt.e.waist && r.e.waist && Math.abs(r.e.waist - pt.e.waist) >= 1 && dt <= 14) r.flags.push(`Waist moved ${sgn(r.e.waist - pt.e.waist)} in over ${dt} days. Re-tape to confirm.`);
      if (pt.e.neck && r.e.neck && Math.abs(r.e.neck - pt.e.neck) >= 0.75) r.flags.push(`Neck changed ${sgn(r.e.neck - pt.e.neck)} in. Neck rarely moves this much; check tape placement.`);
    }
    if (p) {
      const dd = Math.max(days(p.e.date, r.e.date), 1);
      /* Day-to-day swings of a few pounds are normal water and food weight; only flag big or sustained jumps. */
      const dw = Math.abs(r.e.weight - p.e.weight);
      if (p.e.weight && r.e.weight && dd <= 21 && (dd >= 4 ? dw / p.e.weight / (dd / 7) > 0.02 : dw >= 5)) r.flags.push(`Weight changed ${sgn(r.e.weight - p.e.weight)} lb in ${dd} day${dd > 1 ? "s" : ""}. Check timing, meals and water.`);
    }
    if (r.e.energy != null && r.e.energy <= 2) r.flags.push(`Low energy (${r.e.energy}/5). Check calories, protein and sleep.`);
    if (r.e.sideEffects && r.e.sideEffects.length) r.flags.push(`GLP-1 side effects: ${r.e.sideEffects.join(", ").toLowerCase()}.`);
    if (r.e.omron != null && r.tape != null && Math.abs(r.e.omron - r.tape) > 6) r.flags.push(`Omron and tape differ by ${f1(Math.abs(r.e.omron - r.tape))} pts. Check hydration and tape spots.`);
  });
  return { rows, cal };
}

/* Plain-English progress summary, written from the numbers. */
function summaryText(c, s, forClient) {
  const rows = s.rows; if (rows.length < 2) return "";
  const withBf = rows.filter(r => r.bf != null);
  const first = rows[0], last = rows[rows.length - 1];
  const wk = Math.max(1, Math.round(days(first.e.date, last.e.date) / 7));
  const you = forClient ? "You" : firstName(c.name);
  const out = [];
  if (withBf.length >= 2) {
    const a = withBf[0], b = withBf[withBf.length - 1];
    const fatD = b.fat - a.fat, leanD = b.lean - a.lean;
    let s1 = `Over ${wk} week${wk > 1 ? "s" : ""}, ${you.toLowerCase() === "you" ? "you've" : you + " has"} `;
    if (fatD <= -0.5) s1 += `lost about ${f1(-fatD)} lb of fat`;
    else if (fatD >= 0.5) s1 += `gained about ${f1(fatD)} lb of fat`;
    else s1 += `held fat mass steady`;
    if (leanD >= 0.5) s1 += ` and added ${f1(leanD)} lb of lean mass.`;
    else if (leanD <= -1) s1 += `, with lean mass down ${f1(-leanD)} lb.`;
    else s1 += ` while keeping lean mass steady.`;
    out.push(s1);
    out.push(`Body fat went from about ${f1(a.bf)}% to ${f1(b.bf)}%.`);
    if (leanD <= -1) out.push(`To protect muscle, keep protein high and keep lifting heavy.`);
  }
  const wD = last.e.weight - first.e.weight;
  const wFirst = rows.find(r => r.e.waist), wLast = [...rows].reverse().find(r => r.e.waist);
  let s3 = `Scale weight is ${wD < 0 ? "down" : wD > 0 ? "up" : "unchanged at"} ${wD ? f1(Math.abs(wD)) + " lb" : f1(last.e.weight) + " lb"}`;
  if (wFirst && wLast && wFirst !== wLast) { const d = wLast.e.waist - wFirst.e.waist; s3 += `, and the waist is ${d < 0 ? "down" : d > 0 ? "up" : "unchanged,"} ${d ? f1(Math.abs(d)) + " in" : ""}`.replace(/\s+$/, ""); }
  out.push(s3 + ".");
  if (!s.cal.length) out.push(`Next gym visit, take an Omron reading so the estimates can be calibrated.`);
  else { const ago = days(s.cal[s.cal.length - 1].date, todayISO()); if (ago > 42) out.push(`It's been ${ago} days since the last Omron reading, so a gym check-in is due.`); }
  return out.join(" ");
}

/* ---------- data backends ---------- */
const BUCKET = "progress-photos";
const fromClientRow = r => ({ id: r.id, userId: r.user_id, email: r.email, name: r.name, sex: r.sex, dob: r.dob, height: num(r.height_in), goal: r.goal, glp1: !!r.on_glp1 });
const toClientRow = c => ({ email: c.email, name: c.name, sex: c.sex, dob: c.dob || null, height_in: c.height, goal: c.goal || null, on_glp1: !!c.glp1 });
const FEEL_KEYS = ["energy", "hunger", "sleep_q", "sleep_hours", "steps", "side_effects"];
const SIDE_EFFECTS = ["Nausea", "Vomiting", "Constipation", "Diarrhea", "Heartburn", "Bloating", "Tired", "Headache", "Dizzy", "Low appetite"];
const fromCheckinRow = r => ({ id: r.id, clientId: r.client_id, date: r.date, weight: num(r.weight_lb), waist: num(r.waist_in), neck: num(r.neck_in), hip: num(r.hip_in), omron: num(r.omron_bf), photoFront: r.photo_front, photoSide: r.photo_side, note: r.note, energy: num(r.energy), hunger: num(r.hunger), sleepQ: num(r.sleep_q), sleepH: num(r.sleep_hours), steps: num(r.steps), sideEffects: Array.isArray(r.side_effects) ? r.side_effects : [], coachNote: r.coach_note || null, coachNoteAt: r.coach_note_at || null, enteredBy: r.entered_by, createdAt: r.created_at });
const fromWorkoutRow = r => ({ id: r.id, clientId: r.client_id, date: r.date, dayName: r.day_name || "", entries: Array.isArray(r.entries) ? r.entries : [], note: r.note || "", enteredBy: r.entered_by, createdAt: r.created_at });
const fromHealthRow = r => ({ date: r.date, steps: num(r.steps), sleepH: num(r.sleep_hours), weight: num(r.weight_lb), kcal: num(r.active_kcal), exMin: num(r.exercise_min), rhr: num(r.resting_hr), updatedAt: r.updated_at });
const fromTplRow = r => ({ id: r.id, name: r.name, title: r.title || "", notes: r.notes || "", days: Array.isArray(r.days) ? r.days : [] });
const fromPlanRow = r => r ? ({ title: r.title || "", notes: r.notes || "", days: Array.isArray(r.days) ? r.days : [], updatedAt: r.updated_at }) : null;
/* Supabase reports a missing table/column when the October 2026 database update hasn't been run yet. */
const isMissing = e => !!e && (e.code === "42P01" || e.code === "42703" || e.code === "PGRST205" || e.code === "PGRST204" || /does not exist|schema cache/i.test(e.message || ""));
const toCheckinRow = e => ({ client_id: e.clientId, date: e.date, weight_lb: e.weight, waist_in: e.waist, neck_in: e.neck, hip_in: e.hip, omron_bf: e.omron, photo_front: e.photoFront, photo_side: e.photoSide, note: e.note,
  energy: e.energy ?? null, hunger: e.hunger ?? null, sleep_q: e.sleepQ ?? null, sleep_hours: e.sleepH ?? null, steps: e.steps ?? null, side_effects: e.sideEffects && e.sideEffects.length ? e.sideEffects : null });
/* Before the October 2026 database update the new columns don't exist yet; save without them. */
const withoutFeel = row => { const r = { ...row }; FEEL_KEYS.forEach(k => delete r[k]); delete r.on_glp1; return r; };

function supaApi(sb) {
  const chk = ({ data, error }) => { if (error) throw error; return data; };
  return {
    async isTrainer(userId) { return !!chk(await sb.from("trainers").select("user_id").eq("user_id", userId).maybeSingle()); },
    async listClients() { return chk(await sb.from("clients").select("*").order("name")).map(fromClientRow); },
    async listCheckins(clientId) { return chk(await sb.from("checkins").select("*").eq("client_id", clientId).order("date").order("created_at")).map(fromCheckinRow); },
    async saveClient(c, id) {
      const save = row => id ? sb.from("clients").update(row).eq("id", id).select().single() : sb.from("clients").insert(row).select().single();
      let res = await save(toClientRow(c));
      if (res.error && isMissing(res.error)) { res = await save(withoutFeel(toClientRow(c))); if (!res.error) toast("Saved. Run the database update in tracker/SETUP.md to keep the GLP-1 setting."); }
      return fromClientRow(chk(res));
    },
    async deleteClient(id) {
      const files = chk(await sb.storage.from(BUCKET).list(id, { limit: 1000 })) || [];
      if (files.length) await sb.storage.from(BUCKET).remove(files.map(f => id + "/" + f.name));
      chk(await sb.from("clients").delete().eq("id", id));
    },
    async addCheckin(e) {
      let res = await sb.from("checkins").insert(toCheckinRow(e)).select().single();
      if (res.error && isMissing(res.error)) { res = await sb.from("checkins").insert(withoutFeel(toCheckinRow(e))).select().single(); if (!res.error) toast("Check-in saved. The how-you-feel answers need the latest database update."); }
      return fromCheckinRow(chk(res));
    },
    async deleteCheckin(e) {
      chk(await sb.from("checkins").delete().eq("id", e.id));
      const p = [e.photoFront, e.photoSide].filter(Boolean);
      if (p.length) await sb.storage.from(BUCKET).remove(p);
    },
    async uploadPhoto(clientId, blob) {
      const path = clientId + "/" + uid() + ".jpg";
      chk(await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false }));
      return path;
    },
    async photoUrls(paths) {
      if (!paths.length) return {};
      const d = chk(await sb.storage.from(BUCKET).createSignedUrls(paths, 6 * 3600));
      const m = {}; (d || []).forEach(x => { if (x.signedUrl) m[x.path] = x.signedUrl; }); return m;
    },
    async getPlan(clientId) { return fromPlanRow(chk(await sb.from("client_plans").select("*").eq("client_id", clientId).maybeSingle())); },
    async savePlan(clientId, p) { return fromPlanRow(chk(await sb.from("client_plans").upsert({ client_id: clientId, title: p.title || null, notes: p.notes || null, days: p.days }, { onConflict: "client_id" }).select().single())); },
    async deletePlan(clientId) { chk(await sb.from("client_plans").delete().eq("client_id", clientId)); },
    async saveFeedback(checkinId, note) { return fromCheckinRow(chk(await sb.from("checkins").update({ coach_note: note || null }).eq("id", checkinId).select().single())); },
    async listTemplates() { return chk(await sb.from("plan_templates").select("*").order("name")).map(fromTplRow); },
    async listHealth(clientId) { return chk(await sb.from("health_daily").select("*").eq("client_id", clientId).order("date", { ascending: false }).limit(120)).map(fromHealthRow); },
    async upsertHealth(clientId, rows) {
      /* Values outside the database limits are dropped (not the whole day), so one odd reading never blocks a sync. */
      const rng = (v, lo, hi, int) => { const n = num(v); if (n == null || n < lo || n > hi) return null; return int ? Math.round(n) : n; };
      const clean = rows.map(r => ({ client_id: clientId, date: r.date, steps: rng(r.steps, 0, 200000, true), sleep_hours: rng(r.sleepHours, 0, 24), weight_lb: rng(r.weightLb, 50, 900), active_kcal: rng(r.activeKcal, 0, 20000, true), exercise_min: rng(r.exerciseMin, 0, 1440, true), resting_hr: rng(r.restingHr, 20, 250, true), source: "apple_health" }));
      if (clean.length) chk(await sb.from("health_daily").upsert(clean, { onConflict: "client_id,date" }));
    },
    async listWorkouts(clientId) { return chk(await sb.from("workout_logs").select("*").eq("client_id", clientId).order("date", { ascending: false }).order("created_at", { ascending: false }).limit(300)).map(fromWorkoutRow); },
    async addWorkout(w) { return fromWorkoutRow(chk(await sb.from("workout_logs").insert({ client_id: w.clientId, date: w.date, day_name: w.dayName || null, entries: w.entries, note: w.note || null }).select().single())); },
    async deleteWorkout(id) { chk(await sb.from("workout_logs").delete().eq("id", id)); },
    async saveTemplate(t, id) {
      const row = { name: t.name, title: t.title || null, notes: t.notes || null, days: t.days };
      return fromTplRow(id ? chk(await sb.from("plan_templates").update(row).eq("id", id).select().single()) : chk(await sb.from("plan_templates").insert(row).select().single()));
    },
    async deleteTemplate(id) { chk(await sb.from("plan_templates").delete().eq("id", id)); }
  };
}

function demoApi(asClient) {
  const clients = [
    { id: "c1", userId: asClient ? "me" : "u1", email: "sample.client@example.com", name: "Sample Client", sex: "female", dob: "1990-04-12", height: 65, goal: "Lose fat, keep lean mass", glp1: true },
    { id: "c2", userId: null, email: "sample.two@example.com", name: "Sample Client Two", sex: "male", dob: "1984-11-02", height: 70, goal: "Recomp for summer" }
  ];
  const raw = [["c1","2026-06-08",162.4,31.5,13.5,39.8,30.1],["c1","2026-06-22",161.0,31.2,13.5,39.6],["c1","2026-07-06",159.8,30.9,13.4,39.4],["c1","2026-07-20",158.6,30.6,13.4,39.3,28.9],["c1","2026-08-03",157.9,30.4,13.4,39.1],["c1","2026-08-17",156.8,30.1,13.3,38.9],["c1","2026-08-31",156.2,29.9,13.3,38.8,27.4],["c1","2026-09-14",155.5,29.7,13.3,38.6],["c1","2026-09-28",155.1,29.3,13.3,38.5],
               ["c2","2026-07-15",212.6,40.5,16.2,null,26.8],["c2","2026-07-29",210.9,40.1,16.2,null],["c2","2026-08-05",210.2,38.8,16.1,null],["c2","2026-08-19",208.4,39.6,16.2,null]];
  const fb = { 7: "Waist keeps trending down and lean mass is holding. Exactly what we want. Keep protein up and stay consistent with the 45/30.", 8: "Another solid week! You're down 2.2 inches on the waist since June. Let's add 5 lb to your hip thrusts this week." };
  const feel = [[3, 4, 3, 6.4, 5200, ["Nausea", "Low appetite"]], [3, 3, 3, 6.6, 6100, ["Nausea"]], [4, 3, 3, 6.9, 7000, []], [4, 2, 4, 7.0, 7400, ["Constipation"]], [4, 3, 4, 7.2, 8100, []], [3, 3, 3, 6.5, 7600, []], [4, 2, 4, 7.3, 8800, []], [5, 2, 4, 7.4, 9300, []], [5, 2, 5, 7.6, 9800, []]];
  let entries = raw.map((r, i) => ({ id: "e" + i, ...(r[0] === "c1" && feel[i] ? { energy: feel[i][0], hunger: feel[i][1], sleepQ: feel[i][2], sleepH: feel[i][3], steps: feel[i][4], sideEffects: feel[i][5] } : { sideEffects: [] }), clientId: r[0], date: r[1], weight: r[2], waist: r[3], neck: r[4], hip: r[5], omron: r[6] ?? null, note: i === 0 ? "Baseline at the gym" : null, coachNote: fb[i] || null, coachNoteAt: fb[i] ? r[1] + "T18:00:00Z" : null, enteredBy: (r[6] != null || !asClient) ? "trainer" : "me", createdAt: String(i).padStart(4, "0") }));
  const L = window.WORKOUT_LIBRARY || [], li = id => (L.find(w => w.id === id) || { items: [], ref: "" });
  const fromLib = (id, n) => li(id).items.slice(0, n || 99).map(x => ({ ...x, note: "", ref: li(id).ref }));
  const plans = { c1: { title: "Phase 1: Build the base", notes: "3 strength days a week, then 30 minutes of Zone 2 right after each one. Rest at least one day between sessions.", days: [
    { name: "Lower body", items: [...fromLib("gym/glutes", 3), { name: "Incline treadmill walk", sets: "1", reps: "30 min", rest: "", note: "Zone 2: you can talk, but not sing.", ref: "" }] },
    { name: "Upper body", items: fromLib("gym/back", 3).concat(fromLib("gym/chest", 2)) },
    { name: "Full body at home", items: fromLib("home/full-body") } ], updatedAt: "2026-09-28T18:00:00Z" } };
  /* Sample logged workouts: Upper body and Lower body over four weeks, getting stronger. */
  const logDay = (date, dayIdx, bump) => {
    const day = plans.c1.days[dayIdx];
    const entries = day.items.map((x, k) => {
      if (/min|sec/i.test(x.reps)) return { name: x.name, ref: x.ref, target: `${x.sets} × ${x.reps}`, timed: true, done: true, sets: [] };
      const base = [95, 25, 40, 60, 70][k] ?? 30;
      const sets = Array.from({ length: parseInt(x.sets, 10) || 3 }, (_, si) => ({ lb: base + bump * 5, reps: Math.max(6, 10 - si + (bump >= 3 ? 2 : 0)) }));
      return { name: x.name, ref: x.ref, target: `${x.sets} × ${x.reps}`, timed: false, done: true, sets };
    });
    return { id: "w" + date + dayIdx, clientId: "c1", date, dayName: day.name, note: "", enteredBy: "me", createdAt: date + "T17:00:00Z", entries };
  };
  let workouts = [logDay("2026-09-07", 0, 0), logDay("2026-09-08", 1, 0), logDay("2026-09-14", 0, 1), logDay("2026-09-15", 1, 1), logDay("2026-09-21", 0, 2), logDay("2026-09-22", 1, 2), logDay("2026-09-28", 0, 3), logDay("2026-09-29", 1, 3)];
  /* Sample Apple Health days for the demo client, newest first. */
  const health = Array.from({ length: 21 }, (_, i) => { const d = new Date(2026, 9, 1 - i); const iso = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    return { date: iso, steps: 7000 + ((i * 1337) % 4200), sleepH: 6.4 + ((i * 7) % 12) / 10, weight: +(154.6 + i * 0.12).toFixed(1), kcal: 380 + ((i * 53) % 260), exMin: 22 + ((i * 11) % 35), rhr: 61 + (i % 4), updatedAt: "2026-10-01T07:30:00Z" }; });
  const templates = [{ id: "t1", name: "Sample 3-day plan", title: plans.c1.title, notes: plans.c1.notes, days: JSON.parse(JSON.stringify(plans.c1.days)) }];
  const photos = {};
  const wait = () => new Promise(r => setTimeout(r, 120));
  return {
    async isTrainer() { return !asClient; },
    async listClients() { await wait(); return (asClient ? clients.filter(c => c.userId === "me") : clients).slice().sort((a, b) => a.name.localeCompare(b.name)); },
    async listCheckins(id) { await wait(); return entries.filter(e => e.clientId === id); },
    async saveClient(c, id) { await wait(); if (clients.some(x => x.email.toLowerCase() === c.email.toLowerCase() && x.id !== id)) throw { code: "23505" }; if (id) { Object.assign(clients.find(x => x.id === id), c); return clients.find(x => x.id === id); } const n = { ...c, id: uid(), userId: null }; clients.push(n); return n; },
    async deleteClient(id) { await wait(); const i = clients.findIndex(c => c.id === id); if (i >= 0) clients.splice(i, 1); entries = entries.filter(e => e.clientId !== id); },
    async addCheckin(e) { await wait(); const n = { ...e, id: uid(), enteredBy: "me", createdAt: new Date().toISOString(), omron: asClient ? null : e.omron }; entries.push(n); return n; },
    async deleteCheckin(e) { await wait(); entries = entries.filter(x => x.id !== e.id); },
    async uploadPhoto(clientId, blob) { const p = clientId + "/" + uid() + ".jpg"; photos[p] = URL.createObjectURL(blob); return p; },
    async photoUrls(paths) { const m = {}; paths.forEach(p => { if (photos[p]) m[p] = photos[p]; }); return m; },
    async getPlan(id) { await wait(); return plans[id] ? JSON.parse(JSON.stringify(plans[id])) : null; },
    async savePlan(id, p) { await wait(); plans[id] = { ...JSON.parse(JSON.stringify(p)), updatedAt: new Date().toISOString() }; return JSON.parse(JSON.stringify(plans[id])); },
    async deletePlan(id) { await wait(); delete plans[id]; },
    async saveFeedback(eid, note) { await wait(); const e = entries.find(x => x.id === eid); e.coachNote = note || null; e.coachNoteAt = note ? new Date().toISOString() : null; return { ...e }; },
    async listHealth(id) { await wait(); return id === "c1" ? health.slice() : []; },
    async upsertHealth(id, rows) { await wait(); rows.forEach(r => { const i = health.findIndex(h => h.date === r.date); const h = { date: r.date, steps: r.steps ?? null, sleepH: r.sleepHours ?? null, weight: r.weightLb ?? null, kcal: r.activeKcal ?? null, exMin: r.exerciseMin ?? null, rhr: r.restingHr ?? null, updatedAt: new Date().toISOString() }; if (i >= 0) health[i] = h; else health.push(h); }); health.sort((a, b) => b.date.localeCompare(a.date)); },
    async listWorkouts(id) { await wait(); return workouts.filter(w => w.clientId === id).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt))).map(w => JSON.parse(JSON.stringify(w))); },
    async addWorkout(w) { await wait(); const n = { ...JSON.parse(JSON.stringify(w)), id: uid(), enteredBy: "me", createdAt: new Date().toISOString() }; workouts.push(n); return n; },
    async deleteWorkout(id) { await wait(); workouts = workouts.filter(w => w.id !== id); },
    async listTemplates() { await wait(); return templates.map(t => JSON.parse(JSON.stringify(t))).sort((a, b) => a.name.localeCompare(b.name)); },
    async saveTemplate(t, id) { await wait(); const c = JSON.parse(JSON.stringify(t)); if (id) { Object.assign(templates.find(x => x.id === id), c); return { ...c, id }; } const n = { ...c, id: uid() }; templates.push(n); return n; },
    async deleteTemplate(id) { await wait(); const i = templates.findIndex(x => x.id === id); if (i >= 0) templates.splice(i, 1); }
  };
}

/* ---------- state ---------- */
const CFG = window.TRACKER_CONFIG || {};
const params = new URLSearchParams(location.search);
const DEMO = params.has("demo");
const DEMO_CLIENT = params.get("demo") === "client";
const CONFIGURED = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && !/PASTE/.test(CFG.supabaseAnonKey));
const TRAINER = CFG.trainerName || "your trainer";
let VIA_LINK = /access_token|type=(magiclink|signup|recovery|invite)/.test(location.hash) || /[?&](code|token_hash)=/.test(location.search);
/* Inside the Fast Aminos iPhone app the page runs in a web view that can talk to the app. */
const IN_APP = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.faApp);
/* RENOVO branding when opened from the RENOVO app (or with ?brand=renovo for previewing). */
const RENOVO = IN_APP || new URLSearchParams(location.search).get("brand") === "renovo";
if (RENOVO) {
  document.documentElement.classList.add("renovo");
  const brand = document.querySelector(".brand"); if (brand) brand.innerHTML = `<span class="rv-logo">RENOVO<span>COACH</span></span>`;
  const sub = document.querySelector(".brand-sub"); if (sub) sub.textContent = "Renew your body. Rebuild your life.";
  document.title = "RENOVO COACH";
}
const IS_HOME_APP = IN_APP || window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
let sb = null, api = null;
const S = { me: null, isTrainer: false, clients: [], sel: null, checkins: [], plan: null, planMissing: false, templates: [], workouts: [], workoutsMissing: false, health: [], healthMissing: false, app: { connected: false, lastSync: null }, urls: {}, screen: "loading", metric: "bf", view: "front", cmpA: null, cmpB: null, overlay: false, fade: 50, authEmail: "", authStep: "email", pwMode: null, pwBack: null };
const store = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} } };
const client = () => S.clients.find(c => c.id === S.sel) || null;
const canDelete = e => S.isTrainer || (S.me && e.enteredBy === S.me.id);

/* ---------- header ---------- */
function renderBar() {
  const el = $("#barRight");
  if (S.screen !== "app" && S.screen !== "noaccess") { el.innerHTML = ""; return; }
  let h = "";
  if (S.screen === "app" && S.isTrainer && S.clients.length) {
    const opts = S.clients.map(c => `<option value="${esc(c.id)}"${c.id === S.sel ? " selected" : ""}>${esc(c.name)}</option>`).join("");
    h += `<label class="small muted" for="clientPick" hidden>Client</label><select id="clientPick" aria-label="Client">${opts}</select>`;
  }
  if (S.screen === "app" && S.isTrainer) h += `<button class="btn" id="addClient" type="button">Add client</button>`;
  h += `<span class="who" title="${esc(S.me?.email)}">${esc(S.me?.email)}</span>${DEMO ? "" : `<button class="btn ghost sm" id="changePw" type="button">Password</button>`}<button class="btn ghost sm" id="signOut" type="button">${DEMO ? "Exit demo" : "Sign out"}</button>`;
  el.innerHTML = h;
  const p = $("#clientPick"); if (p) p.onchange = () => selectClient(p.value);
  const a = $("#addClient"); if (a) a.onclick = () => openClient(null);
  $("#signOut").onclick = signOut;
  const cp = $("#changePw"); if (cp) cp.onclick = () => { S.pwBack = S.screen; S.pwMode = "change"; S.screen = "password"; render(); };
}

/* ---------- screens ---------- */
function render() {
  renderBar();
  const app = $("#app");
  if (S.screen === "loading") { app.innerHTML = `<div class="skel"></div>`; return; }
  if (S.screen === "setup") { app.innerHTML = setupScreen(); return; }
  if (S.screen === "login") { app.innerHTML = loginScreen(); wireLogin(); return; }
  if (S.screen === "password") { app.innerHTML = passwordScreen(); wirePassword(); return; }
  if (S.screen === "noaccess") { app.innerHTML = noAccessScreen(); return; }
  if (!S.clients.length) { app.innerHTML = welcome(); const b = $("#welcomeAdd"); if (b) b.onclick = () => openClient(null); return; }
  const c = client(); const s = series(c, S.checkins);
  app.innerHTML = `<div class="stack">${head(c, s)}${coachCallout(c)}${tiles(c, s)}${planCard(c)}${healthCard(c)}${workoutsCard(c)}${chartCard(s)}<div class="split">${logCard(c, s)}<div class="stack">${photoCard(s)}${summaryCard(c, s)}</div></div>${RENOVO && !S.isTrainer ? shopCard() : ""}</div>`;
  wire(c, s);
}

function setupScreen() {
  return `<section class="msg"><div class="kicker">Almost ready</div><h1>Connect the tracker to Supabase</h1>
  <p>Paste your Supabase anon key into <code>tracker/config.js</code>, then reload this page. Setup steps are in <code>tracker/SETUP.md</code>.</p>
  <p><a class="btn" href="?demo">Try the demo</a></p></section>`;
}

function loginScreen() {
  if (S.authStep === "code") {
    const codeForm = `<form id="fCode" novalidate><div class="field"><label for="a-code">6-digit code from the email</label><input id="a-code" class="code-in" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10"></div>
      <div class="err" id="aErr"></div><button class="btn primary wide" id="aVerify" type="submit">Sign in</button></form>`;
    if (IS_HOME_APP) {
      return `<section class="auth"><div class="kicker">Check your email</div><h1>Enter your code</h1>
      <p>We sent a sign-in email to <b>${esc(S.authEmail)}</b>. Type the 6-digit code from it here. Tapping the link would open your browser instead of this app.</p>
      ${codeForm}<button class="linkbtn" id="aBack" type="button">Use a different email</button></section>`;
    }
    return `<section class="auth"><div class="kicker">Check your email</div><h1>Tap the link in your email</h1>
    <p>We sent a sign-in link to <b>${esc(S.authEmail)}</b>. Open it on this device and you're in. It can take a minute to arrive, so check spam if you don't see it.</p>
    <details class="codealt"><summary>Have a 6-digit code instead?</summary>${codeForm}</details>
    <button class="linkbtn" id="aBack" type="button">Use a different email</button></section>`;
  }
  return `<section class="auth"><div class="kicker">Client progress tracker</div><h1>Track your progress with ${esc(TRAINER)}</h1>
  <p>Sign in with the email you gave ${esc(TRAINER)} and your password.</p>
  <form id="fPw" novalidate>
    <div class="field"><label for="a-email">Email</label><input id="a-email" type="email" autocomplete="username" inputmode="email" value="${esc(S.authEmail)}"></div>
    <div class="field"><label for="a-pass">Password</label><input id="a-pass" type="password" autocomplete="current-password"></div>
    <label class="showpw" for="a-show"><input id="a-show" type="checkbox"> Show password</label>
    <div class="err" id="aErr"></div><button class="btn primary wide" id="aSignIn" type="submit">Sign in</button></form>
  <div class="or"><span>First time here, or forgot your password?</span></div>
  <button class="btn wide" id="aSend" type="button">Email me a sign-in link</button>
  <p class="small muted">We'll email you a link. After it signs you in, you'll set your password.</p></section>`;
}
function wireLogin() {
  const fp = $("#fPw"), fc = $("#fCode"), sendBtn = $("#aSend");
  const show = $("#a-show"); if (show) show.onchange = () => { $("#a-pass").type = show.checked ? "text" : "password"; };
  if (fp) fp.onsubmit = async ev => {
    ev.preventDefault();
    const email = $("#a-email").value.trim().toLowerCase(), password = $("#a-pass").value, err = $("#aErr"), btn = $("#aSignIn");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = "Enter a valid email address."; return; }
    if (!password) { err.textContent = "Enter your password. First time here? Use \"Email me a sign-in link\" below."; return; }
    btn.disabled = true; btn.textContent = "Signing in…"; err.textContent = "";
    store.set("fa_email", email); S.authEmail = email;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = "Sign in";
    if (error) err.textContent = error.status === 429 ? "Too many attempts. Wait a minute, then try again." : "That email and password don't match. First time here or forgot it? Use \"Email me a sign-in link\" below.";
  };
  if (sendBtn) sendBtn.onclick = async () => {
    const email = $("#a-email").value.trim().toLowerCase(), err = $("#aErr"), btn = sendBtn;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = "Enter a valid email address."; return; }
    btn.disabled = true; btn.textContent = "Sending…"; err.textContent = "";
    const redirect = location.origin + location.pathname;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
    btn.disabled = false; btn.textContent = "Email me a sign-in link";
    if (error) { err.textContent = error.status === 429 ? "Too many sign-in emails. Wait a minute, then try again." : "Couldn't send the email. Check the address and try again."; return; }
    S.authEmail = email; S.authStep = "code"; store.set("fa_email", email); render(); if (IS_HOME_APP) setTimeout(() => $("#a-code")?.focus(), 50);
  };
  if (fc) fc.onsubmit = async ev => {
    ev.preventDefault();
    const token = $("#a-code").value.replace(/\D/g, ""), err = $("#aErr"), btn = $("#aVerify");
    if (token.length < 6) { err.textContent = "Enter the code from the email."; return; }
    btn.disabled = true; btn.textContent = "Signing in…"; err.textContent = "";
    let { error } = await sb.auth.verifyOtp({ email: S.authEmail, token, type: "email" });
    if (error) ({ error } = await sb.auth.verifyOtp({ email: S.authEmail, token, type: "signup" }));
    btn.disabled = false; btn.textContent = "Sign in";
    if (!error) VIA_LINK = true;
    if (error) err.textContent = "That code didn't work. It may have expired. Check the newest email or go back and request a new one.";
  };
  const back = $("#aBack"); if (back) back.onclick = () => { S.authStep = "email"; render(); };
}

function passwordScreen() {
  const create = S.pwMode === "create";
  return `<section class="auth"><div class="kicker">${create ? "One more step" : "Your password"}</div><h1>${create ? "Create your password" : "Set a new password"}</h1>
  <p>${create ? "Next time, sign in with your email and this password. No waiting for an email." : `Signed in as <b>${esc(S.me?.email)}</b>.`}</p>
  <form id="fNewPw" novalidate>
    <input type="email" autocomplete="username" value="${esc(S.me?.email)}" hidden readonly>
    <div class="field"><label for="p-new">New password</label><input id="p-new" type="password" autocomplete="new-password" minlength="8"><span class="hint">At least 8 characters.</span></div>
    <div class="field"><label for="p-again">Type it again</label><input id="p-again" type="password" autocomplete="new-password"></div>
    <label class="showpw" for="p-show"><input id="p-show" type="checkbox"> Show password</label>
    <div class="err" id="pErr"></div><button class="btn primary wide" id="pSave" type="submit">Save password</button></form>
  <button class="linkbtn" id="pSkip" type="button">${create ? "Not now" : "Keep my current password"}</button></section>`;
}
function wirePassword() {
  const show = $("#p-show"); show.onchange = () => { $("#p-new").type = $("#p-again").type = show.checked ? "text" : "password"; };
  const leave = async (skipped) => { if (skipped === true && S.pwMode === "create") store.set("fa_pwskip_" + S.me.id, "1"); VIA_LINK = false; const back = S.pwBack; S.pwMode = null; S.pwBack = null; if (back === "app" || back === "noaccess") { S.screen = back; render(); } else await loadAll(); };
  $("#pSkip").onclick = () => leave(true);
  $("#fNewPw").onsubmit = async ev => {
    ev.preventDefault();
    const a = $("#p-new").value, b = $("#p-again").value, err = $("#pErr"), btn = $("#pSave");
    if (a.length < 8) { err.textContent = "Use at least 8 characters."; return; }
    if (a !== b) { err.textContent = "The two passwords don't match."; return; }
    btn.disabled = true; btn.textContent = "Saving…"; err.textContent = "";
    const { error } = await sb.auth.updateUser({ password: a, data: { password_set: true } });
    btn.disabled = false; btn.textContent = "Save password";
    if (error && error.code !== "same_password") {
      err.textContent = error.code === "weak_password" ? "That password is too easy to guess. Try a longer one." : error.code === "reauthentication_needed" ? "For security, sign out and sign in with an email link, then set your password." : "Couldn't save the password. Try again.";
      return;
    }
    toast("Password saved. Next time, sign in with your email and password.");
    await leave();
  };
  setTimeout(() => $("#p-new")?.focus(), 50);
}

function noAccessScreen() {
  return `<section class="msg"><div class="kicker">Signed in</div><h1>Your tracker isn't set up yet</h1>
  <p>You're signed in as <b>${esc(S.me?.email)}</b>, but ${esc(TRAINER)} hasn't added this email yet. Ask ${esc(TRAINER)} to add you, then reload this page.</p>
  <p class="small">Signed in with a different email than the one you gave ${esc(TRAINER)}? Sign out and use that one.</p></section>`;
}

function welcome() {
  return `<section class="hero"><div><div class="kicker">Trainer setup</div><h1>Omron at the gym. Tape at home.</h1>
  <p>Add a client with their email. Record their baseline at the gym with an Omron reading. They can then sign in from their phone and log weekly tape check-ins, and the app keeps their numbers in line with the gym reading.</p>
  <button class="btn primary" id="welcomeAdd" type="button">Add your first client</button></div>
  <ol class="steps"><li><b>Baseline at the gym</b>Weight, waist, neck and hips, plus an Omron reading and photos.</li>
  <li><b>Home check-ins</b>The client tapes and weighs weekly. The app applies their personal correction.</li>
  <li><b>Recalibrate monthly</b>A fresh Omron reading keeps the estimates honest.</li></ol></section>`;
}

function head(c, s) {
  const t = todayISO(), age = ageAt(c.dob, t);
  const bits = [c.sex === "male" ? "Male" : "Female", age != null ? age + " yrs" : null, htStr(c.height)].filter(Boolean).join(" · ");
  let pill;
  if (!s.cal.length) pill = `<span class="pill warn">${ICON_WARN}${S.isTrainer ? "Not calibrated. Take an Omron reading at the next gym visit." : "Not calibrated yet. Your next gym check-in sets this up."}</span>`;
  else {
    const k = s.cal[s.cal.length - 1], ago = days(k.date, t);
    pill = ago > 42 ? `<span class="pill warn">${ICON_WARN}${S.isTrainer ? "Recalibrate" : "Gym check-in due"}: last Omron ${ago} days ago</span>`
      : `<span class="pill good">${ICON_OK}Calibrated ${sgn(k.off)} pts · Omron ${ago === 0 ? "today" : ago + " days ago"}</span>`;
  }
  const linked = S.isTrainer ? (c.userId ? ` · <span title="${esc(c.email)}">Signed in</span>` : ` · <span title="${esc(c.email)}">Hasn't signed in yet</span>`) : "";
  return `<div class="chead"><div class="grow">${S.isTrainer ? "" : `<div class="kicker">Your progress</div>`}<h1>${esc(c.name)}</h1>
    <div class="meta">${esc(bits)}${c.goal ? ` · Goal: ${esc(c.goal)}` : ""}${linked}</div><div>${pill}</div></div>
    <div class="actions">${calcLink(c, s)}${S.isTrainer ? `<button class="btn" id="editClient" type="button">Edit client</button>` : ""}<button class="btn primary" id="newEntry" type="button">${S.isTrainer ? "New check-in" : "Log check-in"}</button></div></div>
  <details class="how"><summary>How the estimate works</summary><p>Each check-in runs the US Navy tape formula on waist, neck${c.sex === "male" ? "" : ", hips"} and height. On gym days the Omron reading is compared with that number and the gap is saved. Home check-ins use the tape number plus the most recent gap. Omron readings swing with water, food and training, so they're taken at the same time of day, before a workout.</p></details>`;
}

/* Opens the public calculator pre-filled with this client's latest numbers. */
function calcLink(c, s) {
  const last = s.rows[s.rows.length - 1]; if (!last || !c.height) return "";
  const bfRow = [...s.rows].reverse().find(r => r.bf != null);
  const q = new URLSearchParams({ sex: c.sex, ft: String(Math.floor(c.height / 12)), in: String(Math.round((c.height % 12) * 2) / 2), lb: String(last.e.weight) });
  const age = ageAt(c.dob, todayISO()); if (age != null) q.set("age", String(age));
  if (bfRow) q.set("bf", bfRow.bf.toFixed(1));
  return `<a class="btn" href="../calculator/?${q}" target="_blank" rel="noopener">Calories &amp; macros</a>`;
}

function tiles(c, s) {
  const rows = s.rows;
  if (!rows.length) return `<div class="empty">No check-ins yet. ${S.isTrainer ? "Start with a gym baseline: weight, tape measurements and an Omron reading." : "Log your first one: weight and tape measurements."} <button class="btn primary sm" id="firstEntry" type="button">${S.isTrainer ? "Add baseline" : "Log check-in"}</button></div>`;
  const first = rows[0], last = rows[rows.length - 1];
  const firstOf = k => rows.find(r => r[k] != null), lastOf = k => [...rows].reverse().find(r => r[k] != null);
  const since = `since ${fmtD(first.e.date)}`;
  const tile = (label, val, unit, d, src) => `<div class="tile"><span class="lbl">${label}</span><span class="big">${val}<small>${unit}</small></span><span class="delta">${d}</span>${src ? `<span class="src">${src}</span>` : ""}</div>`;
  const bfL = lastOf("bf"), bfF = firstOf("bf"), lnL = lastOf("lean"), lnF = firstOf("lean");
  const wsL = [...rows].reverse().find(r => r.e.waist), wsF = rows.find(r => r.e.waist);
  const srcTxt = r => r.src === "omron" ? `Omron reading, ${fmtD(r.e.date)}` : r.src === "cal" ? "Tape estimate, calibrated" : "Tape estimate, not calibrated";
  return `<div class="tiles">
    ${tile("Weight", f1(last.e.weight), "lb", rows.length > 1 ? `${sgn(last.e.weight - first.e.weight)} lb ${since}` : "Baseline", "")}
    ${bfL ? tile("Body fat", f1(bfL.bf), "%", bfL !== bfF ? `${sgn(bfL.bf - bfF.bf)} pts ${since}` : "Baseline", srcTxt(bfL)) : tile("Body fat", "–", "", "Needs tape or Omron", "")}
    ${lnL ? tile("Lean mass", f1(lnL.lean), "lb", lnL !== lnF ? `${sgn(lnL.lean - lnF.lean)} lb ${since}` : "Baseline", `Fat mass ${f1(lnL.fat)} lb`) : tile("Lean mass", "–", "", "Needs body fat %", "")}
    ${wsL ? tile("Waist", f1(wsL.e.waist), "in", wsL !== wsF ? `${sgn(wsL.e.waist - wsF.e.waist)} in ${since}` : "Baseline", "") : tile("Waist", "–", "", "Not measured", "")}
  </div>`;
}

const METRICS = { bf: { label: "Body fat", unit: "%", get: r => r.bf, span: 4 }, weight: { label: "Weight", unit: "lb", get: r => r.e.weight, span: 6 }, lean: { label: "Lean mass", unit: "lb", get: r => r.lean, span: 4 }, fat: { label: "Fat mass", unit: "lb", get: r => r.fat, span: 4 }, waist: { label: "Waist", unit: "in", get: r => r.e.waist, span: 2 }, energy: { label: "Energy", unit: "/5", get: r => r.e.energy, span: 4, opt: true }, sleep: { label: "Sleep", unit: "h", get: r => r.e.sleepH, span: 2, opt: true }, steps: { label: "Steps", unit: "", get: r => r.e.steps, span: 2000, opt: true } };
function chartCard(s) {
  if (!s.rows.length) return "";
  const m = METRICS[S.metric];
  return `<section class="card"><div class="card-h"><h2>${m.label} over time</h2>
    <div class="seg" role="group" aria-label="Metric">${Object.entries(METRICS).filter(([, v]) => !v.opt || s.rows.some(r => v.get(r) != null)).map(([k, v]) => `<button type="button" data-metric="${k}" aria-pressed="${k === S.metric}">${v.label}</button>`).join("")}</div></div>
    <div class="chart" id="chart"></div>
    <div class="legend"><span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="#fff" stroke="#1769E8" stroke-width="2"/></svg>Home check-in (tape)</span><span><svg width="14" height="14" aria-hidden="true"><rect x="3" y="3" width="8" height="8" transform="rotate(45 7 7)" fill="#1769E8"/></svg>Gym day (Omron)</span></div>
  </section>`;
}
function niceStep(r, n) { const raw = r / n, p = Math.pow(10, Math.floor(Math.log10(raw))), q = raw / p; return (q < 1.5 ? 1 : q < 3 ? 2 : q < 7 ? 5 : 10) * p; }
function drawChart(s) {
  const host = $("#chart"); if (!host) return;
  const m = METRICS[S.metric];
  const pts = s.rows.map(r => ({ r, v: m.get(r), t: toDate(r.e.date).getTime() })).filter(p => p.v != null);
  if (!pts.length) { host.innerHTML = `<div class="empty">No ${m.label.toLowerCase()} values yet.</div>`; return; }
  const W = Math.max(host.clientWidth, 260), H = Math.round(Math.min(300, Math.max(200, W * 0.36)));
  const L = 40, R = 16, T = 22, B = 26;
  let t0 = pts[0].t, t1 = pts[pts.length - 1].t; if (t1 - t0 < 864e5 * 14) { t0 -= 864e5 * 7; t1 += 864e5 * 7; }
  let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
  if (hi - lo < m.span) { const mid = (hi + lo) / 2; lo = mid - m.span / 2; hi = mid + m.span / 2; }
  const step = niceStep(hi - lo, 4); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const x = t => L + (t - t0) / (t1 - t0) * (W - L - R), y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  let g = "";
  for (let v = lo; v <= hi + 1e-9; v += step) { const yy = y(v).toFixed(1); g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="#EEF1F5"/><text x="${L - 8}" y="${+yy + 4}" text-anchor="end">${+v.toFixed(2)}</text>`; }
  const ticks = []; let d = new Date(new Date(t0).getFullYear(), new Date(t0).getMonth() + 1, 1);
  while (d.getTime() <= t1) { ticks.push(d.getTime()); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  const every = Math.ceil(ticks.length / Math.max(2, Math.floor((W - L - R) / 70)));
  ticks.forEach((tk, i) => { if (i % every) return; const xx = x(tk).toFixed(1); g += `<line x1="${xx}" x2="${xx}" y1="${T}" y2="${H - B}" stroke="#EEF1F5" stroke-dasharray="2 3"/><text x="${xx}" y="${H - 8}" text-anchor="middle">${new Date(tk).toLocaleDateString("en-US", { month: "short" })}</text>`; });
  if (!ticks.length) g += `<text x="${x(pts[0].t)}" y="${H - 8}" text-anchor="middle">${fmtD(pts[0].r.e.date)}</text>`;
  const path = pts.map((p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
  const area = pts.length > 1 ? `<path d="${path} L${x(pts[pts.length - 1].t).toFixed(1)} ${H - B} L${x(pts[0].t).toFixed(1)} ${H - B}Z" fill="#1769E8" opacity=".07"/>` : "";
  const marks = pts.map((p, i) => { const cx = x(p.t).toFixed(1), cy = y(p.v).toFixed(1);
    return p.r.e.omron != null ? `<rect x="${(cx - 5).toFixed(1)}" y="${(cy - 5).toFixed(1)}" width="10" height="10" transform="rotate(45 ${cx} ${cy})" fill="#1769E8" stroke="#fff" stroke-width="2"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${i === pts.length - 1 ? 5.5 : 4.5}" fill="#fff" stroke="#1769E8" stroke-width="2"/>`; }).join("");
  const lp = pts[pts.length - 1];
  const endLbl = `<text x="${(x(lp.t) - 10).toFixed(1)}" y="${(y(lp.v) - 12).toFixed(1)}" text-anchor="end" style="fill:#111827;font-weight:700">${f1(lp.v)}${m.unit === "%" ? "%" : " " + m.unit}</text>`;
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${m.label} over time">${g}<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#E7EAF0"/>${area}<path d="${path}" fill="none" stroke="#1769E8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><line id="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#475467" opacity="0"/>${marks}${endLbl}<rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/></svg><div class="tip" id="tip" hidden></div>`;
  const svg = host.querySelector("svg"), tip = $("#tip"), xh = svg.querySelector("#xh");
  const move = ev => {
    const b = svg.getBoundingClientRect(), mx = (ev.clientX - b.left) * (W / b.width);
    let best = pts[0]; for (const p of pts) if (Math.abs(x(p.t) - mx) < Math.abs(x(best.t) - mx)) best = p;
    const cx = x(best.t), cy = y(best.v);
    xh.setAttribute("x1", cx); xh.setAttribute("x2", cx); xh.setAttribute("opacity", ".3");
    const comp = S.metric === "bf" || S.metric === "lean" || S.metric === "fat";
    const kind = best.r.e.omron != null ? (comp ? "Omron reading" : "Gym day") : (comp ? (best.r.src === "cal" ? "Tape, calibrated" : "Tape estimate") : "Home check-in");
    tip.innerHTML = `<b>${f1(best.v)} ${m.unit}</b> · ${fmtD(best.r.e.date, true)}<br>${kind}`;
    tip.hidden = false; tip.style.left = Math.max(74, Math.min(b.width - 74, cx * b.width / W)) + "px"; tip.style.top = (cy * b.height / H) + "px";
  };
  const leave = () => { tip.hidden = true; xh.setAttribute("opacity", "0"); };
  svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move); svg.addEventListener("pointerleave", leave);
}

function logCard(c, s) {
  if (!s.rows.length) return `<section class="card"><div class="card-h"><h2>Check-in log</h2></div><div class="empty">Check-ins will list here, newest first.</div></section>`;
  const fem = c.sex !== "male";
  const tr = [...s.rows].reverse().map(r => { const e = r.e;
    return `<tr><td>${fmtD(e.date, true)}${e.omron != null ? ` <span class="tag">GYM</span>` : ""}${r.flags.map(f => `<span class="flag">${ICON_WARN}<span>${esc(f)}</span></span>`).join("")}${e.note ? `<span class="note">${esc(e.note)}</span>` : ""}${feelLine(e)}${S.isTrainer && !S.planMissing && !e.coachNote ? `<button type="button" class="linkbtn reply" data-reply="${esc(e.id)}">Reply</button>` : ""}</td>
    <td>${f1(e.weight)}</td><td>${f1(e.waist)}</td><td>${f1(e.neck)}</td>${fem ? `<td>${f1(e.hip)}</td>` : ""}
    <td>${f1(r.tape)}</td><td>${e.omron != null ? f1(e.omron) : "–"}</td><td class="bfcell">${f1(r.bf)}</td><td>${f1(r.lean)}</td>
    <td>${canDelete(e) ? `<button type="button" class="btn ghost sm danger" data-del="${esc(e.id)}">Delete</button>` : ""}</td></tr>${e.coachNote ? `<tr class="crow"><td colspan="${fem ? 10 : 9}"><div class="coach"><b>${esc(TRAINER)}:</b> ${esc(e.coachNote)}${S.isTrainer && !S.planMissing ? ` <button type="button" class="linkbtn reply" data-reply="${esc(e.id)}">Edit</button>` : ""}</div></td></tr>` : ""}`; }).join("");
  return `<section class="card"><div class="card-h"><h2>Check-in log</h2><span class="muted small">${s.rows.length} check-in${s.rows.length > 1 ? "s" : ""}</span></div>
  <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Wt lb</th><th>Waist</th><th>Neck</th>${fem ? "<th>Hips</th>" : ""}<th>Tape %</th><th>Omron %</th><th>Body fat %</th><th>Lean lb</th><th><span hidden>Actions</span></th></tr></thead><tbody>${tr}</tbody></table></div></section>`;
}

function photoCard(s) {
  const withP = s.rows.filter(r => r.e.photoFront || r.e.photoSide);
  let body;
  if (!withP.length) body = `<div class="empty">Add front and side photos at a check-in to compare them here. Same wall, same light, same distance.</div>`;
  else {
    const key = S.view === "front" ? "photoFront" : "photoSide";
    if (!withP.find(r => r.e.id === S.cmpA)) S.cmpA = withP[0].e.id;
    if (!withP.find(r => r.e.id === S.cmpB)) S.cmpB = withP[withP.length - 1].e.id;
    const A = withP.find(r => r.e.id === S.cmpA).e, Bx = withP.find(r => r.e.id === S.cmpB).e;
    const opt = sel => withP.map(r => `<option value="${esc(r.e.id)}"${r.e.id === sel ? " selected" : ""}>${fmtD(r.e.date, true)}</option>`).join("");
    const src = e => e[key] && S.urls[e[key]];
    const img = (e, cls) => src(e) ? `<img${cls ? ` class="${cls}"` : ""} src="${esc(src(e))}" alt="${S.view} photo, ${fmtD(e.date, true)}"${cls === "top" ? ` style="opacity:${S.fade / 100}"` : ""}>` : (cls ? "" : `No ${S.view} photo`);
    body = `<div class="picks"><label for="cmpA">Before<select id="cmpA">${opt(S.cmpA)}</select></label><label for="cmpB">After<select id="cmpB">${opt(S.cmpB)}</select></label></div>
    ${S.overlay ? `<div class="ph" style="max-width:340px;margin:0 auto">${img(A, "base") || `No ${S.view} photo`}${img(Bx, "top")}</div>
      <label class="small muted" for="fade" style="display:block;margin-top:8px">Blend: ${fmtD(A.date)} ↔ ${fmtD(Bx.date)}</label><input class="range" id="fade" type="range" min="0" max="100" value="${S.fade}">`
    : `<div class="cmp"><figure><div class="ph">${img(A)}</div><figcaption>${fmtD(A.date, true)}</figcaption></figure><figure><div class="ph">${img(Bx)}</div><figcaption>${fmtD(Bx.date, true)}</figcaption></figure></div>`}`;
  }
  const ctl = withP.length ? `<div class="seg" role="group" aria-label="Photo view"><button type="button" data-view="front" aria-pressed="${S.view === "front"}">Front</button><button type="button" data-view="side" aria-pressed="${S.view === "side"}">Side</button></div><div class="seg" role="group" aria-label="Compare mode"><button type="button" data-ov="0" aria-pressed="${!S.overlay}">Side by side</button><button type="button" data-ov="1" aria-pressed="${S.overlay}">Overlay</button></div>` : "";
  return `<section class="card"><div class="card-h"><h2>Photos</h2>${ctl}</div>${body}</section>`;
}

function summaryCard(c, s) {
  const t = summaryText(c, s, !S.isTrainer); if (!t) return "";
  return `<section class="card"><div class="card-h"><h2>${S.isTrainer ? "Progress note" : "Your summary"}</h2>${S.isTrainer ? `<button class="btn sm" id="copyNote" type="button">Copy</button>` : ""}</div>
  <p class="summary" id="noteOut">${esc(t)}</p>${S.isTrainer ? `<p class="small muted" style="margin:8px 0 0">Written from ${esc(firstName(c.name))}'s numbers. Copy it into a text and add your own words.</p>` : ""}</section>`;
}

function wire(c, s) {
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  on("#editClient", () => openClient(c)); on("#newEntry", () => openEntry(c)); on("#firstEntry", () => openEntry(c));
  on("#editPlan", () => openPlan(c)); on("#buildPlan", () => openPlan(c));
  on("#connectHealth", () => { const b = $("#connectHealth"); b.disabled = true; b.textContent = "Waiting for Apple Health…"; toApp({ type: "connectHealth" }); });
  on("#syncHealth", () => { const b = $("#syncHealth"); b.disabled = true; b.textContent = "Syncing…"; toApp({ type: "syncHealth" }); });
  $$("[data-start]").forEach(b => b.onclick = () => openWorkout(c, +b.dataset.start));
  $$("[data-delw]").forEach(btn => btn.onclick = async () => {
    if (!btn.classList.contains("armed")) { btn.classList.add("armed"); btn.textContent = "Confirm"; setTimeout(() => { if (btn.isConnected) { btn.classList.remove("armed"); btn.textContent = "Delete"; } }, 4000); return; }
    btn.disabled = true;
    try { await api.deleteWorkout(btn.dataset.delw); S.workouts = S.workouts.filter(w => w.id !== btn.dataset.delw); toast("Workout deleted"); render(); }
    catch (e) { btn.disabled = false; toast("Couldn't delete that workout. Try again."); }
  });
  $$("[data-reply]").forEach(b => b.onclick = () => openReply(c, S.checkins.find(x => x.id === b.dataset.reply)));
  $$("[data-metric]").forEach(b => b.onclick = () => { S.metric = b.dataset.metric; render(); });
  $$("[data-view]").forEach(b => b.onclick = () => { S.view = b.dataset.view; render(); });
  $$("[data-ov]").forEach(b => b.onclick = () => { S.overlay = b.dataset.ov === "1"; render(); });
  const a = $("#cmpA"), b = $("#cmpB"); if (a) a.onchange = () => { S.cmpA = a.value; render(); }; if (b) b.onchange = () => { S.cmpB = b.value; render(); };
  const fd = $("#fade"); if (fd) fd.oninput = () => { S.fade = +fd.value; const t = document.querySelector(".ph img.top"); if (t) t.style.opacity = S.fade / 100; };
  $$("[data-del]").forEach(btn => btn.onclick = async () => {
    if (!btn.classList.contains("armed")) { btn.classList.add("armed"); btn.textContent = "Confirm"; setTimeout(() => { if (btn.isConnected) { btn.classList.remove("armed"); btn.textContent = "Delete"; } }, 4000); return; }
    const e = S.checkins.find(x => x.id === btn.dataset.del); if (!e) return;
    btn.disabled = true;
    try { await api.deleteCheckin(e); S.checkins = S.checkins.filter(x => x.id !== e.id); toast("Check-in deleted"); render(); }
    catch (err) { btn.disabled = false; toast("Couldn't delete that check-in. Try again."); }
  });
  on("#copyNote", async () => {
    const btn = $("#copyNote"), t = $("#noteOut").textContent;
    try { await navigator.clipboard.writeText(t); btn.textContent = "Copied"; }
    catch (_) { const r = document.createRange(); r.selectNodeContents($("#noteOut")); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); btn.textContent = "Selected"; }
  });
  drawChart(s);
}

/* ---------- loading data ---------- */
async function selectClient(id) {
  S.sel = id; S.cmpA = S.cmpB = null; if (S.isTrainer) store.set("fa_client", id);
  await loadCheckins();
}
async function loadCheckins() {
  if (!S.sel) { S.checkins = []; render(); return; }
  try {
    S.checkins = await api.listCheckins(S.sel);
    await loadPlan();
    await loadWorkouts();
    await loadHealth();
    const paths = S.checkins.flatMap(e => [e.photoFront, e.photoSide]).filter(p => p && !S.urls[p]);
    if (paths.length) Object.assign(S.urls, await api.photoUrls(paths));
  } catch (err) { console.error(err); toast("Couldn't load check-ins. Check your connection and reload."); }
  render();
}
async function loadAll() {
  S.screen = "loading"; render();
  try { S.clients = await api.listClients(); }
  catch (err) { console.error(err); S.clients = []; toast("Couldn't load your data. Check your connection and reload."); }
  if (!S.isTrainer && !S.clients.length) { S.screen = "noaccess"; render(); return; }
  const saved = store.get("fa_client");
  S.sel = S.clients.find(c => c.id === S.sel) ? S.sel : S.clients.find(c => c.id === saved) ? saved : (S.clients[0]?.id || null);
  S.screen = "app";
  if (!S.isTrainer) toApp({ type: "ready", role: "client" });
  if (S.isTrainer) { try { S.templates = await api.listTemplates(); } catch (err) { S.templates = []; if (!isMissing(err)) console.error(err); } }
  await loadCheckins();
}

/* ---------- client dialog (trainer) ---------- */
let editing = null;
function openClient(c) {
  editing = c;
  $("#cTitle").textContent = c ? "Edit client" : "New client";
  $("#c-name").value = c?.name || ""; $("#c-email").value = c?.email || ""; $("#c-sex").value = c?.sex || "female"; $("#c-dob").value = c?.dob || "";
  $("#c-ft").value = c?.height ? Math.floor(c.height / 12) : ""; $("#c-in").value = c?.height ? Math.round((c.height % 12) * 2) / 2 : "";
  $("#c-goal").value = c?.goal || ""; $("#c-glp1").checked = !!c?.glp1; $("#cErr").textContent = "";
  const del = $("#cDelete"); del.hidden = !c; del.classList.remove("armed"); del.textContent = "Delete client"; del.disabled = false;
  $("#dlgClient").showModal();
}
$("#cCancel").onclick = () => $("#dlgClient").close();
$("#cDelete").onclick = async () => {
  const b = $("#cDelete");
  if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Delete client, check-ins and photos"; return; }
  b.disabled = true;
  try { await api.deleteClient(editing.id); $("#dlgClient").close(); toast("Client deleted"); S.sel = null; await loadAll(); }
  catch (e) { $("#cErr").textContent = "Couldn't delete. Try again."; b.disabled = false; }
};
$("#fClient").onsubmit = async ev => {
  ev.preventDefault();
  const err = $("#cErr");
  const name = $("#c-name").value.trim(), email = $("#c-email").value.trim().toLowerCase(), ft = num($("#c-ft").value), inch = num($("#c-in").value) ?? 0;
  if (!name) { err.textContent = "Add the client's name."; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = "Add the email the client will sign in with."; return; }
  if (ft == null || ft < 3 || ft > 7 || inch < 0 || inch >= 12) { err.textContent = "Height is needed for the tape formula. Enter feet and inches."; return; }
  const d = { name, email, sex: $("#c-sex").value, dob: $("#c-dob").value || null, height: ft * 12 + inch, goal: $("#c-goal").value.trim() || null, glp1: $("#c-glp1").checked };
  const btn = $("#cSave"); btn.disabled = true; err.textContent = "";
  try {
    const saved = await api.saveClient(d, editing?.id);
    $("#dlgClient").close(); toast(editing ? "Client updated" : `${firstName(name)} added. They can sign in with ${email}.`);
    S.sel = saved.id; store.set("fa_client", saved.id);
    S.clients = await api.listClients(); S.screen = "app"; await loadCheckins();
  } catch (e) {
    err.textContent = e && e.code === "23505" ? "A client with that email already exists." : "Couldn't save. Check your connection and try again.";
  }
  btn.disabled = false;
};

/* ---------- check-in dialog ---------- */
let entryClient = null;
function openEntry(c) {
  entryClient = c; const s = series(c, S.checkins), last = s.rows[s.rows.length - 1];
  $("#fEntry").reset(); $("#e-date").value = todayISO(); $("#e-date").max = todayISO(); $("#eErr").textContent = "";
  $("#eTitle").textContent = S.isTrainer ? `Check-in for ${firstName(c.name)}` : "Log a check-in";
  $("#hipField").hidden = c.sex === "male";
  $("#omronBox").hidden = !S.isTrainer;
  $("#eTip").textContent = S.isTrainer ? "Measure at the same time of day as the last check-in, before eating or training. Tape snug, not tight." : "Weigh in first thing in the morning, before eating or training. That's all you need most days. Add tape measurements once a week to update your body fat.";
  const ph = (id, v) => { $(id).placeholder = v ? "Last: " + f1(v) : ""; };
  ph("#e-weight", last?.e.weight); ph("#e-waist", last?.e.waist); ph("#e-neck", last?.e.neck); ph("#e-hip", last?.e.hip);
  resetFeel(c); fillFromHealth(); livePreview(); $("#dlgEntry").showModal();
}
function livePreview() {
  const c = entryClient; if (!c) return;
  const date = $("#e-date").value || todayISO(), age = ageAt(c.dob, date), w = num($("#e-weight").value);
  $("#omronProfile").innerHTML = `Set the Omron profile to <b>${c.sex === "male" ? "Male" : "Female"}</b>${age != null ? `, age <b>${age}</b>` : ""}, height <b>${htStr(c.height)}</b>${w ? `, weight <b>${f1(w)} lb</b>` : ""}. Hold the grips with arms straight out.`;
  const t = navy(c.sex, c.height, num($("#e-waist").value), num($("#e-neck").value), num($("#e-hip").value));
  const om = S.isTrainer ? num($("#e-omron").value) : null;
  const cal = series(c, S.checkins).cal, off = offsetAt(cal.filter(k => k.date <= date).length ? cal.filter(k => k.date <= date) : cal, date);
  let h = "";
  if (t != null && om != null) h = `Tape estimate <b>${f1(t)}%</b>, Omron <b>${f1(om)}%</b>. New correction: <b>${sgn(om - t)} pts</b>.`;
  else if (t != null && off != null) h = `Tape ${f1(t)}% ${sgn(off)} correction = <b>${f1(t + off)}% body fat</b>`;
  else if (t != null) h = `Tape estimate <b>${f1(t)}%</b>.${S.isTrainer ? " Add an Omron reading to calibrate." : ""}`;
  else if (om != null) h = `Omron <b>${f1(om)}%</b>. Add tape measurements too, so home check-ins can be calibrated.`;
  $("#eLive").innerHTML = h;
}
$("#fEntry").addEventListener("input", livePreview);
$("#eCancel").onclick = () => $("#dlgEntry").close();

async function compress(file) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch (_) { src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
  const w = src.width, h = src.height, k = Math.min(1, 1400 / Math.max(w, h));
  const cv = document.createElement("canvas"); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
  return await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("encode")), "image/jpeg", 0.85));
}
$("#fEntry").onsubmit = async ev => {
  ev.preventDefault();
  const c = entryClient, err = $("#eErr");
  const d = { clientId: c.id, date: $("#e-date").value || todayISO(), weight: num($("#e-weight").value), waist: num($("#e-waist").value), neck: num($("#e-neck").value), hip: c.sex === "male" ? null : num($("#e-hip").value), omron: S.isTrainer ? num($("#e-omron").value) : null, note: $("#e-note").value.trim() || null, photoFront: null, photoSide: null, ...readFeel(c) };
  if (d.sleepH != null && (d.sleepH < 0 || d.sleepH > 16)) { err.textContent = "Average sleep should be between 0 and 16 hours."; return; }
  if (d.steps != null && (d.steps < 0 || d.steps > 100000)) { err.textContent = "Average steps should be between 0 and 100,000."; return; }
  if (d.date > todayISO()) { err.textContent = "The date can't be in the future."; return; }
  if (d.weight == null || d.weight < 50 || d.weight > 700) { err.textContent = "Add today's weight in pounds."; return; }
  /* Tape is optional: weight alone is a valid check-in. A full set of tape numbers must still make sense. */
  const fullTape = d.waist != null && d.neck != null && (c.sex === "male" || d.hip != null);
  if (fullTape && d.omron == null && navy(c.sex, c.height, d.waist, d.neck, d.hip) == null) { err.textContent = "Those tape numbers don't give a valid estimate. Check waist and neck."; return; }
  if (d.omron != null && (d.omron < 3 || d.omron > 70)) { err.textContent = "The Omron reading should be between 3 and 70%."; return; }
  const btn = $("#eSave"); btn.disabled = true; btn.textContent = "Saving…"; err.textContent = "";
  try {
    const f = $("#e-front").files[0], sd = $("#e-side").files[0];
    if (f || sd) btn.textContent = "Uploading photos…";
    if (f) d.photoFront = await api.uploadPhoto(c.id, await compress(f));
    if (sd) d.photoSide = await api.uploadPhoto(c.id, await compress(sd));
    await api.addCheckin(d);
    $("#dlgEntry").close(); toast("Check-in saved");
    await loadCheckins();
  } catch (e) {
    console.error(e);
    err.textContent = e && /size|large/i.test(e.message || "") ? "That photo is too large. Try a smaller one." : "Couldn't save. Check your connection and try again.";
  }
  btn.disabled = false; btn.textContent = "Save check-in";
};

/* ---------- how-you-feel check-in questions ---------- */
const feel = { energy: null, hunger: null, sleep_q: null, se: new Set() };
function drawScales() {
  $$("#feelBox .scale").forEach(sc => {
    const k = sc.dataset.scale;
    sc.querySelector(".dots").innerHTML = [1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="${feel[k] === n}" data-k="${k}" data-n="${n}">${n}</button>`).join("");
  });
  $("#seChips").innerHTML = [...SIDE_EFFECTS, "None"].map(x => `<button type="button" class="chip" aria-pressed="${x === "None" ? feel.se.size === 0 && feel.seNone === true : feel.se.has(x)}" data-se="${esc(x)}">${esc(x)}</button>`).join("");
}
function resetFeel(c) {
  feel.energy = feel.hunger = feel.sleep_q = null; feel.se = new Set(); feel.seNone = false;
  $("#e-sleeph").value = ""; $("#e-steps").value = "";
  $("#glpBox").hidden = !c.glp1; drawScales();
}
$("#feelBox").addEventListener("click", ev => {
  const b = ev.target.closest("button"); if (!b) return;
  if (b.dataset.k) { const n = +b.dataset.n; feel[b.dataset.k] = feel[b.dataset.k] === n ? null : n; }
  else if (b.dataset.se) { const x = b.dataset.se; if (x === "None") { feel.se.clear(); feel.seNone = !feel.seNone; } else { feel.seNone = false; feel.se.has(x) ? feel.se.delete(x) : feel.se.add(x); } }
  drawScales();
});
function readFeel(c) {
  return { energy: feel.energy, hunger: feel.hunger, sleepQ: feel.sleep_q, sleepH: num($("#e-sleeph").value), steps: num($("#e-steps").value) != null ? Math.round(num($("#e-steps").value)) : null, sideEffects: c.glp1 ? [...feel.se] : [] };
}
function feelLine(e) {
  const bits = [];
  if (e.energy != null) bits.push(`Energy ${e.energy}/5`);
  if (e.hunger != null) bits.push(`Hunger ${e.hunger}/5`);
  if (e.sleepQ != null) bits.push(`Sleep ${e.sleepQ}/5`);
  if (e.sleepH != null) bits.push(`${f1(e.sleepH)} h`);
  if (e.steps != null) bits.push(`${Math.round(e.steps).toLocaleString("en-US")} steps`);
  return bits.length ? `<span class="feelline">${bits.join(" · ")}</span>` : "";
}

/* Fast Aminos Wellness links inside the RENOVO app. */
function shopCard() {
  return `<section class="card fa"><div><div class="kicker">Fuel your progress</div><h2>Fast Aminos Wellness</h2><p class="small muted">Supplements and free tools from ${esc(TRAINER)}'s wellness shop.</p></div>
    <div class="fa-links"><a class="btn" href="https://fast-aminos-wellness.plyamed.com/shop/supplements" target="_blank" rel="noopener">Shop supplements</a><a class="btn" href="../workouts/" target="_blank" rel="noopener">Workout library</a><a class="btn" href="../zone2/" target="_blank" rel="noopener">Zone 2 calculator</a></div></section>`;
}

/* ---------- Apple Health (via the RENOVO iPhone app) ---------- */
function toApp(msg) { try { if (IN_APP) window.webkit.messageHandlers.faApp.postMessage(msg); } catch (_) {} }
async function loadHealth() {
  S.health = [];
  try { S.health = await api.listHealth(S.sel); S.healthMissing = false; }
  catch (err) { if (isMissing(err)) S.healthMissing = true; else console.error(err); }
}
/* The app calls this with { connected, lastSync, rows: [{date, steps, sleepHours, weightLb, activeKcal, exerciseMin, restingHr}], error }. */
window.faAppHealth = async data => {
  data = data || {};
  S.app.connected = !!data.connected; if (data.lastSync) S.app.lastSync = data.lastSync;
  const c = client();
  if (Array.isArray(data.rows) && data.rows.length && c && !S.isTrainer && !S.healthMissing) {
    const rows = data.rows.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date || "")).slice(0, 120);
    try { await api.upsertHealth(c.id, rows); await loadHealth(); S.app.lastSync = new Date().toISOString(); }
    catch (err) { console.error(err); toast("Couldn't save your Apple Health data. Try again later."); }
  }
  if (data.error) toast(data.error);
  if (S.screen === "app") render();
};
const avg = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; };
function last7(field) { const t = todayISO(); return avg(S.health.filter(h => days(h.date, t) >= 0 && days(h.date, t) < 7).map(h => h[field])); }
function fillFromHealth() {
  const sl = last7("sleepH"), st = last7("steps"), note = $("#healthNote");
  if (sl != null) $("#e-sleeph").value = f1(sl);
  if (st != null) $("#e-steps").value = Math.round(st);
  if (note) note.hidden = sl == null && st == null;
}
function healthCard(c) {
  if (S.healthMissing) return "";
  const has = S.health.length > 0;
  const canConnect = IN_APP && !S.isTrainer;
  if (!has && !canConnect) return "";
  if (!has) return `<section class="card"><div class="card-h"><h2>Apple Health</h2></div><div class="empty">Connect Apple Health and your steps, sleep and weight fill in automatically. You choose exactly what to share. <button class="btn primary sm" id="connectHealth" type="button">Connect Apple Health</button></div></section>`;
  const t = todayISO(), wk = S.health.filter(h => days(h.date, t) >= 0 && days(h.date, t) < 7);
  const wts = S.health.filter(h => h.weight != null);
  const wNow = wts[0], wOld = wts.find(h => days(h.date, wNow?.date || t) >= 7);
  const synced = S.health.reduce((m, h) => String(h.updatedAt) > m ? String(h.updatedAt) : m, "");
  const ago = synced ? Math.max(0, Math.round((Date.now() - new Date(synced).getTime()) / 36e5)) : null;
  const big = (lbl, v, unit, sub) => `<div class="tile"><span class="lbl">${lbl}</span><span class="big">${v ?? "–"}<small>${v != null ? unit : ""}</small></span><span class="delta">${sub || ""}</span></div>`;
  const small = (lbl, v) => v == null ? "" : `<span><b>${v}</b> ${lbl}</span>`;
  return `<section class="card hk"><div class="card-h"><div><div class="kicker">From Apple Health</div><h2>Last 7 days</h2></div>
    <div class="hk-sync">${ago != null ? `<span class="muted small">Synced ${ago < 1 ? "just now" : ago < 24 ? ago + " h ago" : Math.round(ago / 24) + " days ago"}</span>` : ""}${canConnect ? `<button class="btn sm" id="syncHealth" type="button">Sync now</button>` : ""}</div></div>
    <div class="tiles">${big("Avg steps", last7("steps") != null ? Math.round(last7("steps")).toLocaleString("en-US") : null, "/day", "")}${big("Avg sleep", last7("sleepH") != null ? f1(last7("sleepH")) : null, "h", "")}
      ${big("Weight", wNow ? f1(wNow.weight) : null, "lb", wNow && wOld ? `${sgn(wNow.weight - wOld.weight)} lb vs a week earlier` : wNow ? fmtD(wNow.date) : "")}</div>
    <div class="hk-more">${small("active cal/day", last7("kcal") != null ? Math.round(last7("kcal")) : null)}${small("exercise min/day", last7("exMin") != null ? Math.round(last7("exMin")) : null)}${small("resting HR", last7("rhr") != null ? Math.round(last7("rhr")) + " bpm" : null)}<span class="muted">${wk.length} of 7 days synced</span></div></section>`;
}

/* ---------- coach feedback + workout plans ---------- */
async function loadPlan() {
  S.plan = null;
  try { S.plan = await api.getPlan(S.sel); S.planMissing = false; }
  catch (err) { if (isMissing(err)) S.planMissing = true; else console.error(err); }
}

/* The client sees the trainer's most recent reply at the top of their page. */
function coachCallout(c) {
  if (S.isTrainer) return "";
  const e = [...S.checkins].filter(x => x.coachNote).sort((a, b) => String(a.coachNoteAt || a.date).localeCompare(String(b.coachNoteAt || b.date))).pop();
  if (!e) return "";
  return `<section class="coachbox"><div class="kicker">From ${esc(TRAINER)} · on your ${fmtD(e.date)} check-in</div><p>${esc(e.coachNote)}</p></section>`;
}

const refUrl = ref => /^[a-z-]+(\/home)?$/.test(ref || "") ? `../workouts/${ref}/` : "";
function planDays(p) {
  const canLog = !S.workoutsMissing;
  return `<div class="days">${p.days.map((d, i) => `<div class="day"><div class="day-h"><span class="dnum">Day ${i + 1}</span><h3>${esc(d.name || "Workout")}</h3>${canLog ? `<button type="button" class="btn primary sm startw" data-start="${i}">${S.isTrainer ? "Log workout" : "Start workout"}</button>` : ""}${lastDone(d.name)}</div>
    <ol class="plist">${(d.items || []).map(x => { const u = refUrl(x.ref);
      const sr = [x.sets ? `${esc(x.sets)} × ${esc(x.reps || "")}` : esc(x.reps || ""), x.rest ? `rest ${esc(x.rest)}` : ""].filter(Boolean).join(" · ");
      return `<li><div class="pname">${esc(x.name)}</div>${sr ? `<div class="psr">${sr}</div>` : ""}${x.note ? `<div class="pnote">${esc(x.note)}</div>` : ""}${u ? `<a class="plink" href="${u}" target="_blank" rel="noopener">Form &amp; photos →</a>` : ""}</li>`; }).join("")}</ol></div>`).join("")}</div>`;
}
function planCard(c) {
  if (S.planMissing) return S.isTrainer ? `<section class="card"><div class="card-h"><h2>Workout plan</h2></div><div class="empty">Workout plans and check-in replies need a one-time database update. Run <code>supabase/schema.sql</code> again in the Supabase SQL Editor, then reload. Steps are in <code>tracker/SETUP.md</code>.</div></section>` : "";
  const p = S.plan;
  if (!p || !p.days.length) {
    return S.isTrainer ? `<section class="card"><div class="card-h"><h2>Workout plan</h2></div><div class="empty">No plan for ${esc(firstName(c.name))} yet. Build one from your gym and home workouts, or write your own. <button class="btn primary sm" id="buildPlan" type="button">Build plan</button></div></section>` : "";
  }
  return `<section class="card plan"><div class="card-h"><div><div class="kicker">${S.isTrainer ? "Workout plan" : `Your plan from ${esc(TRAINER)}`}</div><h2>${esc(p.title || "Workout plan")}</h2></div>
    ${S.isTrainer ? `<button class="btn" id="editPlan" type="button">Edit plan</button>` : (p.updatedAt ? `<span class="muted small">Updated ${fmtD(String(p.updatedAt).slice(0, 10), true)}</span>` : "")}</div>
    ${p.notes ? `<p class="summary">${esc(p.notes)}</p>` : ""}${planDays(p)}</section>`;
}

/* Reply dialog (trainer). */
let replyTo = null;
function openReply(c, e) {
  if (!e) return; replyTo = e;
  $("#rTitle").textContent = `Reply to ${firstName(c.name)}`;
  $("#rWhat").textContent = `${fmtD(e.date, true)} check-in · ${f1(e.weight)} lb${e.note ? ` · "${e.note}"` : ""}`;
  $("#r-text").value = e.coachNote || ""; $("#rErr").textContent = "";
  $("#rClear").hidden = !e.coachNote;
  $("#dlgReply").showModal(); setTimeout(() => $("#r-text").focus(), 50);
}
async function saveReply(text) {
  const btn = $("#rSave"); btn.disabled = true; $("#rErr").textContent = "";
  try {
    const upd = await api.saveFeedback(replyTo.id, text);
    const e = S.checkins.find(x => x.id === replyTo.id); if (e) { e.coachNote = upd.coachNote; e.coachNoteAt = upd.coachNoteAt; }
    $("#dlgReply").close(); toast(text ? `Reply saved. ${firstName(client()?.name)} will see it in their tracker.` : "Reply removed"); render();
  } catch (err) { console.error(err); $("#rErr").textContent = isMissing(err) ? "Run the database update in tracker/SETUP.md first." : "Couldn't save. Check your connection and try again."; }
  btn.disabled = false;
}
$("#fReply").onsubmit = ev => { ev.preventDefault(); const t = $("#r-text").value.trim(); if (t.length > 1000) { $("#rErr").textContent = "Keep it under 1,000 characters."; return; } saveReply(t); };
$("#rCancel").onclick = () => $("#dlgReply").close();
$("#rClear").onclick = () => saveReply("");

/* Plan builder (trainer). */
const LIB = window.WORKOUT_LIBRARY || [];
let draft = null, planClient = null;
const cleanDays = () => draft.days.map(d => ({ name: String(d.name || "").trim(), items: (d.items || []).map(x => ({ name: String(x.name || "").trim(), sets: String(x.sets || "").trim(), reps: String(x.reps || "").trim(), rest: String(x.rest || "").trim(), note: String(x.note || "").trim(), ref: x.ref || "" })).filter(x => x.name) })).filter(d => d.items.length);
const blankItem = () => ({ name: "", sets: "3", reps: "10", rest: "60 sec", note: "", ref: "" });
function openPlan(c) {
  planClient = c;
  draft = S.plan && S.plan.days.length ? JSON.parse(JSON.stringify({ title: S.plan.title, notes: S.plan.notes, days: S.plan.days })) : { title: "", notes: "", days: [{ name: "", items: [] }] };
  $("#plTitle").textContent = `Workout plan for ${firstName(c.name)}`;
  $("#plErr").textContent = ""; $("#plDelete").hidden = !(S.plan && S.plan.days.length);
  const del = $("#plDelete"); del.classList.remove("armed"); del.textContent = "Delete plan"; del.disabled = false;
  drawTemplateRow(); drawPlanEditor(); $("#dlgPlan").showModal();
}
function drawTemplateRow() {
  const sel = $("#pl-tpl");
  sel.innerHTML = `<option value="">${S.templates.length ? "Start from a template…" : "No templates yet. Save one below."}</option>` + S.templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
  sel.disabled = !S.templates.length;
}
$("#pl-tpl").onchange = () => {
  const t = S.templates.find(x => x.id === $("#pl-tpl").value); if (!t) return;
  draft = { title: t.title || t.name, notes: t.notes || "", days: JSON.parse(JSON.stringify(t.days)) };
  $("#plErr").textContent = ""; drawPlanEditor();
  toast(`Loaded "${t.name}". Adjust it for ${firstName(planClient.name)}, then Save plan.`);
};
$("#plSaveTpl").onclick = async () => {
  const err = $("#plErr"), name = (draft.title || "").trim();
  if (!name) { err.textContent = "Give the plan a name first. The template uses the same name."; return; }
  const days = cleanDays();
  if (!days.length) { err.textContent = "Add at least one exercise."; return; }
  const existing = S.templates.find(t => t.name.toLowerCase() === name.toLowerCase());
  const btn = $("#plSaveTpl"); btn.disabled = true; err.textContent = "";
  try {
    await api.saveTemplate({ name, title: name, notes: (draft.notes || "").trim(), days }, existing?.id);
    S.templates = await api.listTemplates(); drawTemplateRow();
    toast(existing ? `Template "${name}" updated` : `Saved "${name}" as a template. Pick it for any client.`);
  } catch (e) { console.error(e); err.textContent = isMissing(e) ? "Templates need the latest database update in tracker/SETUP.md." : "Couldn't save the template. Try again."; }
  btn.disabled = false;
};
function drawPlanEditor() {
  const libOpts = `<option value="">Add a workout from your site…</option>` + ["Gym", "Home"].map(m => `<optgroup label="${m} workouts">${LIB.filter(w => w.label.endsWith(`(${m})`)).map(w => `<option value="${esc(w.id)}">${esc(w.label)}</option>`).join("")}</optgroup>`).join("");
  $("#planEd").innerHTML = `
    <div class="field"><label for="pl-title">Plan name</label><input id="pl-title" type="text" maxlength="120" data-top="title" value="${esc(draft.title)}" placeholder="e.g. Phase 1: Build the base"></div>
    <div class="field"><label for="pl-notes">Notes for ${esc(firstName(planClient.name))}</label><textarea id="pl-notes" rows="2" maxlength="2000" data-top="notes" placeholder="e.g. 3 days a week. Walk 30 minutes in Zone 2 after each session.">${esc(draft.notes)}</textarea></div>
    ${draft.days.map((d, di) => `<fieldset class="ed-day"><legend>Day ${di + 1}</legend>
      <div class="ed-row1"><input type="text" maxlength="80" aria-label="Day ${di + 1} name" data-d="${di}" data-k="name" value="${esc(d.name)}" placeholder="Name, e.g. Lower body"><button type="button" class="btn ghost sm danger" data-rmday="${di}" aria-label="Remove day ${di + 1}">Remove day</button></div>
      ${d.items.length ? `<div class="ed-head" aria-hidden="true"><span>Exercise</span><span>Sets</span><span>Reps</span><span>Rest</span><span></span></div>` : ""}
      ${d.items.map((x, ii) => `<div class="ed-item">
        <input type="text" maxlength="80" aria-label="Exercise name" data-d="${di}" data-i="${ii}" data-k="name" value="${esc(x.name)}" placeholder="Exercise">
        <label class="mini"><span>Sets</span><input type="text" maxlength="12" aria-label="Sets" data-d="${di}" data-i="${ii}" data-k="sets" value="${esc(x.sets)}"></label>
        <label class="mini"><span>Reps</span><input type="text" maxlength="24" aria-label="Reps" data-d="${di}" data-i="${ii}" data-k="reps" value="${esc(x.reps)}"></label>
        <label class="mini"><span>Rest</span><input type="text" maxlength="16" aria-label="Rest" data-d="${di}" data-i="${ii}" data-k="rest" value="${esc(x.rest)}"></label>
        <button type="button" class="xbtn" data-rm="${di}:${ii}" aria-label="Remove ${esc(x.name || "exercise")}">×</button>
        <input class="ed-note" type="text" maxlength="200" aria-label="Note for ${esc(x.name || "exercise")}" data-d="${di}" data-i="${ii}" data-k="note" value="${esc(x.note)}" placeholder="Note (optional), e.g. Use the 25s">
      </div>`).join("")}
      <div class="ed-add"><button type="button" class="btn sm" data-additem="${di}">+ Exercise</button><select data-lib="${di}" aria-label="Add a workout to day ${di + 1}">${libOpts}</select></div>
    </fieldset>`).join("")}
    <button type="button" class="btn" id="plAddDay"${draft.days.length >= 7 ? " disabled" : ""}>+ Add a day</button>`;
}
$("#planEd").addEventListener("input", ev => {
  const t = ev.target;
  if (t.dataset.top) draft[t.dataset.top] = t.value;
  else if (t.dataset.k && t.dataset.d != null) { const d = draft.days[+t.dataset.d]; if (t.dataset.i != null) d.items[+t.dataset.i][t.dataset.k] = t.value; else d[t.dataset.k] = t.value; }
});
$("#planEd").addEventListener("change", ev => {
  const t = ev.target; if (t.dataset.lib == null || !t.value) return;
  const w = LIB.find(x => x.id === t.value); if (!w) return;
  const d = draft.days[+t.dataset.lib];
  d.items.push(...w.items.map(x => ({ ...x, note: "", ref: w.ref })));
  if (!d.name) d.name = w.label;
  drawPlanEditor();
});
$("#planEd").addEventListener("click", ev => {
  const b = ev.target.closest("button"); if (!b) return;
  if (b.id === "plAddDay") { draft.days.push({ name: "", items: [] }); drawPlanEditor(); }
  else if (b.dataset.additem != null) { draft.days[+b.dataset.additem].items.push(blankItem()); drawPlanEditor(); const ins = $$(`[data-d="${b.dataset.additem}"][data-k="name"][data-i]`); ins[ins.length - 1]?.focus(); }
  else if (b.dataset.rm) { const [di, ii] = b.dataset.rm.split(":").map(Number); draft.days[di].items.splice(ii, 1); drawPlanEditor(); }
  else if (b.dataset.rmday != null) { draft.days.splice(+b.dataset.rmday, 1); if (!draft.days.length) draft.days.push({ name: "", items: [] }); drawPlanEditor(); }
});
$("#plCancel").onclick = () => $("#dlgPlan").close();
$("#plDelete").onclick = async () => {
  const b = $("#plDelete");
  if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Delete this plan"; return; }
  b.disabled = true;
  try { await api.deletePlan(planClient.id); S.plan = null; $("#dlgPlan").close(); toast("Plan deleted"); render(); }
  catch (e) { $("#plErr").textContent = "Couldn't delete. Try again."; b.disabled = false; }
};
$("#fPlan").onsubmit = async ev => {
  ev.preventDefault();
  const err = $("#plErr");
  const days = cleanDays();
  if (!days.length) { err.textContent = "Add at least one exercise."; return; }
  const p = { title: draft.title.trim(), notes: draft.notes.trim(), days };
  const btn = $("#plSave"); btn.disabled = true; btn.textContent = "Saving…"; err.textContent = "";
  try { S.plan = await api.savePlan(planClient.id, p); $("#dlgPlan").close(); toast(`Plan saved. ${firstName(planClient.name)} will see it next time they open the tracker.`); render(); }
  catch (e) { console.error(e); err.textContent = isMissing(e) ? "Run the database update in tracker/SETUP.md first." : "Couldn't save. Check your connection and try again."; }
  btn.disabled = false; btn.textContent = "Save plan";
};

/* ---------- workout logging ---------- */
async function loadWorkouts() {
  S.workouts = [];
  try { S.workouts = await api.listWorkouts(S.sel); S.workoutsMissing = false; }
  catch (err) { if (isMissing(err)) S.workoutsMissing = true; else console.error(err); }
}
const isTimed = x => /min|sec|yard|yd\b/i.test(String(x.reps || ""));
const topRep = x => { const n = String(x.reps || "").match(/\d+/g); return n ? Math.max(...n.map(Number)) : null; };
const nSets = x => Math.min(10, Math.max(1, parseInt(x.sets, 10) || 3));
const fmtSet = st => `${st.lb != null ? f1(st.lb).replace(/\.0$/, "") : "BW"} × ${st.reps ?? "–"}`;
/* Most recent logged sets for an exercise, newest workout first. */
function lastFor(name) {
  for (const w of S.workouts) { const e = w.entries.find(x => x.name === name && !x.timed && x.sets && x.sets.some(st => st.reps != null)); if (e) return { w, e }; }
  return null;
}
function lastDone(dayName) {
  const w = S.workouts.find(x => x.dayName === dayName);
  return w ? `<div class="lastdone">Last done ${fmtD(w.date)}</div>` : "";
}
/* "Add weight" nudge: every target set reached the top of the rep range last time. */
function progressHint(x, prev) {
  if (!prev || isTimed(x)) return "";
  const top = topRep(x), done = prev.e.sets.filter(st => st.reps != null);
  if (top && done.length >= nSets(x) && done.every(st => st.reps >= top)) return `<div class="hint up">You hit ${top} reps on every set last time. Add a little weight today (about 5 lb).</div>`;
  return "";
}

let wDraft = null, wClient = null;
function openWorkout(c, dayIdx) {
  const day = S.plan.days[dayIdx]; wClient = c;
  wDraft = { clientId: c.id, date: todayISO(), dayName: day.name || `Day ${dayIdx + 1}`, note: "",
    entries: day.items.map(x => ({ name: x.name, ref: x.ref || "", target: [x.sets ? `${x.sets} ×` : "", x.reps || ""].join(" ").trim(), timed: isTimed(x), done: false,
      sets: isTimed(x) ? [] : Array.from({ length: nSets(x) }, () => ({ lb: "", reps: "" })), plan: x })) };
  $("#wTitle").textContent = wDraft.dayName;
  $("#wSub").textContent = S.isTrainer ? `Logging for ${firstName(c.name)}` : "Log each set as you go. Leave a set blank if you skipped it.";
  $("#w-date").value = wDraft.date; $("#w-date").max = todayISO(); $("#w-note").value = ""; $("#wErr").textContent = "";
  drawWorkout(); stopRest(); $("#dlgWorkout").showModal(); keepAwake();
}
function drawWorkout() {
  $("#wList").innerHTML = wDraft.entries.map((e, ei) => {
    const prev = lastFor(e.name), x = e.plan;
    const last = prev ? `<div class="wlast">Last time (${fmtD(prev.w.date)}): <b>${prev.e.sets.filter(st => st.reps != null).map(fmtSet).join(", ")}</b></div>` : "";
    const head = `<div class="wex-h"><div><div class="wname">${esc(e.name)}</div><div class="wtarget">Target ${esc(e.target)}${x.rest ? ` · rest ${esc(x.rest)}` : ""}</div></div><div class="wex-a">${refUrl(e.ref) ? `<a class="plink" href="${refUrl(e.ref)}" target="_blank" rel="noopener">Form →</a>` : ""}${e.timed ? "" : `<button type="button" class="restbtn" data-rest="${ei}" aria-label="Start ${fmtClock(restSecs(x.rest))} rest timer">Rest ${fmtClock(restSecs(x.rest))}</button>`}</div></div>`;
    if (e.timed) return `<div class="wex">${head}${x.note ? `<div class="pnote">${esc(x.note)}</div>` : ""}<label class="wdone"><input type="checkbox" data-done="${ei}"${e.done ? " checked" : ""}> Done</label></div>`;
    const ph = prev ? prev.e.sets.filter(st => st.lb != null).map(st => st.lb) : [];
    const rows = e.sets.map((st, si) => `<div class="wset"><span class="snum">Set ${si + 1}</span>
      <label class="wf"><input type="number" inputmode="decimal" step="2.5" min="0" max="2000" data-e="${ei}" data-s="${si}" data-k="lb" value="${esc(st.lb)}" placeholder="${ph[si] ?? ph[ph.length - 1] ?? ""}" aria-label="${esc(e.name)} set ${si + 1} weight"><span>lb</span></label>
      <label class="wf"><input type="number" inputmode="numeric" step="1" min="0" max="200" data-e="${ei}" data-s="${si}" data-k="reps" value="${esc(st.reps)}" placeholder="${topRep(x) ?? ""}" aria-label="${esc(e.name)} set ${si + 1} reps"><span>reps</span></label></div>`).join("");
    return `<div class="wex">${head}${x.note ? `<div class="pnote">${esc(x.note)}</div>` : ""}${last}${progressHint(x, prev)}${rows}<button type="button" class="linkbtn addset" data-addset="${ei}">+ Add a set</button></div>`;
  }).join("");
}
$("#wList").addEventListener("input", ev => {
  const t = ev.target;
  if (t.dataset.k) wDraft.entries[+t.dataset.e].sets[+t.dataset.s][t.dataset.k] = t.value;
  if (t.dataset.done != null) wDraft.entries[+t.dataset.done].done = t.checked;
});
$("#wList").addEventListener("change", ev => {
  const t = ev.target; if (t.dataset.k !== "reps" || t.value === "") return;
  const ei = +t.dataset.e, si = +t.dataset.s, e = wDraft.entries[ei];
  let next;
  if (si + 1 < e.sets.length) next = `Next: ${e.name}, set ${si + 2}`;
  else { const n = wDraft.entries.slice(ei + 1).find(x => !x.timed); next = n ? `Next: ${n.name}` : "Last set done. Finish strong!"; }
  if (si + 1 >= e.sets.length && !wDraft.entries.slice(ei + 1).some(x => !x.timed)) { stopRest(); return; }
  startRest(restSecs(e.plan.rest), next);
});
$("#wList").addEventListener("click", ev => { const r = ev.target.closest("[data-rest]"); if (r) { const e = wDraft.entries[+r.dataset.rest]; startRest(restSecs(e.plan.rest), `Rest: ${e.name}`); } });
$("#wList").addEventListener("click", ev => { const b = ev.target.closest("[data-addset]"); if (!b) return; const e = wDraft.entries[+b.dataset.addset]; if (e.sets.length < 12) { e.sets.push({ lb: "", reps: "" }); drawWorkout(); } });
$("#wCancel").onclick = () => $("#dlgWorkout").close();
$("#dlgWorkout").addEventListener("close", () => { stopRest(); releaseWake(); });
$("#fWorkout").onsubmit = async ev => {
  ev.preventDefault();
  const err = $("#wErr"), date = $("#w-date").value || todayISO();
  if (date > todayISO()) { err.textContent = "The date can't be in the future."; return; }
  const entries = wDraft.entries.map(e => {
    if (e.timed) return e.done ? { name: e.name, ref: e.ref, target: e.target, timed: true, done: true, sets: [] } : null;
    const sets = e.sets.map(st => ({ lb: num(st.lb), reps: num(st.reps) })).filter(st => st.reps != null || st.lb != null).map(st => ({ lb: st.lb, reps: st.reps != null ? Math.round(st.reps) : null }));
    return sets.length ? { name: e.name, ref: e.ref, target: e.target, timed: false, done: true, sets } : null;
  }).filter(Boolean);
  if (!entries.length) { err.textContent = "Log at least one set (or tick Done) before finishing."; return; }
  if (entries.some(e => e.sets.some(st => (st.lb != null && (st.lb < 0 || st.lb > 2000)) || (st.reps != null && (st.reps < 0 || st.reps > 200))))) { err.textContent = "Check the numbers: weight 0–2000 lb, reps 0–200."; return; }
  const btn = $("#wSave"); btn.disabled = true; btn.textContent = "Saving…"; err.textContent = "";
  try {
    await api.addWorkout({ clientId: wClient.id, date, dayName: wDraft.dayName, entries, note: $("#w-note").value.trim() });
    $("#dlgWorkout").close(); await loadWorkouts();
    const sets = entries.reduce((a, e) => a + e.sets.length, 0);
    toast(S.isTrainer ? `Workout logged for ${firstName(wClient.name)}` : `Workout saved: ${entries.length} exercises, ${sets} sets. Nice work!`); render();
  } catch (e) { console.error(e); err.textContent = isMissing(e) ? "Workout logging needs the latest database update in tracker/SETUP.md." : "Couldn't save. Check your connection and try again."; }
  btn.disabled = false; btn.textContent = "Finish workout";
};

/* ---------- rest timer ---------- */
/* "90 sec" → 90, "2 min" → 120, "2–3 min" → 120. Defaults to 90 seconds. */
function restSecs(str) {
  const t = String(str || "").toLowerCase(), m = t.match(/\d+(\.\d+)?/);
  if (!m) return 90;
  const n = parseFloat(m[0]) * (/min/.test(t) ? 60 : 1);
  return Math.min(600, Math.max(15, Math.round(n)));
}
const fmtClock = sec => { sec = Math.max(0, Math.ceil(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; };
const RT = { end: 0, iv: null, done: false };
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    [0, 0.28, 0.56].forEach(t0 => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime + t0; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.start(t); o.stop(t + 0.22); });
  } catch (_) {}
}
function tickRest() {
  const left = (RT.end - Date.now()) / 1000, box = $("#rTimer");
  if (left <= 0 && !RT.done) {
    RT.done = true; clearInterval(RT.iv); RT.iv = null;
    box.classList.add("done"); $("#rtTime").textContent = "0:00"; $("#rtNext").textContent = "Time's up. Next set!";
    try { navigator.vibrate && navigator.vibrate([250, 120, 250]); } catch (_) {}
    beep(); return;
  }
  if (!RT.done) { $("#rtTime").textContent = fmtClock(left); $("#rtBar").style.width = Math.max(0, Math.min(100, left / RT.total * 100)) + "%"; }
}
function startRest(sec, next) {
  // A user gesture is happening right now, so the audio can be unlocked for the beep later.
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === "suspended") audioCtx.resume(); } catch (_) {}
  RT.end = Date.now() + sec * 1000; RT.total = sec; RT.done = false;
  const box = $("#rTimer"); box.hidden = false; box.classList.remove("done");
  $("#rtNext").textContent = next || "Rest";
  clearInterval(RT.iv); RT.iv = setInterval(tickRest, 250); tickRest();
}
function adjustRest(d) {
  if (RT.done) { startRest(Math.max(15, d), $("#rtNext").textContent === "Time's up. Next set!" ? "Extra rest" : $("#rtNext").textContent); return; }
  RT.end = Math.max(Date.now() + 1000, RT.end + d * 1000); RT.total = Math.max(RT.total, (RT.end - Date.now()) / 1000); tickRest();
}
function stopRest() { clearInterval(RT.iv); RT.iv = null; RT.done = false; const box = $("#rTimer"); if (box) { box.hidden = true; box.classList.remove("done"); } }
$("#rtMinus").onclick = () => adjustRest(-15);
$("#rtPlus").onclick = () => adjustRest(15);
$("#rtStop").onclick = stopRest;
/* Keep the phone screen on during a workout where supported. */
let wakeLock = null;
async function keepAwake() { try { if ("wakeLock" in navigator) { wakeLock = await navigator.wakeLock.request("screen"); } } catch (_) {} }
function releaseWake() { try { wakeLock && wakeLock.release(); } catch (_) {} wakeLock = null; }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { if ($("#dlgWorkout").open && !wakeLock) keepAwake(); if (RT.iv) tickRest(); } });

/* Workout history, consistency and strength gains. */
function workoutsCard(c) {
  if (S.workoutsMissing) return S.isTrainer && S.plan && S.plan.days.length ? `<section class="card"><div class="card-h"><h2>Workouts</h2></div><div class="empty">Workout logging needs a one-time database update. Run <code>supabase/schema.sql</code> again in the Supabase SQL Editor, then reload.</div></section>` : "";
  const ws = S.workouts;
  if (!ws.length) return S.plan && S.plan.days.length ? `<section class="card"><div class="card-h"><h2>Workouts</h2></div><div class="empty">${S.isTrainer ? `No workouts logged yet. ${esc(firstName(c.name))} taps <b>Start workout</b> on a plan day to log sets and reps.` : `Tap <b>Start workout</b> on a day in your plan to log your sets and reps. Next time you'll see what to beat.`}</div></section>` : "";
  const t = todayISO(), recent = ws.filter(w => days(w.date, t) < 28).length;
  const target = S.plan ? S.plan.days.length * 4 : null;
  // strength: best weight per exercise, first session vs latest
  const by = {};
  [...ws].reverse().forEach(w => w.entries.forEach(e => { if (e.timed) return; const best = Math.max(...e.sets.map(st => st.lb ?? -1)); if (best <= 0) return; (by[e.name] ||= []).push({ date: w.date, best }); }));
  const gains = Object.entries(by).filter(([, a]) => a.length >= 2).map(([n, a]) => ({ n, from: a[0].best, to: a[a.length - 1].best, d: a[a.length - 1].best - a[0].best })).filter(g => g.d > 0).sort((a, b) => b.d - a.d).slice(0, 6);
  const rows = ws.slice(0, 8).map(w => {
    const sets = w.entries.reduce((a, e) => a + e.sets.length, 0);
    return `<details class="wlog"><summary><span class="wd">${fmtD(w.date, true)}</span><span class="wn">${esc(w.dayName || "Workout")}</span><span class="wc">${w.entries.length} exercises · ${sets} sets</span></summary>
      <ul>${w.entries.map(e => `<li><b>${esc(e.name)}</b> ${e.timed ? "Done" : e.sets.map(fmtSet).join(", ")}</li>`).join("")}</ul>${w.note ? `<p class="small muted">${esc(w.note)}</p>` : ""}
      <button type="button" class="btn ghost sm danger" data-delw="${esc(w.id)}">Delete</button></details>`;
  }).join("");
  return `<section class="card"><div class="card-h"><h2>Workouts</h2><span class="muted small">${ws.length} logged</span></div>
    <div class="wstats"><div class="tile"><span class="lbl">Last 4 weeks</span><span class="big">${recent}<small>${target ? ` of ${target}` : ""} workouts</small></span><span class="delta">${target ? (recent >= target ? "Right on plan. Great consistency." : `${Math.round(recent / target * 100)}% of the plan`) : ""}</span></div>
    ${gains.length ? `<div class="gains"><span class="lbl">Strength gains</span><ul>${gains.map(g => `<li><span>${esc(g.n)}</span><b>${f1(g.from).replace(/\.0$/, "")} → ${f1(g.to).replace(/\.0$/, "")} lb</b><em>+${f1(g.d).replace(/\.0$/, "")}</em></li>`).join("")}</ul></div>` : ""}</div>
    <div class="wlogs">${rows}</div></section>`;
}

/* ---------- auth + boot ---------- */
async function signOut() {
  if (DEMO) { location.href = location.pathname; return; }
  await sb.auth.signOut();
}
let currentUser;
async function onSession(session) {
  const u = session?.user || null;
  if ((u?.id || null) === currentUser) return;
  currentUser = u?.id || null;
  if (!u) { S.me = null; S.clients = []; S.checkins = []; S.sel = null; S.screen = "login"; S.authStep = "email"; S.authEmail = store.get("fa_email") || ""; render(); return; }
  S.me = { id: u.id, email: u.email };
  try { S.isTrainer = await api.isTrainer(u.id); } catch (_) { S.isTrainer = false; }
  if (location.hash.includes("access_token") || location.search.includes("code=")) history.replaceState(null, "", location.pathname);
  const pwSet = !!(u.user_metadata && u.user_metadata.password_set);
  if ((!pwSet && !store.get("fa_pwskip_" + u.id)) || VIA_LINK) { S.pwMode = pwSet ? "change" : "create"; S.pwBack = null; S.screen = "password"; render(); return; }
  await loadAll();
}
async function boot() {
  if (DEMO) {
    banner(`Demo ${DEMO_CLIENT ? "client" : "trainer"} view with sample data. Nothing is saved. ${DEMO_CLIENT ? "" : ""}`);
    $("#bannerText").insertAdjacentHTML("beforeend", DEMO_CLIENT ? `<a href="?demo">Switch to trainer view</a>` : `<a href="?demo=client">Switch to client view</a>`);
    api = demoApi(DEMO_CLIENT);
    S.me = { id: "me", email: DEMO_CLIENT ? "sample.client@example.com" : "trainer@example.com" };
    S.isTrainer = !DEMO_CLIENT;
    await loadAll(); return;
  }
  if (!CONFIGURED) { S.screen = "setup"; render(); return; }
  if (!window.supabase || !window.supabase.createClient) { banner("Couldn't load the sign-in service. Check your connection and reload."); S.screen = "setup"; render(); return; }
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" } });
  api = supaApi(sb);
  sb.auth.onAuthStateChange((_ev, session) => { setTimeout(() => onSession(session), 0); });
  const { data } = await sb.auth.getSession();
  onSession(data.session);
}
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (S.screen === "app" && client()) drawChart(series(client(), S.checkins)); }, 120); });
render(); boot();
})();
