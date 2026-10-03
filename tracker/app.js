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
/* Rest days live in a plan as days whose exercises have no sets (e.g. "Wed · Rest"). */
const isRestDay = d => /(^|·\s*)rest\b/i.test(d && d.name || "") || !(d && d.items || []).some(x => String(x.sets || "").trim());
const trainDays = days => (Array.isArray(days) ? days : []).filter(d => !isRestDay(d)).length;
const BUCKET = "progress-photos";
const fromClientRow = r => ({ id: r.id, userId: r.user_id, email: r.email, name: r.name, sex: r.sex, dob: r.dob, height: num(r.height_in), goal: r.goal, glp1: !!r.on_glp1, active: r.active !== false, waterGoal: num(r.water_goal_oz), kcalGoal: num(r.kcal_goal), proteinGoal: num(r.protein_goal), carbsGoal: num(r.carbs_goal), fatGoal: num(r.fat_goal), habits: Array.isArray(r.habits) ? r.habits : null });
const toClientRow = c => ({ email: c.email, name: c.name, sex: c.sex, dob: c.dob || null, height_in: c.height, goal: c.goal || null, on_glp1: !!c.glp1, water_goal_oz: c.waterGoal ?? null, kcal_goal: c.kcalGoal ?? null, protein_goal: c.proteinGoal ?? null, carbs_goal: c.carbsGoal ?? null, fat_goal: c.fatGoal ?? null });
const FEEL_KEYS = ["energy", "hunger", "sleep_q", "sleep_hours", "steps", "side_effects"];
const SIDE_EFFECTS = ["Nausea", "Vomiting", "Constipation", "Diarrhea", "Heartburn", "Bloating", "Tired", "Headache", "Dizzy", "Low appetite"];
const fromCheckinRow = r => ({ id: r.id, clientId: r.client_id, date: r.date, weight: num(r.weight_lb), waist: num(r.waist_in), neck: num(r.neck_in), hip: num(r.hip_in), omron: num(r.omron_bf), photoFront: r.photo_front, photoSide: r.photo_side, note: r.note, energy: num(r.energy), hunger: num(r.hunger), sleepQ: num(r.sleep_q), sleepH: num(r.sleep_hours), steps: num(r.steps), sideEffects: Array.isArray(r.side_effects) ? r.side_effects : [], coachNote: r.coach_note || null, coachNoteAt: r.coach_note_at || null, enteredBy: r.entered_by, createdAt: r.created_at });
const fromWorkoutRow = r => ({ id: r.id, clientId: r.client_id, date: r.date, dayName: r.day_name || "", entries: Array.isArray(r.entries) ? r.entries : [], note: r.note || "", program: r.program || "", enteredBy: r.entered_by, createdAt: r.created_at });
const fromHealthRow = r => ({ date: r.date, steps: num(r.steps), sleepH: num(r.sleep_hours), weight: num(r.weight_lb), kcal: num(r.active_kcal), exMin: num(r.exercise_min), rhr: num(r.resting_hr), kcalIn: num(r.kcal_in), protein: num(r.protein_g), carbs: num(r.carbs_g), fat: num(r.fat_g), hrv: num(r.hrv_ms), zone2: num(r.zone2_min), updatedAt: r.updated_at });
const fromMsgRow = r => ({ id: r.id, clientId: r.client_id, fromCoach: !!r.from_coach, body: r.body || "", createdAt: r.created_at, readAt: r.read_at || null });
const fromTplRow = r => ({ id: r.id, name: r.name, title: r.title || "", notes: r.notes || "", days: Array.isArray(r.days) ? r.days : [], program: r.program && typeof r.program === "object" ? r.program : null });
const fromPlanRow = r => r ? ({ title: r.title || "", notes: r.notes || "", days: Array.isArray(r.days) ? r.days : [], program: r.program && typeof r.program === "object" ? r.program : null, updatedAt: r.updated_at }) : null;
/* Supabase reports a missing table/column when the October 2026 database update hasn't been run yet. */
const isMissing = e => !!e && (e.code === "42P01" || e.code === "42703" || e.code === "PGRST205" || e.code === "PGRST204" || /does not exist|schema cache/i.test(e.message || ""));
const toCheckinRow = e => ({ client_id: e.clientId, date: e.date, weight_lb: e.weight, waist_in: e.waist, neck_in: e.neck, hip_in: e.hip, omron_bf: e.omron, photo_front: e.photoFront, photo_side: e.photoSide, note: e.note,
  energy: e.energy ?? null, hunger: e.hunger ?? null, sleep_q: e.sleepQ ?? null, sleep_hours: e.sleepH ?? null, steps: e.steps ?? null, side_effects: e.sideEffects && e.sideEffects.length ? e.sideEffects : null });
/* Before the October 2026 database update the new columns don't exist yet; save without them. */
const withoutFeel = row => { const r = { ...row }; FEEL_KEYS.forEach(k => delete r[k]); delete r.on_glp1; delete r.water_goal_oz; delete r.kcal_goal; delete r.protein_goal; delete r.carbs_goal; delete r.fat_goal; return r; };

function supaApi(sb) {
  const chk = ({ data, error }) => { if (error) throw error; return data; };
  return {
    async isTrainer(userId) { return !!chk(await sb.from("trainers").select("user_id").eq("user_id", userId).maybeSingle()); },
    async listClients() { return chk(await sb.from("clients").select("*").order("name")).map(fromClientRow); },
    async listCheckins(clientId) { return chk(await sb.from("checkins").select("*").eq("client_id", clientId).order("date").order("created_at")).map(fromCheckinRow); },
    async saveClient(c, id) {
      const save = row => id ? sb.from("clients").update(row).eq("id", id).select().single() : sb.from("clients").insert(row).select().single();
      let res = await save(toClientRow(c));
      if (res.error && isMissing(res.error)) { res = await save(withoutFeel(toClientRow(c))); if (!res.error) toast("Saved. Run the latest database update (supabase/schema.sql) to keep the GLP-1 and water settings."); }
      return fromClientRow(chk(res));
    },
    async setActive(id, active) {
      const res = await sb.from("clients").update({ active }).eq("id", id).select().single();
      if (res.error && isMissing(res.error)) throw { code: "needs-update" };
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
    async savePlan(clientId, p) {
      const row = { client_id: clientId, title: p.title || null, notes: p.notes || null, days: p.days, program: p.program || null };
      let res = await sb.from("client_plans").upsert(row, { onConflict: "client_id" }).select().single();
      if (res.error && isMissing(res.error)) { delete row.program; res = await sb.from("client_plans").upsert(row, { onConflict: "client_id" }).select().single(); if (!res.error && p.program) toast("Saved without the program weeks. Run the latest database update (supabase/schema.sql)."); }
      return fromPlanRow(chk(res));
    },
    async deletePlan(clientId) { chk(await sb.from("client_plans").delete().eq("client_id", clientId)); },
    async saveFeedback(checkinId, note) { return fromCheckinRow(chk(await sb.from("checkins").update({ coach_note: note || null }).eq("id", checkinId).select().single())); },
    async listTemplates() { return chk(await sb.from("plan_templates").select("*").order("name")).map(fromTplRow); },
    async listHealth(clientId) { return chk(await sb.from("health_daily").select("*").eq("client_id", clientId).order("date", { ascending: false }).limit(120)).map(fromHealthRow); },
    async upsertHealth(clientId, rows) {
      /* Values outside the database limits are dropped (not the whole day), so one odd reading never blocks a sync. */
      const rng = (v, lo, hi, int) => { const n = num(v); if (n == null || n < lo || n > hi) return null; return int ? Math.round(n) : n; };
      const clean = rows.map(r => ({ client_id: clientId, date: r.date, steps: rng(r.steps, 0, 200000, true), sleep_hours: rng(r.sleepHours, 0, 24), weight_lb: rng(r.weightLb, 50, 900), active_kcal: rng(r.activeKcal, 0, 20000, true), exercise_min: rng(r.exerciseMin, 0, 1440, true), resting_hr: rng(r.restingHr, 20, 250, true), kcal_in: rng(r.kcalIn, 0, 20000, true), protein_g: rng(r.proteinG, 0, 2000), carbs_g: rng(r.carbsG, 0, 3000), fat_g: rng(r.fatG, 0, 1000), hrv_ms: rng(r.hrvMs, 1, 300, true), zone2_min: rng(r.zone2Min, 0, 1440, true), source: "apple_health" }));
      if (!clean.length) return;
      let res = await sb.from("health_daily").upsert(clean, { onConflict: "client_id,date" });
      if (res.error && isMissing(res.error)) res = await sb.from("health_daily").upsert(clean.map(({ kcal_in, protein_g, carbs_g, fat_g, hrv_ms, zone2_min, ...r }) => r), { onConflict: "client_id,date" });
      chk(res);
    },
    async deleteAccount(clientIds) {
      for (const id of clientIds) {
        const files = (await sb.storage.from(BUCKET).list(id, { limit: 1000 })).data || [];
        if (files.length) await sb.storage.from(BUCKET).remove(files.map(f => id + "/" + f.name));
      }
      chk(await sb.rpc("delete_my_account"));
    },
    async claimToken(token, env) { chk(await sb.rpc("claim_device_token", { p_token: token, p_env: env })); },
    async setHabits(clientId, habits) { return fromClientRow(chk(await sb.from("clients").update({ habits }).eq("id", clientId).select().single())); },
    async listHabitLogs(clientId) { return chk(await sb.from("habit_logs").select("date,habit_id").eq("client_id", clientId).gte("date", daysBack(130).pop())).map(r => ({ date: r.date, habitId: r.habit_id })); },
    async toggleHabit(clientId, date, id, on) {
      if (on) chk(await sb.from("habit_logs").upsert({ client_id: clientId, date, habit_id: id }, { onConflict: "client_id,date,habit_id", ignoreDuplicates: true }));
      else chk(await sb.from("habit_logs").delete().eq("client_id", clientId).eq("date", date).eq("habit_id", id));
    },
    async listMessages(clientId) { return chk(await sb.from("messages").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(300)).map(fromMsgRow).reverse(); },
    async sendMessage(clientId, body) { return fromMsgRow(chk(await sb.from("messages").insert({ client_id: clientId, body }).select().single())); },
    async markRead(clientId, isTrainer) { chk(await sb.from("messages").update({ read_at: new Date().toISOString() }).eq("client_id", clientId).is("read_at", null).eq("from_coach", !isTrainer)); },
    async overview() {
      const since = daysBack(14).pop(), safe = async q => { const { data, error } = await q; if (error) { if (!isMissing(error)) console.error(error); return []; } return data || []; };
      const [checkins, workouts, water, health, plans] = await Promise.all([
        safe(sb.from("checkins").select("client_id,date,coach_note,created_at,weight_lb").gte("date", daysBack(120).pop()).order("date", { ascending: false }).limit(3000)),
        safe(sb.from("workout_logs").select("client_id,date,day_name").gte("date", since)),
        safe(sb.from("water_daily").select("client_id,date,oz").gte("date", since)),
        safe(sb.from("health_daily").select("*").gte("date", daysBack(32).pop())),
        safe(sb.from("client_plans").select("*"))]);
      const unread = await safe(sb.from("messages").select("client_id").is("read_at", null).eq("from_coach", false));
      return { checkins, workouts, water, health, plans, unread };
    },
    async listWater(clientId) { return chk(await sb.from("water_daily").select("date,oz").eq("client_id", clientId).order("date", { ascending: false }).limit(400)).map(r => ({ date: r.date, oz: num(r.oz) || 0 })); },
    async setWater(clientId, date, oz) { chk(await sb.from("water_daily").upsert({ client_id: clientId, date, oz }, { onConflict: "client_id,date" })); },
    async listWorkouts(clientId) { return chk(await sb.from("workout_logs").select("*").eq("client_id", clientId).order("date", { ascending: false }).order("created_at", { ascending: false }).limit(300)).map(fromWorkoutRow); },
    async addWorkout(w) {
      const row = { client_id: w.clientId, date: w.date, day_name: w.dayName || null, entries: w.entries, note: w.note || null, program: w.program || null };
      let res = await sb.from("workout_logs").insert(row).select().single();
      if (res.error && isMissing(res.error)) { delete row.program; res = await sb.from("workout_logs").insert(row).select().single(); }
      return fromWorkoutRow(chk(res));
    },
    async deleteWorkout(id) { chk(await sb.from("workout_logs").delete().eq("id", id)); },
    async saveTemplate(t, id) {
      const row = { name: t.name, title: t.title || null, notes: t.notes || null, days: t.days, program: t.program || null };
      const save = r => id ? sb.from("plan_templates").update(r).eq("id", id).select().single() : sb.from("plan_templates").insert(r).select().single();
      let res = await save(row);
      if (res.error && isMissing(res.error)) { delete row.program; res = await save(row); }
      return fromTplRow(chk(res));
    },
    async deleteTemplate(id) { chk(await sb.from("plan_templates").delete().eq("id", id)); }
  };
}

function demoApi(asClient) {
  const clients = [
    { id: "c1", userId: asClient ? "me" : "u1", email: "sample.client@example.com", name: "Sample Client", sex: "female", dob: "1990-04-12", height: 65, goal: "Lose fat, keep lean mass", glp1: true, active: true, habits: ["workout", "steps10k", "sleep7", "water", "veg", "creatine"], kcalGoal: 1850, proteinGoal: 140, carbsGoal: 170, fatGoal: 65 },
    { id: "c2", userId: null, email: "sample.two@example.com", name: "Sample Client Two", sex: "male", dob: "1984-11-02", height: 70, goal: "Recomp for summer", active: false }
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
  /* Sample program run: the 8-week Strength Builder, started 3 weeks ago. */
  const SB = { notes: "4 days a week: Monday, Tuesday, Thursday, Friday. Each day is about 45 minutes of lifting, then 30 minutes of Zone 2 (the 45/30 rule). Every muscle gets trained twice a week with 10\u201316 hard sets, the range research supports for growth. Main lifts get heavier every two weeks; accessories stay close to failure for muscle. Week 7 is a deload, week 8 is PR week.", days: [{"name": "Mon · Upper A (bench)", "items": [{"name": "Barbell or Dumbbell Bench Press", "sets": "4", "reps": "6–8", "rest": "3 min", "note": "Main lift. Same setup every time: feet planted, shoulder blades pinched.", "ref": "chest", "kind": "main"}, {"name": "Barbell or Dumbbell Row", "sets": "4", "reps": "6–8", "rest": "2–3 min", "note": "", "ref": "back", "kind": "main"}, {"name": "Seated Dumbbell Shoulder Press", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "shoulders", "kind": "acc"}, {"name": "Pull-Up or Lat Pulldown", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "back", "kind": "acc"}, {"name": "Triceps Pushdown", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Tue · Lower A (squat)", "items": [{"name": "Back Squat or Goblet Squat", "sets": "4", "reps": "6–8", "rest": "3 min", "note": "Main lift. Brace hard, sit between your hips, drive up.", "ref": "legs", "kind": "main"}, {"name": "Romanian Deadlift", "sets": "4", "reps": "6–8", "rest": "2–3 min", "note": "", "ref": "legs", "kind": "main"}, {"name": "Leg Press", "sets": "3", "reps": "10–12", "rest": "2 min", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Lying or Seated Leg Curl", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Standing Calf Raise", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Thu · Upper B (press)", "items": [{"name": "Seated Dumbbell Shoulder Press", "sets": "4", "reps": "6–8", "rest": "2–3 min", "note": "Main lift today.", "ref": "shoulders", "kind": "main"}, {"name": "Pull-Up or Lat Pulldown", "sets": "4", "reps": "6–8", "rest": "2–3 min", "note": "", "ref": "back", "kind": "main"}, {"name": "Incline Dumbbell Press", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "chest", "kind": "acc"}, {"name": "Seated Cable Row", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "back", "kind": "acc"}, {"name": "Dumbbell Lateral Raise", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "shoulders", "kind": "acc"}, {"name": "EZ-Bar Curl", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Fri · Lower B (hips)", "items": [{"name": "Barbell Hip Thrust", "sets": "4", "reps": "6–8", "rest": "2–3 min", "note": "Main lift. Pause one second at the top.", "ref": "glutes", "kind": "main"}, {"name": "Bulgarian Split Squat", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "Reps are per leg.", "ref": "glutes", "kind": "acc"}, {"name": "Goblet or Back Squat", "sets": "3", "reps": "10–12", "rest": "2 min", "note": "Lighter second squat day. Smooth, controlled reps.", "ref": "legs", "kind": "acc"}, {"name": "Lying or Seated Leg Curl", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Hanging or Captain's Chair Knee Raise", "sets": "3", "reps": "10–15", "rest": "60 sec", "note": "", "ref": "core"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}], program: {"name": "8-Week Strength Builder", "weeks": 8, "daysPerWeek": 4, "phases": [{"from": 1, "to": 2, "name": "Build", "note": "Learn the lifts and find your working weights. Main lifts: stop with about 2 good reps left. Accessories: 1–2 left. When you hit the top of the rep range on every set, add weight next time (about 5 lb upper body, 5–10 lb lower body).", "main": {"sets": 4, "reps": "6–8", "rir": "2", "rest": "2–3 min"}, "acc": {"sets": 3, "reps": "10–12", "rir": "1–2"}}, {"name": "Load", "from": 3, "to": 4, "note": "Heavier: fewer reps, more weight. Keep 2 reps in the tank on main lifts. Push accessories closer to failure.", "main": {"sets": 4, "reps": "5–6", "rir": "2", "rest": "3 min"}, "acc": {"sets": 3, "reps": "8–10", "rir": "1–2"}}, {"name": "Strength", "from": 5, "to": 6, "note": "The heaviest block. 5 sets on the main lifts, 1–2 reps in the tank. Rest the full 3 minutes so every set is strong.", "main": {"sets": 5, "reps": "4–5", "rir": "1–2", "rest": "3 min"}, "acc": {"sets": 3, "reps": "8–10", "rir": "1"}}, {"name": "Deload", "from": 7, "to": 7, "deload": true, "note": "Recovery week. Use about 85–90% of last week's weights and leave plenty in the tank. This is when your body catches up and gets stronger.", "main": {"sets": 3, "reps": "5", "rir": "4", "rest": "2 min"}, "acc": {"sets": 2, "reps": "10", "rir": "3"}}, {"name": "PR week", "from": 8, "to": 8, "peak": true, "note": "Show what you've built. Warm up well, then go for your best sets on the main lifts. Your new records show up in Strength.", "main": {"sets": 3, "reps": "3–5", "rir": "0–1", "rest": "3–4 min"}, "acc": {"sets": 2, "reps": "8–10", "rir": "1"}}]} };
  { const d = new Date(); d.setDate(d.getDate() - 17 - ((d.getDay() + 6) % 7)); plans.c1 = { title: "8-Week Strength Builder", notes: SB.notes, days: JSON.parse(JSON.stringify(SB.days)), program: { ...SB.program, start: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) }, updatedAt: new Date().toISOString() }; }
  let workouts = [];
  { const pk = `${plans.c1.program.name}|${plans.c1.program.start}|8|4`, st = toDate(plans.c1.program.start);
    for (let wk = 0; wk < 3; wk++) [0, 1, 3, 4].forEach((off, di) => { const d = new Date(st); d.setDate(d.getDate() + wk * 7 + off); if (d > new Date()) return;
      const day = plans.c1.days[di], date = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      workouts.push({ id: "w" + date, clientId: "c1", date, dayName: day.name, note: "", program: pk, enteredBy: "me", createdAt: date + "T17:00:00Z",
        entries: day.items.map((x, k) => /min/.test(x.reps) ? { name: x.name, ref: x.ref, target: "30 min", timed: true, done: true, sets: [] }
          : { name: x.name, ref: x.ref, target: `${x.sets} × ${x.reps}`, timed: false, done: true, sets: Array.from({ length: +x.sets || 3 }, (_, si) => ({ lb: [95, 85, 30, 70, 40, 25][k] + wk * (x.kind === "main" ? 10 : 5), reps: Math.max(5, 8 - si) })) }) }); }); }
  /* Sample Apple Health days for the demo client, newest first. */
  const health = Array.from({ length: 21 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); const iso = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    return { date: iso, steps: 7000 + ((i * 1337) % 4200), sleepH: 6.4 + ((i * 7) % 12) / 10, weight: +(154.6 + i * 0.12).toFixed(1), kcal: 380 + ((i * 53) % 260), exMin: 22 + ((i * 11) % 35), rhr: 61 + (i % 4), hrv: i === 0 ? 54 : 42 + ((i * 7) % 11), zone2: i % 2 ? 28 + (i % 5) * 2 : 0, kcalIn: i === 0 ? 1180 : 1700 + ((i * 97) % 300), protein: i === 0 ? 96 : 120 + ((i * 7) % 30), carbs: i === 0 ? 104 : 150 + ((i * 13) % 40), fat: i === 0 ? 41 : 55 + ((i * 5) % 15), updatedAt: "2026-10-01T07:30:00Z" }; });
  /* Sample water: today partly done, the last two weeks mostly near goal. */
  const water = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return { date: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()), oz: i === 0 ? 32 : [80, 64, 72, 88, 56, 80, 72, 64, 88, 80, 72, 48, 80][i - 1] }; });
  /* Sample habits and messages. */
  const dIso = k => { const d = new Date(); d.setDate(d.getDate() - k); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  let habitLogs = [];
  for (let k = 1; k < 14; k++) { if (k % 5) habitLogs.push({ date: dIso(k), habitId: "veg" }); habitLogs.push({ date: dIso(k), habitId: "creatine" }); }
  const msgs = [
    { id: "m1", clientId: "c1", fromCoach: true, body: "Welcome to the Strength Builder! Week 1 is about finding your weights. Leave 2 reps in the tank.", createdAt: dIso(6) + "T15:02:00Z", readAt: dIso(6) + "T16:00:00Z" },
    { id: "m2", clientId: "c1", fromCoach: false, body: "Thanks! Is it ok to do Friday's workout Saturday this week?", createdAt: dIso(2) + "T18:20:00Z", readAt: dIso(2) + "T19:00:00Z" },
    { id: "m3", clientId: "c1", fromCoach: true, body: "Totally fine. Just keep a rest day before Monday. Great job hitting your protein 6 days straight 🥩", createdAt: dIso(0) + "T13:05:00Z", readAt: null }];
  const templates = [{ id: "t1", name: "8-Week Strength Builder (4-day Upper/Lower)", title: "8-Week Strength Builder", notes: SB.notes, days: JSON.parse(JSON.stringify(SB.days)), program: JSON.parse(JSON.stringify(SB.program)) }];
  const photos = {};
  const wait = () => new Promise(r => setTimeout(r, 120));
  return {
    async isTrainer() { return !asClient; },
    async listClients() { await wait(); return (asClient ? clients.filter(c => c.userId === "me") : clients).slice().sort((a, b) => a.name.localeCompare(b.name)); },
    async listCheckins(id) { await wait(); return entries.filter(e => e.clientId === id); },
    async saveClient(c, id) { await wait(); if (clients.some(x => x.email.toLowerCase() === c.email.toLowerCase() && x.id !== id)) throw { code: "23505" }; if (id) { Object.assign(clients.find(x => x.id === id), c); return clients.find(x => x.id === id); } const n = { ...c, id: uid(), userId: null }; clients.push(n); return n; },
    async setActive(id, active) { await wait(); const c = clients.find(x => x.id === id); c.active = active; return { ...c }; },
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
    async upsertHealth(id, rows) { await wait(); rows.forEach(r => { const i = health.findIndex(h => h.date === r.date); const h = { date: r.date, steps: r.steps ?? null, sleepH: r.sleepHours ?? null, weight: r.weightLb ?? null, kcal: r.activeKcal ?? null, exMin: r.exerciseMin ?? null, rhr: r.restingHr ?? null, kcalIn: r.kcalIn ?? null, protein: r.proteinG ?? null, carbs: r.carbsG ?? null, fat: r.fatG ?? null, hrv: r.hrvMs ?? null, zone2: r.zone2Min ?? null, updatedAt: new Date().toISOString() }; if (i >= 0) health[i] = h; else health.push(h); }); health.sort((a, b) => b.date.localeCompare(a.date)); },
    async deleteAccount() { await wait(); },
    async setHabits(id, habits) { await wait(); const c = clients.find(x => x.id === id); c.habits = habits; return { ...c }; },
    async listHabitLogs(id) { await wait(); return id === "c1" ? habitLogs.map(h => ({ ...h })) : []; },
    async toggleHabit(id, date, hid, on) { await wait(); habitLogs = habitLogs.filter(h => !(h.date === date && h.habitId === hid)); if (on) habitLogs.push({ date, habitId: hid }); },
    async listMessages(id) { await wait(); return msgs.filter(m => m.clientId === id).map(m => ({ ...m })); },
    async sendMessage(id, body) { await wait(); const m = { id: uid(), clientId: id, fromCoach: !asClient, body, createdAt: new Date().toISOString(), readAt: null }; msgs.push(m); return { ...m }; },
    async markRead(id, isTrainer) { await wait(); msgs.forEach(m => { if (m.clientId === id && !m.readAt && m.fromCoach === !isTrainer) m.readAt = new Date().toISOString(); }); },
    async overview() { await wait();
      return { checkins: entries.map(e => ({ client_id: e.clientId, date: e.date, coach_note: e.coachNote, created_at: e.createdAt, weight_lb: e.weight })),
        workouts: workouts.map(w => ({ client_id: w.clientId, date: w.date, day_name: w.dayName })), water: water.map(w => ({ client_id: "c1", date: w.date, oz: w.oz })),
        health: health.map(h => ({ client_id: "c1", date: h.date, steps: h.steps, sleep_hours: h.sleepH, hrv_ms: h.hrv, resting_hr: h.rhr, active_kcal: h.kcal, exercise_min: h.exMin })), plans: Object.entries(plans).map(([k, v]) => ({ client_id: k, days: v.days, program: v.program || null, updated_at: v.updatedAt })), unread: msgs.filter(m => !m.readAt && !m.fromCoach).map(m => ({ client_id: m.clientId })) }; },
    async listWater(id) { await wait(); return id === "c1" ? water.map(w => ({ ...w })) : []; },
    async setWater(id, date, oz) { await wait(); const w = water.find(x => x.date === date); if (w) w.oz = oz; else { water.push({ date, oz }); water.sort((a, b) => b.date.localeCompare(a.date)); } },
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
if (IN_APP) { const vp = document.querySelector('meta[name="viewport"]'); if (vp) vp.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"; }
if (RENOVO) {
  document.documentElement.classList.add("renovo");
  const brand = document.querySelector(".brand"); if (brand) brand.innerHTML = `<span class="rv-logo">RENOVO<span>COACH</span></span>`;
  const sub = document.querySelector(".brand-sub"); if (sub) sub.textContent = "Renew your body. Rebuild your life.";
  document.title = "RENOVO COACH";
}
const IS_HOME_APP = IN_APP || window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
let sb = null, api = null;
const S = { me: null, isTrainer: false, clients: [], sel: null, checkins: [], plan: null, planMissing: false, templates: [], workouts: [], workoutsMissing: false, health: [], healthMissing: false, water: [], waterMissing: false, habitLogs: [], habitsMissing: false, msgs: [], msgsMissing: false, app: { connected: false, lastSync: null }, urls: {}, screen: "loading", metric: "bf", view: "front", cmpA: null, cmpB: null, overlay: false, fade: 50, authEmail: "", authStep: "email", pwMode: null, pwBack: null };
const store = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} } };
const client = () => S.clients.find(c => c.id === S.sel) || null;
const canDelete = e => S.isTrainer || (S.me && e.enteredBy === S.me.id);

/* ---------- header ---------- */
function renderBar() {
  const el = $("#barRight");
  if (!["app", "noaccess", "paused", "overview"].includes(S.screen)) { el.innerHTML = ""; return; }
  let h = "";
  if (S.screen === "app" && S.isTrainer && S.clients.length) {
    const opts = S.clients.map(c => `<option value="${esc(c.id)}"${c.id === S.sel ? " selected" : ""}>${esc(c.name)}${c.active ? "" : " (paused)"}</option>`).join("");
    h += `<label class="small muted" for="clientPick" hidden>Client</label><select id="clientPick" aria-label="Client">${opts}</select>`;
  }
  if (S.screen === "app" && S.isTrainer) h += `<button class="btn" id="allClients" type="button">All clients</button>`;
  if (S.screen === "overview" && S.isTrainer) h += `<button class="btn" id="addClient" type="button">Add client</button>`;
  h += `<span class="who" title="${esc(S.me?.email)}">${esc(S.me?.email)}</span>${DEMO ? "" : `<button class="btn ghost sm" id="changePw" type="button">Password</button>`}<button class="btn ghost sm" id="signOut" type="button">${DEMO ? "Exit demo" : "Sign out"}</button>`;
  el.innerHTML = h;
  const p = $("#clientPick"); if (p) p.onchange = () => selectClient(p.value);
  const a = $("#addClient"); if (a) a.onclick = () => openClient(null);
  const ac = $("#allClients"); if (ac) ac.onclick = () => { window.scrollTo(0, 0); loadOverview(); };
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
  if (S.screen === "noaccess") { app.innerHTML = noAccessScreen() + acctFoot(); const da = $("#delAcct"); if (da) da.onclick = openDeleteAccount; return; }
  if (S.screen === "paused") { app.innerHTML = pausedScreen() + acctFoot(); const da = $("#delAcct"); if (da) da.onclick = openDeleteAccount; return; }
  if (S.screen === "overview") {
    app.innerHTML = overviewScreen();
    $$("[data-open]").forEach(b => b.onclick = async () => { S.screen = "app"; window.scrollTo(0, 0); await selectClient(b.dataset.open); });
    const w = $("#welcomeAdd"); if (w) w.onclick = () => openClient(null);
    return;
  }
  if (!S.clients.length) { app.innerHTML = welcome(); const b = $("#welcomeAdd"); if (b) b.onclick = () => openClient(null); return; }
  const c = client(); const s = series(c, S.checkins);
  app.innerHTML = `<div class="stack">${head(c, s)}${msgBanner(c)}${coachCallout(c)}${todayWorkoutCard(c)}${habitsCard(c)}${todayCard(c)}${scoreCard(c)}${healthCard(c)}${waterCard(c)}${fuelCard(c)}${trendsCard()}${tiles(c, s)}${s.rows.length ? calNote(c, s) : ""}${planCard(c)}${strengthCard()}${badgesCard(c)}${workoutsCard(c)}${chartCard(s)}<div class="split">${logCard(c, s)}<div class="stack">${photoCard(s)}${summaryCard(c, s)}</div></div>${RENOVO && !S.isTrainer ? shopCard() : ""}${acctFoot()}</div>`;
  wire(c, s);
  const da = $("#delAcct"); if (da) da.onclick = openDeleteAccount;
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

function pausedScreen() {
  const c = S.clients[0];
  return `<section class="msg"><div class="kicker">Coaching paused</div><h1>Your coaching is paused${c ? `, ${esc(firstName(c.name))}` : ""}</h1>
  <p>Your check-ins, workouts and progress photos are all saved. To pick up where you left off, contact ${esc(TRAINER)} to restart your coaching.</p>
  <p class="small">Once ${esc(TRAINER)} turns your coaching back on, reload this page and everything will be right where you left it.</p></section>`;
}

/* Apple requires that anyone who can sign in can also delete their account from inside the app. */
const acctFoot = () => S.isTrainer || DEMO && !DEMO_CLIENT ? "" : `<div class="acct-foot"><button type="button" class="linkbtn danger" id="delAcct">Delete my account</button></div>`;
function openDeleteAccount() {
  let d = $("#dlgDelete");
  if (!d) {
    d = document.createElement("dialog"); d.id = "dlgDelete";
    d.innerHTML = `<form method="dialog" novalidate><h3>Delete your account?</h3>
      <p>This permanently deletes your RENOVO login and everything in it: check-ins, progress photos, workouts, your plan, water and Apple Health data. This can't be undone.</p>
      <p class="small muted">If you're a coaching client, this doesn't cancel any payment you've made outside the app. Talk to ${esc(TRAINER)} about your coaching.</p>
      <div class="field"><label for="delConfirm">Type <b>DELETE</b> to confirm</label><input id="delConfirm" type="text" autocomplete="off" autocapitalize="characters"></div>
      <div class="err" id="delErr"></div>
      <div class="foot"><span></span><div class="r"><button type="button" class="btn" id="delCancel">Cancel</button><button type="submit" class="btn danger" id="delGo">Delete account</button></div></div></form>`;
    document.body.appendChild(d);
    $("#delCancel").onclick = () => d.close();
    d.querySelector("form").onsubmit = async ev => {
      ev.preventDefault();
      if ($("#delConfirm").value.trim().toUpperCase() !== "DELETE") { $("#delErr").textContent = "Type DELETE to confirm."; return; }
      const b = $("#delGo"); b.disabled = true; b.textContent = "Deleting…"; $("#delErr").textContent = "";
      try {
        await api.deleteAccount(S.clients.map(c => c.id));
        d.close(); toApp({ type: "accountDeleted" });
        if (DEMO) { toast("Demo only: nothing was deleted."); return; }
        try { await sb.auth.signOut(); } catch (_) {}
        S.me = null; currentUser = null; S.screen = "login"; S.authStep = "email"; render();
        toast("Your account and all your data were deleted.");
      } catch (e) { console.error(e); $("#delErr").textContent = "Couldn't delete your account. Check your connection and try again, or email info@renovocoach.com."; }
      b.disabled = false; b.textContent = "Delete account";
    };
  }
  $("#delConfirm").value = ""; $("#delErr").textContent = ""; d.showModal();
}

function welcome() {
  return `<section class="hero"><div><div class="kicker">Trainer setup</div><h1>Omron at the gym. Tape at home.</h1>
  <p>Add a client with their email. Record their baseline at the gym with an Omron reading. They can then sign in from their phone and log weekly tape check-ins, and the app keeps their numbers in line with the gym reading.</p>
  <button class="btn primary" id="welcomeAdd" type="button">Add your first client</button></div>
  <ol class="steps"><li><b>Baseline at the gym</b>Weight, waist, neck and hips, plus an Omron reading and photos.</li>
  <li><b>Home check-ins</b>The client tapes and weighs weekly. The app applies their personal correction.</li>
  <li><b>Recalibrate monthly</b>A fresh Omron reading keeps the estimates honest.</li></ol></section>`;
}

/* Omron calibration status + how the estimate works. Sits under the body-composition tiles. */
function calNote(c, s) {
  const t = todayISO();
  let pill;
  if (!s.cal.length) pill = `<span class="pill warn">${ICON_WARN}${S.isTrainer ? "Not calibrated. Take an Omron reading at the next gym visit." : "Not calibrated yet. Your next gym check-in sets this up."}</span>`;
  else {
    const k = s.cal[s.cal.length - 1], ago = days(k.date, t);
    pill = ago > 42 ? `<span class="pill warn">${ICON_WARN}${S.isTrainer ? "Recalibrate" : "Gym check-in due"}: last Omron ${ago} days ago</span>`
      : `<span class="pill good">${ICON_OK}Calibrated ${sgn(k.off)} pts · Omron ${ago === 0 ? "today" : ago + " days ago"}</span>`;
  }
  return `<div class="calnote">${pill}<details class="how"><summary>How the estimate works</summary><p>Each check-in runs the US Navy tape formula on waist, neck${c.sex === "male" ? "" : ", hips"} and height. On gym days the Omron reading is compared with that number and the gap is saved. Home check-ins use the tape number plus the most recent gap. Omron readings swing with water, food and training, so they're taken at the same time of day, before a workout.</p></details></div>`;
}

function head(c, s) {
  const t = todayISO(), age = ageAt(c.dob, t);
  const bits = [c.sex === "male" ? "Male" : "Female", age != null ? age + " yrs" : null, htStr(c.height)].filter(Boolean).join(" · ");
  const pill = S.isTrainer && !c.active ? `<div><span class="pill warn">${ICON_WARN}Coaching paused. ${esc(firstName(c.name))} can't open the tracker until you resume.</span></div>` : "";
  const linked = S.isTrainer ? (c.userId ? ` · <span title="${esc(c.email)}">Signed in</span>` : ` · <span title="${esc(c.email)}">Hasn't signed in yet</span>`) : "";
  return `<div class="chead"><div class="grow">${S.isTrainer ? "" : `<div class="kicker">Your progress</div>`}<h1>${esc(c.name)}</h1>
    <div class="meta">${esc(bits)}${c.goal ? ` · Goal: ${esc(c.goal)}` : ""}${linked}</div>${pill}</div>
    <div class="actions">${msgButton(c)}${calcLink(c, s)}${S.isTrainer ? `<button class="btn" id="editClient" type="button">Edit client</button><button class="btn${c.active ? "" : " primary"}" id="toggleActive" type="button">${c.active ? "Pause coaching" : "Resume coaching"}</button>` : ""}<button class="btn primary" id="newEntry" type="button">${S.isTrainer ? "New check-in" : "Log check-in"}</button></div></div>`;
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
  on("#toggleActive", () => toggleActive(c));
  on("#openMsgs", () => openMessages(c)); on("#openMsgs2", () => openMessages(c)); on("#openRem", openReminders);
  wireHabits(c);
  wireWater(c);
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
  $$("#planWhere [data-where]").forEach(b => b.onclick = () => { setWhere(b.dataset.where); render(); });
  const lp = $("#liftPick"); if (lp) lp.onchange = () => { S.lift = lp.value; const card = document.querySelector(".strength"); if (card) { card.outerHTML = strengthCard(); wire(c, s); } };
  $$("[data-trend]").forEach(b => b.onclick = () => { S.trend = b.dataset.trend; const card = document.querySelector(".trends"); if (card) { card.outerHTML = trendsCard(); wire(c, s); } });
  $$("[data-tspan]").forEach(b => b.onclick = () => { S.trendSpan = +b.dataset.tspan; const card = document.querySelector(".trends"); if (card) { card.outerHTML = trendsCard(); wire(c, s); } });
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

/* Pause or resume a client's coaching. Pausing asks for a second tap. */
async function toggleActive(c) {
  const btn = $("#toggleActive");
  if (c.active && !btn.classList.contains("armed")) {
    btn.classList.add("armed"); btn.textContent = "Tap again to pause";
    setTimeout(() => { if (btn.isConnected && btn.classList.contains("armed")) { btn.classList.remove("armed"); btn.textContent = "Pause coaching"; } }, 4000);
    return;
  }
  btn.disabled = true;
  try {
    const saved = await api.setActive(c.id, !c.active);
    Object.assign(c, { active: saved.active });
    toast(saved.active ? `${firstName(c.name)}'s coaching is back on.` : `${firstName(c.name)} is paused. Their history is saved.`);
    render();
  } catch (e) {
    btn.disabled = false;
    toast(e && e.code === "needs-update" ? "Run the latest database update (supabase/schema.sql) first, then try again." : "Couldn't change that. Check your connection and try again.");
  }
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
    await loadWater();
    await loadHabits();
    await loadMessages();
    sendReminders();
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
  if (!S.isTrainer && S.clients.every(c => !c.active)) { S.screen = "paused"; S.checkins = []; render(); return; }
  const saved = store.get("fa_client");
  S.sel = S.clients.find(c => c.id === S.sel) ? S.sel : S.clients.find(c => c.id === saved) ? saved : (S.clients[0]?.id || null);
  S.screen = "app";
  if (S.isTrainer) toApp({ type: "ready", role: "trainer" });
  else { const zr = zone2Range(S.clients.find(c => c.id === S.sel) || S.clients[0]); toApp({ type: "ready", role: "client", ...(zr ? { zone2: zr } : {}) }); }
  if (S.isTrainer) { try { S.templates = await api.listTemplates(); } catch (err) { S.templates = []; if (!isMissing(err)) console.error(err); } }
  if (S.isTrainer && S.clients.length && !S.skipOverview) { S.skipOverview = true; await loadOverview(); return; }
  await loadCheckins();
}

/* ---------- client dialog (trainer) ---------- */
let editing = null;
function openClient(c) {
  editing = c;
  $("#cTitle").textContent = c ? "Edit client" : "New client";
  $("#c-name").value = c?.name || ""; $("#c-email").value = c?.email || ""; $("#c-sex").value = c?.sex || "female"; $("#c-dob").value = c?.dob || "";
  $("#c-ft").value = c?.height ? Math.floor(c.height / 12) : ""; $("#c-in").value = c?.height ? Math.round((c.height % 12) * 2) / 2 : "";
  $("#c-goal").value = c?.goal || ""; $("#c-glp1").checked = !!c?.glp1; $("#c-water").value = c?.waterGoal ?? ""; $("#c-kcal").value = c?.kcalGoal ?? ""; $("#c-prot").value = c?.proteinGoal ?? ""; $("#c-carb").value = c?.carbsGoal ?? ""; $("#c-fat").value = c?.fatGoal ?? ""; $("#cErr").textContent = "";
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
  const wg = num($("#c-water").value);
  if (wg != null && (wg < 16 || wg > 256)) { err.textContent = "Water goal should be between 16 and 256 oz, or leave it empty."; return; }
  const mg = id => { const v = num($(id).value); return v == null ? null : Math.round(v); };
  const kg = mg("#c-kcal"), pg = mg("#c-prot"), cg = mg("#c-carb"), fg = mg("#c-fat");
  if ((kg != null && (kg < 800 || kg > 8000)) || (pg != null && (pg < 20 || pg > 600)) || (cg != null && (cg < 0 || cg > 1000)) || (fg != null && (fg < 10 || fg > 400))) { err.textContent = "Check the nutrition targets: calories 800–8000, protein 20–600 g, carbs 0–1000 g, fat 10–400 g."; return; }
  const d = { name, email, sex: $("#c-sex").value, dob: $("#c-dob").value || null, height: ft * 12 + inch, goal: $("#c-goal").value.trim() || null, glp1: $("#c-glp1").checked, waterGoal: wg != null ? Math.round(wg) : null, kcalGoal: kg, proteinGoal: pg, carbsGoal: cg, fatGoal: fg };
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
  return `<section class="card fa"><div><div class="kicker">Fuel your progress</div><h2>Fast Aminos Wellness</h2><p class="small muted">Supplements, telehealth and free tools from ${esc(TRAINER)}'s wellness site.</p></div>
    <div class="fa-links"><a class="btn primary" href="https://fastaminoswellness.com/" target="_blank" rel="noopener">Shop supplements</a><a class="btn" href="../workouts/" target="_blank" rel="noopener">Workout library</a><a class="btn" href="../zone2/" target="_blank" rel="noopener">Zone 2 calculator</a></div></section>`;
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
  if (!has) return `<section class="card"><div class="card-h"><h2>Apple Health</h2></div><div class="empty">Connect Apple Health and your steps, sleep and weight fill in automatically. You choose exactly what to share. <button class="btn primary sm" id="connectHealth" type="button">Connect Apple Health</button>
    <p class="small muted" style="margin:10px 0 0"><b>Wear a Garmin, Fitbit, Oura or WHOOP?</b> Turn on Apple Health sharing in that watch's app first (Garmin Connect: <i>More → Settings → Connected Apps → Apple Health</i>). RENOVO picks it up from there.</p></div></section>`;
  const t = todayISO(), wk = S.health.filter(h => days(h.date, t) >= 0 && days(h.date, t) < 7);
  const wts = S.health.filter(h => h.weight != null);
  const wNow = wts[0], wOld = wts.find(h => days(h.date, wNow?.date || t) >= 7);
  const synced = S.health.reduce((m, h) => String(h.updatedAt) > m ? String(h.updatedAt) : m, "");
  const ago = synced ? Math.max(0, Math.round((Date.now() - new Date(synced).getTime()) / 36e5)) : null;
  const big = (lbl, v, unit, sub) => `<div class="tile"><span class="lbl">${lbl}</span><span class="big">${v ?? "–"}<small>${v != null ? unit : ""}</small></span><span class="delta">${sub || ""}</span></div>`;
  const small = (lbl, v) => v == null ? "" : `<span><b>${v}</b> ${lbl}</span>`;
  const syncTxt = ago != null ? ` · synced ${ago < 1 ? "just now" : ago < 24 ? ago + " h ago" : Math.round(ago / 24) + " days ago"}` : "";
  return `<section class="card hk"><div class="card-h"><div><div class="kicker">Apple Health<span class="hk-when">${syncTxt}</span></div><h2>Last 7 days</h2></div>
    ${canConnect ? `<button class="btn sm" id="syncHealth" type="button">Sync</button>` : ""}</div>
    <div class="tiles">${big("Avg steps", last7("steps") != null ? Math.round(last7("steps")).toLocaleString("en-US") : null, "/day", "")}${big("Avg sleep", last7("sleepH") != null ? f1(last7("sleepH")) : null, "h", "")}
      ${big("Weight", wNow ? f1(wNow.weight) : null, "lb", wNow && wOld ? `${sgn(wNow.weight - wOld.weight)} lb vs a week earlier` : wNow ? fmtD(wNow.date) : "")}</div>
    <div class="hk-more">${small("active cal/day", last7("kcal") != null ? Math.round(last7("kcal")) : null)}${small("exercise min/day", last7("exMin") != null ? Math.round(last7("exMin")) : null)}${small("resting HR", last7("rhr") != null ? Math.round(last7("rhr")) + " bpm" : null)}<span class="muted">${wk.length} of 7 days synced</span></div>${S.health.some(h => h.zone2 != null) ? (() => { const z = zone2Week(), zr = zone2Range(c); return `<div class="z2"><div class="z2-top"><b>❤️ Zone 2 this week</b><span><b>${z}</b> / 150 min${zr ? ` · ${zr[0]}–${zr[1]} bpm` : ""}</span></div><span class="sc-bar"><span style="width:${Math.min(100, Math.round(z / 150 * 100))}%"></span></span></div>`; })() : ""}</section>`;
}

/* ---------- water ---------- */
async function loadWater() {
  S.water = [];
  try { S.water = await api.listWater(S.sel); S.waterMissing = false; }
  catch (err) { if (isMissing(err)) S.waterMissing = true; else console.error(err); }
}
/* The trainer's goal if set; otherwise half the latest body weight in ounces, rounded to a full glass (64–128 oz). */
function waterGoal(c) {
  if (c.waterGoal) return c.waterGoal;
  const w = [...S.checkins].reverse().find(e => e.weight)?.weight ?? S.health.find(h => h.weight != null)?.weight;
  if (!w) return 64;
  return Math.min(128, Math.max(64, Math.round(w / 2 / 8) * 8));
}
const waterOn = date => S.water.find(w => w.date === date)?.oz || 0;
const DROP = `<svg viewBox="0 0 16 20" aria-hidden="true"><path d="M8 1.5C8 1.5 2 8.6 2 12.6A6 6 0 0 0 14 12.6C14 8.6 8 1.5 8 1.5Z"/></svg>`;
function waterCard(c) {
  if (S.waterMissing) return "";
  const t = todayISO(), goal = waterGoal(c), oz = waterOn(t), pct = Math.min(100, Math.round(oz / goal * 100));
  const wk = Array.from({ length: 7 }, (_, i) => { const d = toDate(t); d.setDate(d.getDate() - i); return waterOn(d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())); });
  const past = wk.slice(1), logged = past.filter(v => v > 0);
  if (S.isTrainer && !S.water.length) return "";
  const glasses = Math.min(16, Math.round(goal / 8)), full = Math.min(glasses, Math.floor(oz / 8));
  const drops = Array.from({ length: glasses }, (_, i) => `<span class="drop${i < full ? " on" : ""}">${DROP}</span>`).join("");
  const done = oz >= goal;
  const stats = logged.length ? `<span><b>${Math.round(avg(logged))} oz</b> avg last week</span><span><b>${past.filter(v => v >= goal).length} of 6</b> days at goal</span>` : `<span class="muted">Each tap is one 8 oz glass.</span>`;
  return `<section class="card water" id="waterCard"><div class="card-h"><div><div class="kicker">${S.isTrainer ? "Water today" : "Today"}</div><h2>${S.isTrainer ? `${esc(firstName(c.name))}'s water` : "Water"}</h2></div>
    ${done ? `<span class="pill good">${ICON_OK}Goal hit</span>` : ""}</div>
    <div class="w-num"><span class="big">${oz}<small> / ${goal} oz</small></span><span class="muted small">${done ? "Nice work. Keep sipping." : `${goal - oz} oz to go`}</span></div>
    <div class="w-bar" role="progressbar" aria-label="Water today" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${oz}"><span style="width:${pct}%"></span></div>
    <div class="drops" aria-hidden="true">${drops}</div>
    ${S.isTrainer ? "" : `<div class="w-btns"><button class="btn sm" type="button" data-water="-8" ${oz ? "" : "disabled"} aria-label="Remove 8 ounces">−8</button><button class="btn primary" type="button" data-water="8">+ 8 oz</button><button class="btn" type="button" data-water="16">+ 16 oz</button></div>`}
    <div class="hk-more">${stats}</div></section>`;
}
let waterSave = Promise.resolve();
function wireWater(c) {
  $$("[data-water]").forEach(b => b.onclick = () => {
    const t = todayISO(), goal = waterGoal(c), before = waterOn(t);
    const oz = Math.max(0, Math.min(640, before + Number(b.dataset.water)));
    const row = S.water.find(w => w.date === t);
    if (row) row.oz = oz; else S.water.unshift({ date: t, oz });
    const card = $("#waterCard"); if (card) { card.outerHTML = waterCard(c); wireWater(c); }
    if (before < goal && oz >= goal) toast("Water goal hit! 💧");
    waterSave = waterSave.then(() => api.setWater(c.id, t, oz)).catch(err => { console.error(err); toast("Couldn't save your water. Check your connection."); });
  });
}

/* ---------- fuel: food from MyFitnessPal (via Apple Health) vs. the coach's targets ---------- */
const MACRO_COLORS = { kcal: "var(--blue)", protein: "#1683ff", carbs: "#38c4f0", fat: "#f5a524" };
function arc(pct, size, color, inner) {
  const r = 42, C = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct)), off = C * (1 - p / 100);
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true"><circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--grid)" stroke-width="10"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 50 50)" style="transition:stroke-dashoffset .6s ease"/>${inner || ""}</svg>`;
}
function fuelCard(c) {
  if (S.healthMissing) return "";
  const t = todayISO(), today = S.health.find(h => h.date === t) || {};
  const everFood = S.health.some(h => h.kcalIn != null || h.protein != null);
  const hasGoals = c.kcalGoal || c.proteinGoal || c.carbsGoal || c.fatGoal;
  if (S.isTrainer && !everFood) return "";
  if (!everFood) {
    if (!IN_APP) return "";
    return `<section class="card fuel"><div class="card-h"><div><div class="kicker">Nutrition</div><h2>Fuel</h2></div></div>
      <div class="empty">Log your food in <b>MyFitnessPal</b> and your calories, protein, carbs and fat show up here as rings.<br><span class="small">One-time setup in MyFitnessPal: <i>More → Settings → Sharing &amp; Privacy → HealthKit Sharing</i> → turn on nutrition. Then come back here and tap <b>Sync</b> on the Apple Health card.</span></div></section>`;
  }
  const eaten = today.kcalIn || 0, active = today.kcal || 0;
  const macro = (k, label, val, goal) => {
    const v = Math.round(val || 0), pct = goal ? Math.round(v / goal * 100) : null;
    const inner = `<text x="50" y="${goal ? 49 : 56}" text-anchor="middle" font-size="${goal ? 21 : 22}" font-weight="800" fill="var(--ink)">${goal ? pct + "%" : v + "g"}</text>${goal ? `<text x="50" y="66" text-anchor="middle" font-size="11" fill="var(--muted)">${v}/${goal}g</text>` : ""}`;
    return `<div class="mring${pct != null && pct > 110 ? " over" : ""}">${arc(pct ?? 0, 84, MACRO_COLORS[k], inner)}<span class="mlbl"><i style="background:${MACRO_COLORS[k]}"></i>${label}</span></div>`;
  };
  let top;
  if (c.kcalGoal) {
    const budget = c.kcalGoal + active, left = budget - eaten, pct = Math.round(eaten / budget * 100);
    const inner = `<text x="50" y="50" text-anchor="middle" font-size="22" font-weight="850" fill="var(--ink)">${Math.abs(left).toLocaleString("en-US")}</text><text x="50" y="65" text-anchor="middle" font-size="11" fill="var(--muted)">${left >= 0 ? "cal left" : "cal over"}</text>`;
    top = `<div class="fuel-top">${arc(pct, 112, left >= 0 ? MACRO_COLORS.kcal : "#f5a524", inner)}
      <ul class="fuel-math"><li><span>Goal</span><b>${c.kcalGoal.toLocaleString("en-US")}</b></li><li><span>Food</span><b>− ${eaten.toLocaleString("en-US")}</b></li><li><span>Activity</span><b>+ ${active.toLocaleString("en-US")}</b></li><li class="eq"><span>${left >= 0 ? "Left" : "Over"}</span><b>${Math.abs(left).toLocaleString("en-US")}</b></li></ul></div>`;
  } else {
    top = `<div class="fuel-top"><div><span class="big">${eaten.toLocaleString("en-US")}<small> cal eaten</small></span><p class="small muted" style="margin:4px 0 0">${S.isTrainer ? "Set calorie and macro targets in <b>Edit client</b> to turn these into progress rings." : `${esc(TRAINER)} will set your daily targets. Until then you'll see what you've logged.`}</p></div></div>`;
  }
  return `<section class="card fuel"><div class="card-h"><div><div class="kicker">Today · from MyFitnessPal</div><h2>Fuel</h2></div>${eaten === 0 && !today.protein ? `<span class="muted small">Nothing logged yet today</span>` : ""}</div>
    ${top}<div class="fuel-macros">${macro("protein", "Protein", today.protein, c.proteinGoal)}${macro("carbs", "Carbs", today.carbs, c.carbsGoal)}${macro("fat", "Fat", today.fat, c.fatGoal)}</div></section>`;
}

/* ---------- Zone 2 (same formula as the site's Zone 2 calculator) ---------- */
/* 60–70% of max heart rate; max = 220 − age (men) or 206 − 0.88 × age (women, Gulati et al. 2010). */
function zone2Range(c) {
  if (!c || !c.dob) return null;
  const age = ageAt(c.dob, todayISO()); if (age == null || age < 13 || age > 100) return null;
  const max = c.sex === "female" ? 206 - 0.88 * age : 220 - age;
  return [Math.round(max * 0.6), Math.round(max * 0.7)];
}
function zone2Week() { const wk = daysBack(7); return S.health.filter(h => wk.includes(h.date)).reduce((a, h) => a + (h.zone2 || 0), 0); }

/* ---------- push token from the app ---------- */
window.faAppPush = async data => {
  if (!data || !data.token || !api || !api.claimToken || DEMO) return;
  try { await api.claimToken(String(data.token), data.env === "sandbox" ? "sandbox" : "production"); } catch (e) { if (!isMissing(e)) console.error(e); }
};

/* ---------- workout reminders (scheduled by the iPhone app) ---------- */
const remKey = () => `rv_rem_${S.sel || ""}`;
function remSettings() { try { return JSON.parse(store.get(remKey()) || "null") || { on: false, time: "07:00" }; } catch (_) { return { on: false, time: "07:00" }; } }
/* Tell the app which weekdays have a workout, so it can remind the client that morning. */
function sendReminders() {
  if (!IN_APP || S.isTrainer || !S.plan) return;
  const r = remSettings(), [hh, mm] = String(r.time || "07:00").split(":").map(Number), days = [];
  S.plan.days.forEach(d => { if (isRestDay(d)) return; const m = String(d.name || "").trim().toLowerCase().match(/^(sun|mon|tue|wed|thu|fri|sat)/); if (!m) return;
    days.push({ weekday: WEEKDAYS.indexOf(m[1]) + 1, title: `Today: ${shortDay(d.name)} 💪`, body: `${(d.items || []).filter(x => !/zone 2/i.test(x.name)).length} exercises · 45 min of lifting + 30 min Zone 2. Let's go!` }); });
  toApp({ type: "reminders", enabled: !!r.on && days.length > 0, hour: hh || 0, minute: mm || 0, days });
}
function openReminders() {
  let d = $("#dlgRem"); if (!d) { d = document.createElement("dialog"); d.id = "dlgRem"; document.body.appendChild(d); }
  const r = remSettings(), scheduled = !!S.plan && S.plan.days.some(x => /^(sun|mon|tue|wed|thu|fri|sat)/i.test(String(x.name || "").trim()));
  d.innerHTML = `<form method="dialog" novalidate><h3>⏰ Workout reminders</h3>
    ${IN_APP ? (scheduled ? `<p class="small muted">A notification on each training day in your plan, at the time you pick.</p>
      <label class="chk"><input type="checkbox" id="remOn"${r.on ? " checked" : ""}> Remind me on workout days</label>
      <div class="field" style="max-width:180px"><label for="remTime">Time</label><input id="remTime" type="time" value="${esc(r.time || "07:00")}"></div>`
      : `<p class="small muted">Your plan's days don't have weekdays yet (like "Mon · Upper"). Ask ${esc(TRAINER)} to add them, then reminders can follow your schedule.</p>`)
      : `<p class="small muted">Reminders work in the RENOVO iPhone app.</p>`}
    <div class="foot"><span></span><div class="r"><button type="button" class="btn" id="remCancel">Close</button>${IN_APP && scheduled ? `<button type="submit" class="btn primary">Save</button>` : ""}</div></div></form>`;
  $("#remCancel").onclick = () => d.close();
  d.querySelector("form").onsubmit = ev => { ev.preventDefault(); const on = $("#remOn")?.checked, time = $("#remTime")?.value || "07:00"; store.set(remKey(), JSON.stringify({ on: !!on, time })); sendReminders(); d.close(); toast(on ? `Reminders on: ${time} on workout days` : "Reminders off"); render(); };
  d.showModal();
}

/* ---------- today's workout + missed workouts ---------- */
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/* A plan is "scheduled" when its day names start with weekdays (Mon · Upper A). Returns the day index for a date, -1 for an unscheduled weekday (rest), or null when the plan has no schedule. */
function planDayFor(p, iso) {
  if (!p || !p.days.length) return null;
  const wd = d => { const m = String(d.name || "").trim().toLowerCase().match(/^(sun|mon|tue|wed|thu|fri|sat)/); return m ? m[1] : null; };
  if (!p.days.some(wd)) return null;
  const want = WEEKDAYS[toDate(iso).getDay()], i = p.days.findIndex(d => wd(d) === want);
  return i;
}
const planStart = p => (p.program && p.program.start) || String(p.updatedAt || "").slice(0, 10) || todayISO();
/* Scheduled training days in the last `n` days (not today) with no workout logged that day. */
function missedDays(p, workouts, n) {
  const out = [], logged = new Set(workouts.map(w => w.date)), start = planStart(p);
  daysBack(n + 1).slice(1).forEach(d => { if (d < start) return; const i = planDayFor(p, d); if (i == null || i < 0 || isRestDay(p.days[i])) return; if (!logged.has(d)) out.push({ date: d, i, name: p.days[i].name }); });
  return out;
}
const shortDay = n => String(n || "").replace(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s*·\s*/i, "").replace(/\s*\(.*?\)\s*/g, " ").trim() || String(n || "");
function todayWorkoutCard(c) {
  const p = S.plan; if (!p || !p.days.length || S.workoutsMissing) return "";
  const t = todayISO(), idx = planDayFor(p, t), doneToday = S.workouts.filter(w => w.date === t);
  const missed = missedDays(p, S.workouts, 3)[0];
  const who = S.isTrainer ? firstName(c.name) : "";
  let body;
  if (doneToday.length) body = `<div class="tw-main"><span class="tw-ic">✅</span><div><b>${S.isTrainer ? `${esc(who)} trained today` : "Workout done. Great job!"}</b><span class="muted small">${esc(shortDay(doneToday[0].dayName))} · ${doneToday[0].entries.length} exercises</span></div></div>`;
  else if (idx === -1 || (idx != null && isRestDay(p.days[idx]))) body = `<div class="tw-main"><span class="tw-ic">🛌</span><div><b>Rest day</b><span class="muted small">Walk, stretch, hit your protein and sleep 7–9 hours.</span></div></div>`;
  else {
    let i = idx;
    if (i == null) { const last = S.workouts[0], li = last ? p.days.findIndex(d => d.name === last.dayName) : -1; i = p.days.findIndex((d, k) => k > li && !isRestDay(d)); if (i < 0) i = p.days.findIndex(d => !isRestDay(d)); }
    const d = p.days[i], n = (d.items || []).length;
    body = `<div class="tw-main"><span class="tw-ic">🏋️</span><div><b>${idx == null ? "Next up" : "Today"}: ${esc(shortDay(d.name))}</b><span class="muted small">${n} exercises${S.plan.program && progWeek(S.plan.program) >= 1 && progWeek(S.plan.program) <= S.plan.program.weeks ? ` · Week ${progWeek(S.plan.program)} of ${S.plan.program.weeks}` : ""}</span></div>
      ${S.workoutsMissing ? "" : `<button type="button" class="btn primary" data-start="${i}">${S.isTrainer ? "Log it" : "Start"}</button>`}</div>`;
  }
  const miss = missed && !doneToday.length ? `<div class="tw-miss">❌ Missed ${toDate(missed.date).toLocaleDateString("en-US", { weekday: "short" })}: ${esc(shortDay(missed.name))}${S.isTrainer ? "" : `. No stress. <button type="button" class="linkbtn" data-start="${missed.i}">Make it up today</button>`}</div>` : "";
  const rem = !S.isTrainer && IN_APP ? `<button type="button" class="linkbtn tw-rem" id="openRem">⏰ ${remSettings().on ? `Reminder ${esc(remSettings().time)}` : "Set a workout reminder"}</button>` : "";
  return `<section class="card tw">${body}${miss}${rem}</section>`;
}

/* ---------- habits ---------- */
const HABITS = {
  workout: { icon: "🏋️", label: "Do my workout", auto: true },
  steps8k: { icon: "👟", label: "8,000+ steps", auto: true },
  steps10k: { icon: "👟", label: "10,000+ steps", auto: true },
  sleep7: { icon: "🌙", label: "Sleep 7+ hours", auto: true },
  zone2: { icon: "❤️", label: "30 min Zone 2", auto: true },
  water: { icon: "💧", label: "Hit my water goal", auto: true },
  protein: { icon: "🥩", label: "Hit my protein goal", auto: true },
  veg: { icon: "🥦", label: "Vegetables with every meal" },
  noalcohol: { icon: "🚫", label: "No alcohol" },
  stretch: { icon: "🧘", label: "Stretch or mobility 10 min" },
  vitamins: { icon: "💊", label: "Vitamins / supplements" },
  creatine: { icon: "⚡", label: "Creatine 5 g" },
  sunlight: { icon: "☀️", label: "Morning sunlight 10 min" },
  nophone: { icon: "📵", label: "No phone in bed" },
  mealprep: { icon: "🍱", label: "Meal prep / plan my meals" },
  breathe: { icon: "🌬️", label: "5 min breathing or meditation" },
  journal: { icon: "✍️", label: "Gratitude journal" }
};
/* The client's habits as objects: catalog ids plus custom { id, label }. */
function habitsOf(c) {
  return (Array.isArray(c.habits) ? c.habits : []).map(h => typeof h === "string" ? (HABITS[h] ? { id: h, ...HABITS[h] } : null) : (h && h.id && h.label ? { id: String(h.id), label: String(h.label), icon: "⭐" } : null)).filter(Boolean);
}
/* true / false for a day, or null when it doesn't apply (rest day, no data yet). */
function habitDone(c, h, iso) {
  if (!h.auto) return S.habitLogs.some(l => l.date === iso && l.habitId === h.id);
  const hd = S.health.find(x => x.date === iso) || {};
  switch (h.id) {
    case "workout": { if (S.workouts.some(w => w.date === iso)) return true; const p = S.plan, i = p ? planDayFor(p, iso) : null; return i === -1 || (i != null && i >= 0 && isRestDay(p.days[i])) ? null : false; }
    case "steps8k": return hd.steps == null ? false : hd.steps >= 8000;
    case "steps10k": return hd.steps == null ? false : hd.steps >= 10000;
    case "sleep7": return hd.sleepH == null ? false : hd.sleepH >= 7;
    case "zone2": return (hd.zone2 || 0) >= 30;
    case "water": return waterOn(iso) >= waterGoal(c);
    case "protein": return !c.proteinGoal || hd.protein == null ? false : hd.protein >= c.proteinGoal * 0.95;
  }
  return false;
}
function habitProgress(c, h) {
  const hd = S.health.find(x => x.date === todayISO()) || {};
  if (h.id === "steps8k" || h.id === "steps10k") return hd.steps != null ? `${hd.steps.toLocaleString("en-US")} / ${h.id === "steps8k" ? "8,000" : "10,000"}` : "From Apple Health";
  if (h.id === "zone2") return `${hd.zone2 || 0} / 30 min (from your watch)`;
  if (h.id === "sleep7") return hd.sleepH != null ? `${f1(hd.sleepH)} h last night` : "From Apple Health";
  if (h.id === "water") return `${waterOn(todayISO())} / ${waterGoal(c)} oz`;
  if (h.id === "protein") return c.proteinGoal ? `${Math.round(hd.protein || 0)} / ${c.proteinGoal} g` : "Needs a protein target";
  if (h.id === "workout") return habitDone(c, h, todayISO()) === null ? "Rest day" : "";
  return "";
}
function habitStreak(c, h) { let n = 0; for (const d of daysBack(120)) { const v = habitDone(c, h, d); if (v === null) continue; if (v) n++; else if (d !== todayISO()) break; } return n; }
function habitWeek(c) {
  const hs = habitsOf(c); let done = 0, total = 0;
  hs.forEach(h => daysBack(7).forEach(d => { const v = habitDone(c, h, d); if (v === null) return; total++; if (v) done++; }));
  return total ? done / total : null;
}
async function loadHabits() {
  S.habitLogs = [];
  try { S.habitLogs = await api.listHabitLogs(S.sel); S.habitsMissing = false; }
  catch (err) { if (isMissing(err)) S.habitsMissing = true; else console.error(err); }
}
function habitsCard(c) {
  if (S.habitsMissing) return "";
  const hs = habitsOf(c), t = todayISO();
  if (!hs.length) return S.isTrainer ? `<section class="card habits"><div class="card-h"><div><div class="kicker">Habits</div><h2>No habits yet</h2></div><button class="btn sm" type="button" id="editHabits">Pick habits</button></div><p class="small muted">Pick 3–5 daily habits for ${esc(firstName(c.name))}. Steps, sleep, water, protein and workouts check themselves off.</p></section>`
    : `<section class="card habits"><div class="card-h"><div><div class="kicker">Habits</div><h2>Build your habits</h2></div><button class="btn sm" type="button" id="editHabits">Pick habits</button></div><p class="small muted">Pick a few daily habits to track. Small wins every day add up.</p></section>`;
  const wk = habitWeek(c), rows = hs.map(h => {
    const v = habitDone(c, h, t), st = habitStreak(c, h), prog = habitProgress(c, h);
    const dots = daysBack(7).reverse().map(d => { const x = habitDone(c, h, d); return `<i class="${x === null ? "na" : x ? "on" : ""}"></i>`; }).join("");
    const btn = h.auto ? `<span class="hk${v ? " on" : v === null ? " na" : ""}" aria-label="${v ? "Done" : "Not yet"}">${v ? "✓" : ""}</span>`
      : `<button type="button" class="hk${v ? " on" : ""}" data-habit="${esc(h.id)}" aria-pressed="${!!v}" aria-label="${esc(h.label)}"${S.isTrainer ? " disabled" : ""}>${v ? "✓" : ""}</button>`;
    return `<li><span class="hicon">${h.icon}</span><div class="htxt"><b>${esc(h.label)}</b><span>${prog ? esc(prog) + " · " : ""}${h.auto ? "auto" : "tap to check"}${st >= 2 ? ` · 🔥 ${st} days` : ""}</span><span class="hdots" aria-hidden="true">${dots}</span></div>${btn}</li>`;
  }).join("");
  return `<section class="card habits"><div class="card-h"><div><div class="kicker">Habits${wk != null ? ` · ${Math.round(wk * 100)}% this week` : ""}</div><h2>Today's habits</h2></div><button class="btn sm ghost" type="button" id="editHabits">Edit</button></div><ul class="hlist">${rows}</ul></section>`;
}
/* Pick habits: the trainer for any client, a client for themselves. */
function openHabits(c) {
  let d = $("#dlgHabits");
  if (!d) { d = document.createElement("dialog"); d.id = "dlgHabits"; document.body.appendChild(d); }
  const cur = new Set((Array.isArray(c.habits) ? c.habits : []).map(h => typeof h === "string" ? h : null).filter(Boolean));
  const custom = (Array.isArray(c.habits) ? c.habits : []).filter(h => h && typeof h === "object").map(h => h.label).join(", ");
  d.innerHTML = `<form method="dialog" novalidate><h3>${S.isTrainer ? `Habits for ${esc(firstName(c.name))}` : "Your habits"}</h3><p class="small muted">Pick 3–5. Ones marked <b>auto</b> check themselves off from Apple Health, water, food and workouts.</p>
    <div class="hpick">${Object.entries(HABITS).map(([id, h]) => `<label><input type="checkbox" value="${id}"${cur.has(id) ? " checked" : ""}> ${h.icon} ${esc(h.label)}${h.auto ? ` <em>auto</em>` : ""}</label>`).join("")}</div>
    <div class="field"><label for="hCustom">Your own habits (optional, separate with commas)</label><input id="hCustom" type="text" maxlength="200" value="${esc(custom)}" placeholder="e.g. Read 10 pages, Walk the dog"></div>
    <div class="err" id="hErr"></div><div class="foot"><span></span><div class="r"><button type="button" class="btn" id="hCancel">Cancel</button><button type="submit" class="btn primary" id="hSave">Save habits</button></div></div></form>`;
  $("#hCancel").onclick = () => d.close();
  d.querySelector("form").onsubmit = async ev => {
    ev.preventDefault();
    const ids = $$("#dlgHabits .hpick input:checked").map(x => x.value);
    const cust = $("#hCustom").value.split(",").map(x => x.trim()).filter(Boolean).slice(0, 5).map(l => ({ id: "c-" + l.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30), label: l.slice(0, 60) }));
    const habits = [...ids, ...cust];
    if (habits.length > 10) { $("#hErr").textContent = "Pick 10 or fewer. 3–5 works best."; return; }
    const b = $("#hSave"); b.disabled = true;
    try { await api.setHabits(c.id, habits); c.habits = habits; d.close(); toast("Habits saved"); render(); }
    catch (e) { console.error(e); $("#hErr").textContent = isMissing(e) ? "Run the latest database update (supabase/schema.sql) first." : "Couldn't save. Try again."; }
    b.disabled = false;
  };
  d.showModal();
}
async function toggleHabit(c, id) {
  const t = todayISO(), on = !S.habitLogs.some(l => l.date === t && l.habitId === id);
  if (on) S.habitLogs.push({ date: t, habitId: id }); else S.habitLogs = S.habitLogs.filter(l => !(l.date === t && l.habitId === id));
  const card = document.querySelector(".habits"); if (card) { card.outerHTML = habitsCard(c); wireHabits(c); }
  try { await api.toggleHabit(c.id, t, id, on); if (on) { const h = habitsOf(c).find(x => x.id === id), st = h ? habitStreak(c, h) : 0; if (st >= 3) toast(`🔥 ${st}-day streak: ${h.label}`); } }
  catch (e) { console.error(e); toast("Couldn't save that. Check your connection."); }
}
function wireHabits(c) {
  $$("[data-habit]").forEach(b => b.onclick = () => toggleHabit(c, b.dataset.habit));
  const eh = $("#editHabits"); if (eh) eh.onclick = () => openHabits(c);
}

/* ---------- messages ---------- */
async function loadMessages() {
  S.msgs = [];
  try { S.msgs = await api.listMessages(S.sel); S.msgsMissing = false; }
  catch (err) { if (isMissing(err)) S.msgsMissing = true; else console.error(err); }
}
const unreadFor = msgs => msgs.filter(m => !m.readAt && m.fromCoach === !S.isTrainer).length;
function msgButton(c) {
  if (S.msgsMissing) return "";
  const n = unreadFor(S.msgs);
  return `<button class="btn msgbtn" id="openMsgs" type="button">💬 ${S.isTrainer ? "Message" : `Message ${esc(TRAINER)}`}${n ? `<span class="badge-n">${n}</span>` : ""}</button>`;
}
function msgBanner(c) {
  if (S.msgsMissing) return "";
  const n = unreadFor(S.msgs); if (!n) return "";
  const last = [...S.msgs].reverse().find(m => !m.readAt && m.fromCoach === !S.isTrainer);
  return `<button type="button" class="msgbanner" id="openMsgs2"><span>💬</span><span><b>${n} new message${n > 1 ? "s" : ""} from ${S.isTrainer ? esc(firstName(c.name)) : esc(TRAINER)}</b><em>${esc(String(last.body).slice(0, 90))}${last.body.length > 90 ? "…" : ""}</em></span></button>`;
}
let msgPoll = null;
function drawMsgs() {
  const box = $("#msgList"); if (!box) return;
  const me = S.isTrainer;
  box.innerHTML = S.msgs.length ? S.msgs.map((m, i) => { const mine = m.fromCoach === me, day = String(m.createdAt).slice(0, 10), prev = i ? String(S.msgs[i - 1].createdAt).slice(0, 10) : "";
    return `${day !== prev ? `<div class="mday">${fmtD(day, day.slice(0, 4) !== todayISO().slice(0, 4))}</div>` : ""}<div class="bub${mine ? " me" : ""}"><p>${esc(m.body)}</p><span>${new Date(m.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}${mine && m.readAt ? " · Seen" : ""}</span></div>`; }).join("")
    : `<p class="small muted" style="text-align:center;margin:30px 0">${me ? "Send a message. It shows up in their app." : `Questions about your plan, form or food? Message ${esc(TRAINER)} here.`}</p>`;
  box.scrollTop = box.scrollHeight;
}
async function refreshMsgs(c) {
  try { const before = S.msgs.length; S.msgs = await api.listMessages(c.id); if (unreadFor(S.msgs)) { await api.markRead(c.id, S.isTrainer); S.msgs.forEach(m => { if (!m.readAt && m.fromCoach === !S.isTrainer) m.readAt = new Date().toISOString(); }); } if (S.msgs.length !== before) drawMsgs(); } catch (e) { console.error(e); }
}
function openMessages(c) {
  let d = $("#dlgMsg");
  if (!d) { d = document.createElement("dialog"); d.id = "dlgMsg"; d.className = "wide"; document.body.appendChild(d); }
  d.innerHTML = `<form method="dialog" novalidate class="msgform"><div class="msghead"><h3>${S.isTrainer ? `💬 ${esc(c.name)}` : `💬 ${esc(TRAINER)}`}</h3><button type="button" class="btn ghost sm" id="msgClose">Close</button></div>
    <div id="msgList" class="msglist"></div>
    <div class="msgsend"><textarea id="msgText" rows="2" maxlength="2000" placeholder="Write a message…"></textarea><button type="submit" class="btn primary" id="msgGo">Send</button></div></form>`;
  $("#msgClose").onclick = () => d.close();
  d.querySelector("form").onsubmit = async ev => {
    ev.preventDefault(); const t = $("#msgText").value.trim(); if (!t) return;
    const b = $("#msgGo"); b.disabled = true;
    try { const m = await api.sendMessage(c.id, t); S.msgs.push(m); $("#msgText").value = ""; drawMsgs(); }
    catch (e) { console.error(e); toast(isMissing(e) ? "Messages need the latest database update (supabase/schema.sql)." : "Couldn't send. Check your connection."); }
    b.disabled = false; $("#msgText").focus();
  };
  d.addEventListener("close", () => { clearInterval(msgPoll); msgPoll = null; render(); }, { once: true });
  drawMsgs(); d.showModal(); refreshMsgs(c);
  clearInterval(msgPoll); msgPoll = setInterval(() => refreshMsgs(c), 8000);
}

/* ---------- daily Recovery / Sleep / Strain (personal baselines, like Bevel or WHOOP) ---------- */
const lerp = (x, pts) => { if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return pts[pts.length - 1][1]; };
const sd = a => { const m = avg(a); return a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)) : 0; };
function dailyScores(health) {
  const t = todayISO(), by = {}; health.forEach(h => { by[h.date] = h; });
  const today = by[t] || {};
  const prior = daysBack(31).slice(1).map(d => by[d]).filter(Boolean);
  const base = k => { const v = prior.map(h => h[k]).filter(x => x != null); return v.length >= 5 ? avg(v) : null; };
  // Sleep: last night's hours vs an 8-hour need, plus how steady the last 7 nights were.
  let sleep = null;
  if (today.sleepH != null) {
    const wk = daysBack(7).map(d => by[d]?.sleepH).filter(x => x != null);
    const steady = wk.length >= 3 ? Math.max(0, 1 - sd(wk) / 1.5) : 0.7;
    sleep = { score: Math.round(Math.min(1, today.sleepH / 8) * 85 + steady * 15), hours: today.sleepH };
  }
  // Recovery: HRV vs your 30-day normal (half), resting heart rate vs normal (quarter), sleep (quarter).
  const hb = base("hrv"), rb = base("rhr"), parts = [];
  let hrvPct = null;
  if (today.hrv != null && hb) { hrvPct = (today.hrv / hb - 1) * 100; parts.push([50, lerp(today.hrv / hb, [[0.7, 0], [1, 60], [1.2, 100]])]); }
  if (today.rhr != null && rb) parts.push([25, lerp(rb - today.rhr, [[-8, 0], [0, 60], [5, 100]])]);
  if (sleep && parts.length) parts.push([25, sleep.score]);
  const tw = parts.reduce((a, p) => a + p[0], 0);
  const recovery = tw ? Math.round(parts.reduce((a, p) => a + p[0] * p[1], 0) / tw) : null;
  // Strain (0–21): today's load (active calories + exercise minutes) on a curve set by your usual day.
  const load = h => h && (h.kcal != null || h.exMin != null) ? (h.kcal || 0) + 4 * (h.exMin || 0) : null;
  const loads = prior.map(load).filter(x => x != null);
  const k = loads.length >= 5 ? avg(loads) * 1.2 : 700;
  const tl = load(today);
  const strain = tl == null ? null : Math.round(21 * (1 - Math.exp(-tl / k)) * 10) / 10;
  return { recovery, sleep, strain, hrvPct, hrv: today.hrv, hrvBase: hb, rhr: today.rhr, rhrBase: rb, kcal: today.kcal, exMin: today.exMin, calibrating: !hb && today.hrv != null };
}
const recBand = r => r >= 67 ? { c: "#1683ff", t: "Ready to push" } : r >= 34 ? { c: "#f5a524", t: "Train normal" } : { c: "#e5484d", t: "Take it easy" };
const strainBand = s => s >= 18 ? "All out" : s >= 14 ? "High" : s >= 10 ? "Moderate" : "Light";
function todayCard(c) {
  if (S.healthMissing || !S.health.length) return "";
  const d = dailyScores(S.health);
  if (d.recovery == null && !d.sleep && d.strain == null) return "";
  const txt = (y, s, size, w) => `<text x="50" y="${y}" text-anchor="middle" font-size="${size}" font-weight="${w || 800}" fill="${w ? "var(--muted)" : "var(--ink)"}">${s}</text>`;
  const cell = (label, ring, sub) => `<div class="dcell">${ring}<span class="dl">${label}</span><span class="ds">${sub}</span></div>`;
  const rb = d.recovery != null ? recBand(d.recovery) : null;
  const rec = cell("Recovery", arc(d.recovery ?? 0, 92, rb ? rb.c : "var(--grid)", d.recovery != null ? txt(56, d.recovery + "%", 24) : txt(56, "–", 24)),
    d.recovery != null ? `<b style="color:${rb.c}">${rb.t}</b>` : d.calibrating ? "Learning your normal" : "Needs HRV");
  const slp = cell("Sleep", arc(d.sleep ? d.sleep.score : 0, 92, "#6d6bff", d.sleep ? txt(56, d.sleep.score, 24) : txt(56, "–", 24)), d.sleep ? `${f1(d.sleep.hours)} h` : "No data");
  const str = cell("Strain", arc(d.strain != null ? d.strain / 21 * 100 : 0, 92, "#38c4f0", d.strain != null ? txt(56, f1(d.strain), 24) : txt(56, "–", 24)), d.strain != null ? strainBand(d.strain) + " so far" : "No data");
  let tip = "";
  const who = S.isTrainer ? firstName(c.name) + "'s" : "Your";
  if (d.recovery != null) {
    const hv = d.hrvPct != null ? `HRV ${Math.abs(Math.round(d.hrvPct))}% ${d.hrvPct >= 0 ? "above" : "below"} ${S.isTrainer ? "normal" : "your normal"}` : `${who} body is recovering`;
    tip = d.recovery >= 67 ? `${hv}. Good day to push heavy.` : d.recovery >= 34 ? `${hv}. Train as planned.` : `${hv}${d.sleep && d.sleep.hours < 6.5 ? " and short sleep" : ""}. Keep it lighter: Zone 2 and mobility.`;
  } else if (d.calibrating) tip = "Wear your watch to sleep for a few nights. Recovery appears once RENOVO learns your normal HRV.";
  const detail = [d.hrv != null ? `HRV <b>${d.hrv} ms</b>${d.hrvBase ? ` (avg ${Math.round(d.hrvBase)})` : ""}` : "", d.rhr != null ? `Resting HR <b>${d.rhr}</b>${d.rhrBase ? ` (avg ${Math.round(d.rhrBase)})` : ""}` : "", d.kcal != null ? `<b>${d.kcal}</b> active cal` : ""].filter(Boolean).join("<span class='dot'>·</span>");
  return `<section class="card today"><div class="card-h"><div><div class="kicker">${S.isTrainer ? "Today" : "Your day"}</div><h2>${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</h2></div></div>
    <div class="dgrid">${rec}${slp}${str}</div>${tip ? `<p class="dtip">${esc(tip)}</p>` : ""}${detail ? `<p class="ddetail">${detail}</p>` : ""}</section>`;
}

/* ---------- strength: estimated 1-rep max, PRs ---------- */
/* Epley estimate from any set of 1–12 reps, so nobody has to max out to see progress. */
const e1rm = (lb, reps) => lb > 0 && reps >= 1 && reps <= 12 ? lb * (1 + (reps === 1 ? 0 : reps / 30)) : null;
const bestE1 = e => Math.max(0, ...(e.sets || []).map(st => e1rm(st.lb, st.reps) || 0)) || null;
/* Oldest-first history per lift: [{ date, e1, top: "185 × 8" }]. */
function liftHistory(workouts) {
  const by = {};
  [...workouts].sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt))).forEach(w => w.entries.forEach(e => {
    if (e.timed) return; const v = bestE1(e); if (!v) return;
    const st = e.sets.reduce((a, s) => (e1rm(s.lb, s.reps) || 0) > (e1rm(a.lb, a.reps) || 0) ? s : a, e.sets[0]);
    (by[e.name] ||= []).push({ date: w.date, e1: v, top: fmtSet(st) });
  }));
  return by;
}
/* Every time a lift's estimated max beat its previous best (the first session doesn't count). */
function prEvents(workouts) {
  const out = [];
  Object.entries(liftHistory(workouts)).forEach(([n, a]) => { let best = a[0].e1; a.slice(1).forEach(p => { if (p.e1 > best + 0.01) { out.push({ name: n, date: p.date, e1: p.e1, from: best, top: p.top }); best = p.e1; } }); });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
/* Main lifts in the current plan first, then the classic compound lifts, then everything else. */
const MAIN_FIRST = n => S.plan && S.plan.days.some(d => d.items.some(x => x.kind === "main" && x.name === n)) ? 0 : /bench|squat|deadlift|hip thrust|press|row|pull-?up|pulldown/i.test(n) ? 1 : 2;
function strengthCard() {
  if (S.workoutsMissing || !S.workouts.length) return "";
  const hist = liftHistory(S.workouts), lifts = Object.keys(hist).filter(n => hist[n].length >= 2).sort((a, b) => MAIN_FIRST(a) - MAIN_FIRST(b) || hist[b].length - hist[a].length);
  if (!lifts.length) return "";
  if (!lifts.includes(S.lift)) S.lift = lifts[0];
  const a = hist[S.lift], first = a[0], best = a.reduce((m, p) => p.e1 > m.e1 ? p : m, a[0]), gain = best.e1 - first.e1;
  const W = 340, H = 120, L = 6, R = 6, T = 12, B = 18, lo = Math.min(...a.map(p => p.e1)) * 0.97, hi = Math.max(...a.map(p => p.e1)) * 1.02;
  const x = i => L + (a.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (a.length - 1)), y = v => T + (H - T - B) - (v - lo) / (hi - lo || 1) * (H - T - B);
  const pts = a.map((p, i) => `${x(i).toFixed(1)},${y(p.e1).toFixed(1)}`).join(" ");
  let run = 0; const dots = a.map((p, i) => { const pr = i > 0 && p.e1 > run + 0.01; run = Math.max(run, p.e1); return `<circle cx="${x(i).toFixed(1)}" cy="${y(p.e1).toFixed(1)}" r="${pr ? 4.5 : 3}" fill="${pr ? "#f5a524" : "var(--blue)"}"/>`; }).join("");
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(S.lift)} estimated max over time"><polyline points="${pts}" fill="none" stroke="var(--blue)" stroke-width="2.2" stroke-linejoin="round"/>${dots}
    <text x="${L}" y="${H - 4}" font-size="10" fill="var(--muted)">${fmtD(first.date)}</text><text x="${W - R}" y="${H - 4}" font-size="10" fill="var(--muted)" text-anchor="end">${fmtD(a[a.length - 1].date)}</text></svg>`;
  const prs = prEvents(S.workouts).slice(0, 4);
  return `<section class="card strength"><div class="card-h"><div><div class="kicker">Strength</div><h2>Estimated max</h2></div><span class="muted small">${prEvents(S.workouts).length} PRs</span></div>
    <label class="small muted" for="liftPick" hidden>Lift</label><select id="liftPick" class="liftpick">${lifts.map(n => `<option${n === S.lift ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>
    <div class="tr-sum"><span class="big">${Math.round(best.e1)}<small> lb est. 1-rep max</small></span><span class="small ${gain > 0 ? "up" : "muted"}">${gain > 0 ? `▲ ${Math.round(gain)} lb since ${fmtD(first.date)}` : `Best set: ${best.top}`}</span></div>
    ${svg}<p class="small muted" style="margin:4px 0 0">Orange dots are personal records. Estimated from your best set each session (weight × reps), so you never have to max out.</p>
    ${prs.length ? `<ul class="prlist">${prs.map(p => `<li><span>🏆 ${esc(p.name)}</span><b>${Math.round(p.e1)} lb</b><em>${fmtD(p.date)}</em></li>`).join("")}</ul>` : ""}</section>`;
}

/* ---------- badges ---------- */
const mondayOf = iso => { const d = toDate(iso), k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
/* Longest run of consecutive calendar days in a sorted list of ISO dates. */
function longestDayRun(dates) { let best = 0, run = 0, prev = null; [...new Set(dates)].sort().forEach(d => { run = prev && days(prev, d) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }); return best; }
function badgeList(c) {
  const out = [], add = (id, icon, title, desc, have, need) => out.push({ id, icon, title, desc, earned: have >= need, pct: Math.max(0, Math.min(1, have / need)) });
  // Consistency
  const nW = S.workouts.length;
  [[1, "First workout"], [10, "10 workouts"], [25, "25 workouts"], [50, "50 workouts"], [100, "100 workouts"], [250, "250 workouts"]].forEach(([n, t]) => add("w" + n, "🏋️", t, `Log ${n} workout${n > 1 ? "s" : ""}`, nW, n));
  const perWeek = S.plan && trainDays(S.plan.days) ? Math.min(7, trainDays(S.plan.days)) : 3, wk = {};
  S.workouts.forEach(w => { const k = mondayOf(w.date); wk[k] = (wk[k] || 0) + 1; });
  let bestStreak = 0, run = 0, prev = null;
  Object.keys(wk).sort().forEach(k => { if (wk[k] < perWeek) { run = 0; prev = k; return; } run = prev && days(prev, k) === 7 && run ? run + 1 : 1; bestStreak = Math.max(bestStreak, run); prev = k; });
  [2, 4, 8, 12, 26].forEach(n => add("st" + n, "🔥", `${n}-week streak`, `Every planned workout, ${n} weeks in a row`, bestStreak, n));
  // Programs
  const runs = {}; S.workouts.forEach(w => { if (w.program) runs[w.program] = (runs[w.program] || 0) + 1; });
  const cur = S.plan && S.plan.program ? progKey(S.plan.program) : "";
  if (cur && !runs[cur]) runs[cur] = 0;
  Object.entries(runs).forEach(([k, n]) => { const [name, start, weeks, dpw] = k.split("|"), total = Math.max(1, Math.round((+weeks || 6) * (+dpw || perWeek) * 0.8));
    add("p:" + k, "🏁", `${name} complete`, `Finish 80% of the workouts (${total}) in ${name}, started ${fmtD(start)}`, n, total); });
  // Strength
  const nPR = prEvents(S.workouts).length;
  [[1, "First PR"], [10, "10 PRs"], [25, "25 PRs"], [50, "50 PRs"]].forEach(([n, t]) => add("pr" + n, "🏆", t, `Beat your best estimated max ${n} time${n > 1 ? "s" : ""}`, nPR, n));
  // Steps
  const steps = S.health.filter(h => h.steps != null), maxSteps = Math.max(0, ...steps.map(h => h.steps));
  [5, 10, 15, 20, 25].forEach(k => add("s" + k, "👟", `${k}K steps`, `Walk ${k},000 steps in one day`, maxSteps, k * 1000));
  add("s10x7", "👟", "10K week", "10,000+ steps 7 days in a row", longestDayRun(steps.filter(h => h.steps >= 10000).map(h => h.date)), 7);
  // Goals
  if (!S.waterMissing) {
    const g = waterGoal(c), hit = S.water.filter(w => w.oz >= g).map(w => w.date);
    [[7, "Hydrated week"], [30, "30 hydrated days"], [100, "100 hydrated days"]].forEach(([n, t]) => add("wa" + n, "💧", t, `Hit your water goal on ${n} days`, hit.length, n));
    add("wa7s", "💧", "Water streak", "Water goal 7 days in a row", longestDayRun(hit), 7);
  }
  if (c.proteinGoal) { const ph = S.health.filter(h => h.protein != null && h.protein >= c.proteinGoal * 0.95).length; [[7, "Protein week"], [30, "Protein pro"]].forEach(([n, t]) => add("pg" + n, "🥩", t, `Hit your protein goal on ${n} days`, ph, n)); }
  if (!S.habitsMissing && habitsOf(c).length) {
    const best = Math.max(0, ...habitsOf(c).map(h => { let b = 0, r = 0; daysBack(120).reverse().forEach(d => { const v = habitDone(c, h, d); if (v === null) return; r = v ? r + 1 : 0; b = Math.max(b, r); }); return b; }));
    [[7, "7-day habit streak"], [30, "30-day habit streak"], [100, "100-day habit streak"]].forEach(([n, t]) => add("hs" + n, "🎯", t, `Keep any habit going ${n} days in a row`, best, n));
  }
  [[4, "4 check-ins"], [12, "12 check-ins"], [26, "26 check-ins"]].forEach(([n, t]) => add("ci" + n, "📏", t, `Log ${n} check-ins`, S.checkins.length, n));
  return out;
}
function badgesCard(c) {
  const all = badgeList(c), got = all.filter(b => b.earned);
  // Celebrate badges earned since this person last looked (clients only; the first visit just records them).
  try {
    if (!S.isTrainer && !DEMO) {
      const key = `rv_badges_${c.id}`, seen = JSON.parse(store.get(key) || "null"), ids = got.map(b => b.id);
      if (seen) { const fresh = got.filter(b => !seen.includes(b.id)); if (fresh.length) setTimeout(() => toast(`🏅 Badge unlocked: ${fresh.map(b => b.title).join(", ")}`), 600); }
      store.set(key, JSON.stringify(ids));
    }
  } catch (_) {}
  const next = all.filter(b => !b.earned).sort((a, b) => b.pct - a.pct).slice(0, 3);
  return `<section class="card badges"><div class="card-h"><div><div class="kicker">Badges</div><h2>Trophy case</h2></div><span class="muted small">${got.length} of ${all.length}</span></div>
    ${got.length ? `<div class="bgrid">${got.map(b => `<div class="badge" title="${esc(b.desc)}"><span class="bi">${b.icon}</span><span class="bt">${esc(b.title)}</span></div>`).join("")}</div>` : `<p class="small muted">Log workouts, hit your water goal and walk to earn your first badges.</p>`}
    ${next.length ? `<div class="bnext"><div class="lbl">Next up</div>${next.map(b => `<div class="bn"><span class="bi off">${b.icon}</span><div class="bnt"><b>${esc(b.title)}</b><span>${esc(b.desc)}</span><span class="sc-bar"><span style="width:${Math.round(b.pct * 100)}%"></span></span></div></div>`).join("")}</div>` : ""}</section>`;
}

/* ---------- weekly score + trends ---------- */
const isoOf = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const daysBack = n => { const t = todayISO(); return Array.from({ length: n }, (_, i) => { const d = toDate(t); d.setDate(d.getDate() - i); return isoOf(d); }); };
/* Last 7 days, today included. Each part scores 0–1; parts with no data at all are left out so nobody is punished for not having an Apple Watch. */
function weekScore(c) {
  const wk = daysBack(7), inWk = d => wk.includes(d);
  const perWeek = S.plan && trainDays(S.plan.days) ? Math.min(7, trainDays(S.plan.days)) : 0;
  const done = new Set(S.workouts.filter(w => inWk(w.date)).map(w => w.date + "|" + w.dayName)).size;
  const goal = waterGoal(c), waterDays = wk.filter(d => waterOn(d) >= goal).length;
  const hk = S.health.filter(h => inWk(h.date));
  const stepsAvg = avg(hk.map(h => h.steps)), sleepAvg = avg(hk.map(h => h.sleepH));
  const parts = [];
  if (perWeek) parts.push({ k: "Workouts", w: 35, v: Math.min(1, done / perWeek), txt: `${done} of ${perWeek}` });
  if (!S.waterMissing) parts.push({ k: "Water goal", w: 25, v: waterDays / 7, txt: `${waterDays} of 7 days` });
  if (stepsAvg != null) parts.push({ k: "Steps", w: 20, v: Math.min(1, stepsAvg / 8000), txt: `${Math.round(stepsAvg).toLocaleString("en-US")}/day` });
  if (sleepAvg != null) parts.push({ k: "Sleep", w: 20, v: Math.min(1, sleepAvg / 7), txt: `${f1(sleepAvg)} h/night` });
  const hw = S.habitsMissing ? null : habitWeek(c);
  if (hw != null) parts.push({ k: "Habits", w: 20, v: hw, txt: `${Math.round(hw * 100)}%` });
  const tw = parts.reduce((a, p) => a + p.w, 0);
  return { parts, score: tw ? Math.round(parts.reduce((a, p) => a + p.w * p.v, 0) / tw * 100) : null };
}
function ring(pct, size) {
  const r = 42, C = 2 * Math.PI * r, off = C * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return `<svg class="ring" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true"><circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--blue-soft)" stroke-width="11"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="url(#ringg)" stroke-width="11" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 50 50)"/>
    <defs><linearGradient id="ringg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5fb0ff"/><stop offset="1" stop-color="var(--blue)"/></linearGradient></defs>
    <text x="50" y="57" text-anchor="middle" font-size="26" font-weight="800" fill="var(--ink)">${pct}</text></svg>`;
}
function scoreCard(c) {
  const { parts, score } = weekScore(c);
  if (score == null) return "";
  const msg = score >= 85 ? "Crushing it this week." : score >= 65 ? "Solid week. Keep it rolling." : score >= 40 ? "Good start. A couple more wins this week." : "Every day counts. Let's get one win today.";
  return `<section class="card score"><div class="sc-ring">${ring(score, 92)}</div><div class="sc-body"><div class="kicker">Weekly score</div><div class="sc-msg">${S.isTrainer ? `${esc(firstName(c.name))}: ` : ""}${msg}</div>
    <ul class="sc-parts">${parts.map(p => `<li><span class="sc-k">${p.k}</span><span class="sc-bar"><span style="width:${Math.round(p.v * 100)}%"></span></span><span class="sc-v">${p.txt}</span></li>`).join("")}</ul></div></section>`;
}
const TRENDS = {
  steps: { label: "Steps", unit: "", get: h => h.steps, bar: true, fmt: v => Math.round(v).toLocaleString("en-US"), goal: 8000 },
  sleep: { label: "Sleep", unit: "h", get: h => h.sleepH, bar: true, fmt: v => f1(v), goal: 7 },
  weight: { label: "Weight", unit: "lb", get: h => h.weight, fmt: v => f1(v) },
  rhr: { label: "Resting HR", unit: "bpm", get: h => h.rhr, fmt: v => Math.round(v) }
};
function trendSvg(m, pts, span) {
  const W = 340, H = 130, L = 4, R = 4, T = 10, B = 18, iw = W - L - R, ih = H - T - B;
  const vals = pts.map(p => p.v).filter(v => v != null);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (m.bar) { lo = 0; hi = Math.max(hi, m.goal || 0) * 1.08; } else { const pd = Math.max(1, (hi - lo) * 0.15); lo -= pd; hi += pd; }
  const x = i => L + (i + 0.5) * iw / span, y = v => T + ih - (v - lo) / (hi - lo || 1) * ih;
  let g = "";
  if (m.goal) g += `<line x1="${L}" x2="${W - R}" y1="${y(m.goal).toFixed(1)}" y2="${y(m.goal).toFixed(1)}" stroke="var(--blue)" stroke-dasharray="3 4" stroke-width="1" opacity=".5"/>`;
  if (m.bar) { const bw = Math.max(2, iw / span * 0.62); pts.forEach((p, i) => { if (p.v == null) return; const yy = y(p.v); g += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${(T + ih - yy).toFixed(1)}" rx="${Math.min(3, bw / 2).toFixed(1)}" fill="${m.goal && p.v >= m.goal ? "var(--blue)" : "#9cc8ff"}"/>`; }); }
  else { const seg = pts.map((p, i) => p.v == null ? null : `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).filter(Boolean); g += `<polyline points="${seg.join(" ")}" fill="none" stroke="var(--blue)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`; const lp = pts.map((p, i) => [p, i]).filter(([p]) => p.v != null).pop(); if (lp) g += `<circle cx="${x(lp[1]).toFixed(1)}" cy="${y(lp[0].v).toFixed(1)}" r="3.5" fill="var(--blue)"/>`; }
  const first = pts[0].d, last = pts[pts.length - 1].d;
  g += `<text x="${L}" y="${H - 4}" font-size="10" fill="var(--muted)">${fmtD(first)}</text><text x="${W - R}" y="${H - 4}" font-size="10" fill="var(--muted)" text-anchor="end">${fmtD(last)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${m.label} trend">${g}</svg>`;
}
function trendsCard() {
  if (S.healthMissing || S.health.length < 2) return "";
  const keys = Object.keys(TRENDS).filter(k => S.health.some(h => TRENDS[k].get(h) != null));
  if (!keys.length) return "";
  if (!keys.includes(S.trend)) S.trend = keys[0];
  const m = TRENDS[S.trend], span = S.trendSpan || 30;
  const ds = daysBack(span).reverse(), by = {}; S.health.forEach(h => { by[h.date] = h; });
  const pts = ds.map(d => ({ d, v: by[d] ? m.get(by[d]) ?? null : null }));
  const vals = pts.map(p => p.v).filter(v => v != null);
  if (vals.length < 2) return "";
  const half = Math.floor(span / 2), a1 = avg(pts.slice(0, half).map(p => p.v)), a2 = avg(pts.slice(half).map(p => p.v));
  const delta = a1 != null && a2 != null ? a2 - a1 : null;
  const dTxt = delta == null ? "" : `${delta >= 0 ? "▲" : "▼"} ${m.fmt(Math.abs(delta))}${m.unit ? " " + m.unit : ""} vs first half`;
  return `<section class="card trends"><div class="card-h"><div><div class="kicker">Trends</div><h2>${m.label}</h2></div>
    <div class="seg" role="group" aria-label="Range">${[30, 90].map(n => `<button type="button" data-tspan="${n}" aria-pressed="${n === span}">${n}d</button>`).join("")}</div></div>
    <div class="seg tr-pick" role="group" aria-label="Metric">${keys.map(k => `<button type="button" data-trend="${k}" aria-pressed="${k === S.trend}">${TRENDS[k].label}</button>`).join("")}</div>
    <div class="tr-sum"><span class="big">${m.fmt(avg(vals))}<small>${m.unit ? " " + m.unit : ""} avg</small></span><span class="muted small">${dTxt}</span></div>
    ${trendSvg(m, pts, span)}</section>`;
}

/* ---------- coach overview: every client on one screen ---------- */
async function loadOverview() {
  S.screen = "overview"; S.ov = null; render();
  try { S.ov = await api.overview(); } catch (err) { console.error(err); S.ov = { checkins: [], workouts: [], water: [], health: [], plans: [] }; toast("Couldn't load everything. Pull down to refresh."); }
  render();
}
function ovRow(c, o) {
  const t = todayISO(), wk = daysBack(7), inWk = d => wk.includes(d);
  const ck = o.checkins.filter(x => x.client_id === c.id).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at)));
  const last = ck[0], ago = last ? days(last.date, t) : null;
  const needsReply = !!(last && !last.coach_note && ago <= 14);
  const plan = o.plans.find(p => p.client_id === c.id), perWeek = plan ? Math.min(7, trainDays(plan.days)) : 0;
  const done = new Set(o.workouts.filter(w => w.client_id === c.id && inWk(w.date)).map(w => w.date + "|" + w.day_name)).size;
  const lw = ck.find(x => x.weight_lb != null)?.weight_lb;
  const goal = c.waterGoal || (lw ? Math.min(128, Math.max(64, Math.round(lw / 2 / 8) * 8)) : 64);
  const wat = o.water.filter(w => w.client_id === c.id && inWk(w.date));
  const waterDays = wat.filter(w => w.oz >= goal).length;
  const hk = o.health.filter(h => h.client_id === c.id && inWk(h.date));
  const steps = avg(hk.map(h => h.steps)), sleep = avg(hk.map(h => h.sleep_hours));
  const parts = [];
  if (perWeek) parts.push([35, Math.min(1, done / perWeek)]);
  if (o.water.length) parts.push([25, waterDays / 7]);
  if (steps != null) parts.push([20, Math.min(1, steps / 8000)]);
  if (sleep != null) parts.push([20, Math.min(1, sleep / 7)]);
  const tw = parts.reduce((a, p) => a + p[0], 0), score = tw ? Math.round(parts.reduce((a, p) => a + p[0] * p[1], 0) / tw * 100) : null;
  const overdue = ago == null || ago > 9;
  const missedList = plan ? missedDays({ days: plan.days || [], program: plan.program || null, updatedAt: plan.updated_at }, o.workouts.filter(w => w.client_id === c.id).map(w => ({ date: w.date })), 7) : [];
  const flags = (missedList.length ? 1 : 0) + ((o.unread || []).some(u => u.client_id === c.id) ? 3 : 0) + (needsReply ? 2 : 0) + (overdue ? 1 : 0) + (score != null && score < 40 ? 1 : 0);
  const chips = [
    (() => { const n = (o.unread || []).filter(u => u.client_id === c.id).length; return n ? `<span class="chip hot">💬 ${n} new message${n > 1 ? "s" : ""}</span>` : ""; })(),
    needsReply ? `<span class="chip hot">📏 Check-in needs reply</span>` : "",
    (() => { const m = missedList; return m.length ? `<span class="chip warn">❌ Missed ${m.length > 1 ? m.length + " workouts" : toDate(m[0].date).toLocaleDateString("en-US", { weekday: "short" }) + " " + esc(shortDay(m[0].name))}</span>` : ""; })(),
    ago == null ? `<span class="chip warn">No check-ins yet</span>` : `<span class="chip${overdue ? " warn" : ""}">Check-in ${ago === 0 ? "today" : ago === 1 ? "yesterday" : ago + "d ago"}</span>`,
    perWeek ? `<span class="chip">🏋️ ${done}/${perWeek} workouts</span>` : "",
    wat.length ? `<span class="chip">💧 ${waterDays}/7 days</span>` : "",
    steps != null ? `<span class="chip">👟 ${(steps / 1000).toFixed(1)}k steps</span>` : "",
    (() => { const ds = dailyScores(o.health.filter(h => h.client_id === c.id).map(fromHealthRow)); if (ds.recovery == null) return ""; const b = recBand(ds.recovery); return `<span class="chip" style="color:${b.c};border-color:${b.c}55">⚡ Recovery ${ds.recovery}%</span>`; })()
  ].join("");
  return { c, flags, score, html: `<button type="button" class="ov-row${c.active ? "" : " paused"}" data-open="${esc(c.id)}">
    <span class="ov-ring">${score != null ? ring(score, 54) : `<span class="ov-none">–</span>`}</span>
    <span class="ov-main"><span class="ov-name">${esc(c.name)}${c.active ? "" : ` <em>Paused</em>`}</span><span class="ov-chips">${chips}</span></span><span class="ov-go" aria-hidden="true">›</span></button>` };
}
function overviewScreen() {
  if (!S.ov) return `<div class="skel"></div>`;
  const rows = S.clients.map(c => ovRow(c, S.ov)).sort((a, b) => (b.c.active - a.c.active) || (b.flags - a.flags) || ((a.score ?? 101) - (b.score ?? 101)) || a.c.name.localeCompare(b.c.name));
  const active = rows.filter(r => r.c.active), attention = active.filter(r => r.flags > 0).length;
  return `<section class="ov-head"><h1>Your clients</h1><p>${active.length} active${attention ? ` · <b>${attention} need${attention === 1 ? "s" : ""} attention</b>` : " · everyone's on track"}</p></section>
    <div class="ov-list">${rows.map(r => r.html).join("") || `<div class="empty">No clients yet. <button class="btn primary sm" id="welcomeAdd" type="button">Add your first client</button></div>`}</div>
    <p class="small muted ov-note">Score = this week's workouts, water goal days, steps and sleep. Needs-attention clients are listed first.</p>`;
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
/* Start and finish photos side by side for exercises that have them (see tools/build-exercise-images.py). */
const exStem = name => (window.EXERCISE_IMAGES || {})[String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()] || "";
function exPics(name, ref) {
  const st = exStem(name); if (!st) return "";
  const img = (n, pos) => `<img src="../workouts/img/${st}-${n}.jpg" alt="${esc(name)}, ${pos} position" width="560" height="420" loading="lazy" decoding="async">`;
  const u = refUrl(ref), inner = img(0, "start") + img(1, "finish");
  return u ? `<a class="xpics" href="${u}" target="_blank" rel="noopener" aria-label="${esc(name)} form tips">${inner}</a>` : `<div class="xpics">${inner}</div>`;
}
/* ---------- gym / home switch ---------- */
/* Each gym exercise's at-home version (bodyweight or a pair of dumbbells), from the site's home workouts.
   reps is set only when the home move needs a different rep range (bodyweight moves need more reps). */
const HOME_SWAP = {
  "barbell or dumbbell bench press": { name: "Push-Up", ref: "chest/home", reps: "8–15", note: "Feet on a chair or a slow 3-second lowering makes it harder." },
  "dumbbell bench press": { name: "Push-Up", ref: "chest/home", reps: "8–15" },
  "incline dumbbell press": { name: "Decline Push-Up", ref: "chest/home", reps: "6–12" },
  "machine or weighted dip": { name: "Chair Dip", ref: "arms/home", reps: "8–15" },
  "cable or dumbbell fly": { name: "Wide Push-Up", ref: "chest/home", reps: "8–12" },
  "close grip bench press": { name: "Close-Grip Push-Up", ref: "arms/home", reps: "8–15" },
  "pull up or lat pulldown": { name: "Table Inverted Row", ref: "back/home", reps: "6–12" },
  "lat pulldown or pull up": { name: "Table Inverted Row", ref: "back/home", reps: "6–12" },
  "barbell or dumbbell row": { name: "Bent-Over Row", ref: "back/home", note: "Dumbbells or a loaded backpack." },
  "seated cable row": { name: "Bent-Over Row", ref: "back/home", note: "Dumbbells or a loaded backpack." },
  "face pull": { name: "Bent-Over Rear Delt Raise", ref: "shoulders/home", reps: "15" },
  "rear delt fly": { name: "Bent-Over Rear Delt Raise", ref: "shoulders/home" },
  "seated dumbbell shoulder press": { name: "Shoulder Press", ref: "shoulders/home" },
  "dumbbell lateral raise": { name: "Lateral Raise", ref: "shoulders/home" },
  "cable upright row": { name: "Upright Row", ref: "shoulders/home" },
  "ez bar curl": { name: "Biceps Curl", ref: "arms/home" },
  "incline dumbbell curl": { name: "Biceps Curl", ref: "arms/home" },
  "overhead cable or dumbbell triceps extension": { name: "Triceps Kickback", ref: "arms/home" },
  "triceps pushdown": { name: "Triceps Kickback", ref: "arms/home" },
  "hammer curl": { name: "Hammer Curl", ref: "arms/home" },
  "back squat or goblet squat": { name: "Bodyweight Squat", ref: "legs/home", reps: "15–20", note: "Hold a dumbbell at your chest (goblet) once 20 reps feels easy." },
  "goblet or back squat": { name: "Bodyweight Squat", ref: "legs/home", reps: "15–20", note: "Hold a dumbbell at your chest (goblet) once 20 reps feels easy." },
  "romanian deadlift": { name: "Backpack Romanian Deadlift", ref: "back/home", reps: "10–12" },
  "leg press": { name: "Step-Up", ref: "legs/home", reps: "10 per leg" },
  "walking lunge": { name: "Reverse Lunge", ref: "legs/home", reps: "10 per leg" },
  "lying or seated leg curl": { name: "Single-Leg Romanian Deadlift", ref: "legs/home", reps: "8–10 per leg" },
  "standing calf raise": { name: "Single-Leg Calf Raise", ref: "legs/home", reps: "12–15 per leg" },
  "barbell hip thrust": { name: "Single-Leg Glute Bridge", ref: "glutes/home", reps: "10–12 per leg" },
  "bulgarian split squat": { name: "Couch Bulgarian Split Squat", ref: "glutes/home" },
  "cable kickback": { name: "Donkey Kick", ref: "glutes/home", reps: "15 per leg" },
  "hip abduction machine or banded walk": { name: "Side Leg Raise", ref: "glutes/home", reps: "15–20 per leg" },
  "hanging or captain s chair knee raise": { name: "Reverse Crunch", ref: "core/home", reps: "12–15" },
  "cable woodchop": { name: "Mountain Climbers", ref: "core/home", reps: "30 sec" },
  "farmer s carry": { name: "Suitcase Carry", ref: "", reps: "30 sec each side", note: "One dumbbell or a loaded bag at your side. Walk tall." },
  "dumbbell shrug": { name: "Dumbbell Shrug", ref: "shoulders" },
  "single arm dumbbell row": { name: "Single-Arm Dumbbell Row", ref: "back" },
  "plank": { name: "Plank", ref: "core/home" }, "dead bug": { name: "Dead Bug", ref: "core/home" }, "side plank": { name: "Side Plank", ref: "core/home" }
};
const normName = n => String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function homeItem(x) {
  const m = HOME_SWAP[normName(x.name)]; if (!m) return x;
  return { ...x, name: m.name, ref: m.ref, reps: m.reps || x.reps, rir: m.reps ? "" : x.rir, note: m.note || "", gymName: x.name };
}
/* Gym or home, remembered per device. Home swaps every exercise that has an at-home version. */
const whereKey = () => `rv_where_${S.sel || ""}`;
const getWhere = () => store.get(whereKey()) === "home" ? "home" : "gym";
const setWhere = w => store.set(whereKey(), w);
const placeItem = (x, where) => where === "home" ? homeItem(x) : x;
const whereSeg = (id, where) => `<div class="seg wtoggle" role="group" aria-label="Where are you training?" id="${id}"><button type="button" data-where="gym" aria-pressed="${where === "gym"}">🏋️ Gym</button><button type="button" data-where="home" aria-pressed="${where === "home"}">🏠 Home</button></div>`;

/* ---------- programs: weeks, phases and progression ---------- */
/* A program lives on the plan as { name, weeks, daysPerWeek, start, phases: [{ from, to, name, note, deload, peak, main: {sets, reps, rir, rest}, acc: {sets, reps, rir, rest} }] }.
   Exercises tagged kind "main" or "acc" take this week's sets, reps and effort; everything else (walks, carries) stays as written. */
const nextMonday = () => { const d = toDate(todayISO()), k = (8 - d.getDay()) % 7; d.setDate(d.getDate() + k); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
function progWeek(pr) { if (!pr || !pr.start || !pr.weeks) return null; const d = days(pr.start, todayISO()); if (d < 0) return 0; const w = Math.floor(d / 7) + 1; return w > pr.weeks ? pr.weeks + 1 : w; }
const progPhase = (pr, wk) => (pr && pr.phases || []).find(ph => wk >= ph.from && wk <= ph.to) || null;
const progKey = pr => pr && pr.start ? `${pr.name}|${pr.start}|${pr.weeks}|${pr.daysPerWeek || 0}` : "";
function itemForWeek(x, pr, wk) {
  if (!pr || !x.kind || !wk || wk > pr.weeks) return x;
  const ph = progPhase(pr, wk), sp = ph && (x.kind === "main" ? ph.main : ph.acc);
  if (!sp) return x;
  return { ...x, sets: String(sp.sets), reps: String(sp.reps), rir: sp.rir != null ? String(sp.rir) : "", rest: sp.rest || x.rest, deload: !!ph.deload, peak: !!ph.peak };
}
const rirTxt = x => x.rir ? ` · ${x.rir} in the tank` : "";
function progBar(p) {
  const pr = p.program; if (!pr) return "";
  const wk = progWeek(pr), key = progKey(pr);
  const done = S.workouts.filter(w => w.program === key).length, total = pr.weeks * (pr.daysPerWeek || trainDays(p.days));
  if (wk === 0) return `<div class="prog"><div class="prog-top"><b>${esc(pr.name)}</b><span class="muted small">Starts ${fmtD(pr.start)}</span></div><p class="prog-note">${pr.weeks} weeks · ${pr.daysPerWeek || trainDays(p.days)} days a week. Week 1 starts ${toDate(pr.start).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}.</p></div>`;
  if (wk > pr.weeks) return `<div class="prog done"><div class="prog-top"><b>🏁 ${esc(pr.name)} complete</b><span class="muted small">${done} of ${total} workouts</span></div><p class="prog-note">${S.isTrainer ? "Time to pick the next program." : `Amazing work. ${esc(TRAINER)} will set up your next phase.`}</p></div>`;
  const ph = progPhase(pr, wk);
  return `<div class="prog"><div class="prog-top"><b>Week ${wk} of ${pr.weeks}</b>${ph ? `<span class="prog-ph${ph.deload ? " dl" : ph.peak ? " pk" : ""}">${esc(ph.name)}</span>` : ""}<span class="muted small">${done}/${total} workouts</span></div>
    <div class="prog-bar"><span style="width:${Math.min(100, Math.round(done / total * 100))}%"></span><i style="left:${Math.min(100, Math.round((wk - 1) / pr.weeks * 100))}%"></i></div>${ph && ph.note ? `<p class="prog-note">${esc(ph.note)}</p>` : ""}</div>`;
}

function planDays(p) {
  const canLog = !S.workoutsMissing;
  const wk = progWeek(p.program), where = getWhere();
  let n = 0;
  return `<div class="days">${p.days.map((d, i) => isRestDay(d) ? `<div class="day rest"><div class="day-h"><span class="dnum">Rest</span><h3>${esc(d.name || "Rest day")}</h3></div>${(d.items || []).map(x => `<p class="small muted" style="margin:4px 0 0">${esc([x.reps, x.note].filter(Boolean).join(". "))}</p>`).join("")}</div>` : `<div class="day"><div class="day-h"><span class="dnum">Day ${++n}</span><h3>${esc(d.name || "Workout")}</h3>${canLog ? `<button type="button" class="btn primary sm startw" data-start="${i}">${S.isTrainer ? "Log workout" : "Start workout"}</button>` : ""}${lastDone(d.name)}</div>
    <ol class="plist">${(d.items || []).map(x0 => { const x = placeItem(itemForWeek(x0, p.program, wk), where), u = refUrl(x.ref);
      const sr = [x.sets ? `${esc(x.sets)} × ${esc(x.reps || "")}` : esc(x.reps || ""), x.rir ? `${esc(x.rir)} in the tank` : "", x.rest ? `rest ${esc(x.rest)}` : ""].filter(Boolean).join(" · ");
      const pics = exPics(x.name, x.ref);
      return `<li${pics ? ` class="haspic"` : ""}>${pics}<div class="ptxt"><div class="pname">${esc(x.name)}${x.kind === "main" ? ` <span class="mtag">Main lift</span>` : ""}</div>${x.gymName ? `<div class="pnote">Home swap for ${esc(x.gymName)}</div>` : ""}${sr ? `<div class="psr">${sr}</div>` : ""}${x.note ? `<div class="pnote">${esc(x.note)}</div>` : ""}${u ? `<a class="plink" href="${u}" target="_blank" rel="noopener">Form tips →</a>` : ""}</div></li>`; }).join("")}</ol></div>`).join("")}</div>`;
}
function planCard(c) {
  if (S.planMissing) return S.isTrainer ? `<section class="card"><div class="card-h"><h2>Workout plan</h2></div><div class="empty">Workout plans and check-in replies need a one-time database update. Run <code>supabase/schema.sql</code> again in the Supabase SQL Editor, then reload. Steps are in <code>tracker/SETUP.md</code>.</div></section>` : "";
  const p = S.plan;
  if (!p || !p.days.length) {
    return S.isTrainer ? `<section class="card"><div class="card-h"><h2>Workout plan</h2></div><div class="empty">No plan for ${esc(firstName(c.name))} yet. Build one from your gym and home workouts, or write your own. <button class="btn primary sm" id="buildPlan" type="button">Build plan</button></div></section>` : "";
  }
  return `<section class="card plan"><div class="card-h"><div><div class="kicker">${S.isTrainer ? "Workout plan" : `Your plan from ${esc(TRAINER)}`}</div><h2>${esc(p.title || "Workout plan")}</h2></div>
    ${S.isTrainer ? `<button class="btn" id="editPlan" type="button">Edit plan</button>` : (p.updatedAt ? `<span class="muted small">Updated ${fmtD(String(p.updatedAt).slice(0, 10), true)}</span>` : "")}</div>
    ${progBar(p)}<div class="where-row"><span class="small muted">Training today at</span>${whereSeg("planWhere", getWhere())}</div>${p.notes ? `<p class="summary">${esc(p.notes)}</p>` : ""}${planDays(p)}</section>`;
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
const cleanDays = () => draft.days.map(d => ({ name: String(d.name || "").trim(), items: (d.items || []).map(x => ({ name: String(x.name || "").trim(), sets: String(x.sets || "").trim(), reps: String(x.reps || "").trim(), rest: String(x.rest || "").trim(), note: String(x.note || "").trim(), ref: x.ref || "", ...(x.kind ? { kind: x.kind } : {}) })).filter(x => x.name) })).filter(d => d.items.length);
const blankItem = () => ({ name: "", sets: "3", reps: "10", rest: "60 sec", note: "", ref: "" });
function openPlan(c) {
  planClient = c;
  draft = S.plan && S.plan.days.length ? JSON.parse(JSON.stringify({ title: S.plan.title, notes: S.plan.notes, days: S.plan.days, program: S.plan.program || null })) : { title: "", notes: "", days: [{ name: "", items: [] }], program: null };
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
  draft = { title: t.title || t.name, notes: t.notes || "", days: JSON.parse(JSON.stringify(t.days)), program: t.program ? { ...JSON.parse(JSON.stringify(t.program)), start: nextMonday() } : null };
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
    const program = draft.program ? (({ start, ...rest }) => rest)(draft.program) : null;
    await api.saveTemplate({ name, title: name, notes: (draft.notes || "").trim(), days, program }, existing?.id);
    S.templates = await api.listTemplates(); drawTemplateRow();
    toast(existing ? `Template "${name}" updated` : `Saved "${name}" as a template. Pick it for any client.`);
  } catch (e) { console.error(e); err.textContent = isMissing(e) ? "Templates need the latest database update in tracker/SETUP.md." : "Couldn't save the template. Try again."; }
  btn.disabled = false;
};
function drawPlanEditor() {
  const libOpts = `<option value="">Add a workout from your site…</option>` + ["Gym", "Home"].map(m => `<optgroup label="${m} workouts">${LIB.filter(w => w.label.endsWith(`(${m})`)).map(w => `<option value="${esc(w.id)}">${esc(w.label)}</option>`).join("")}</optgroup>`).join("");
  $("#planEd").innerHTML = `
    <div class="field"><label for="pl-title">Plan name</label><input id="pl-title" type="text" maxlength="120" data-top="title" value="${esc(draft.title)}" placeholder="e.g. Phase 1: Build the base"></div>
    ${draft.program ? `<div class="prog-ed"><div><b>📅 ${esc(draft.program.name)}</b><span class="muted small"> · ${draft.program.weeks} weeks, sets and reps change each week</span></div>
      <label class="mini"><span>Week 1 starts</span><input type="date" id="pl-start" value="${esc(draft.program.start || "")}"></label>
      <button type="button" class="btn ghost sm danger" id="plNoProg">Remove program</button></div>` : ""}
    <div class="field"><label for="pl-notes">Notes for ${esc(firstName(planClient.name))}</label><textarea id="pl-notes" rows="2" maxlength="2000" data-top="notes" placeholder="e.g. 3 days a week. Walk 30 minutes in Zone 2 after each session.">${esc(draft.notes)}</textarea></div>
    ${draft.days.map((d, di) => `<fieldset class="ed-day"><legend>Day ${di + 1}</legend>
      <div class="ed-row1"><input type="text" maxlength="80" aria-label="Day ${di + 1} name" data-d="${di}" data-k="name" value="${esc(d.name)}" placeholder="Name, e.g. Lower body"><button type="button" class="btn ghost sm danger" data-rmday="${di}" aria-label="Remove day ${di + 1}">Remove day</button></div>
      ${d.items.length ? `<div class="ed-head" aria-hidden="true"><span>Exercise</span><span>Sets</span><span>Reps</span><span>Rest</span><span></span></div>` : ""}
      ${d.items.map((x, ii) => `<div class="ed-item">
        <input type="text" maxlength="80" aria-label="Exercise name" data-d="${di}" data-i="${ii}" data-k="name" value="${esc(x.name)}" placeholder="Exercise">
        <label class="mini"><span>Sets</span><input type="text" maxlength="12" aria-label="Sets" data-d="${di}" data-i="${ii}" data-k="sets" value="${esc(x.sets)}"></label>
        <label class="mini"><span>Reps</span><input type="text" maxlength="24" aria-label="Reps" data-d="${di}" data-i="${ii}" enterkeyhint="next" data-k="reps" value="${esc(x.reps)}"></label>
        <label class="mini"><span>Rest</span><input type="text" maxlength="16" aria-label="Rest" data-d="${di}" data-i="${ii}" data-k="rest" value="${esc(x.rest)}"></label>
        <button type="button" class="xbtn" data-rm="${di}:${ii}" aria-label="Remove ${esc(x.name || "exercise")}">×</button>
        ${draft.program ? `<select class="ed-kind" data-d="${di}" data-i="${ii}" data-k="kind" aria-label="How ${esc(x.name || "this exercise")} progresses"><option value=""${!x.kind ? " selected" : ""}>Fixed (as written)</option><option value="main"${x.kind === "main" ? " selected" : ""}>Main lift (follows program)</option><option value="acc"${x.kind === "acc" ? " selected" : ""}>Accessory (follows program)</option></select>` : ""}
        <input class="ed-note" type="text" maxlength="200" aria-label="Note for ${esc(x.name || "exercise")}" data-d="${di}" data-i="${ii}" data-k="note" value="${esc(x.note)}" placeholder="Note (optional), e.g. Use the 25s">
      </div>`).join("")}
      <div class="ed-add"><button type="button" class="btn sm" data-additem="${di}">+ Exercise</button><select data-lib="${di}" aria-label="Add a workout to day ${di + 1}">${libOpts}</select></div>
    </fieldset>`).join("")}
    <button type="button" class="btn" id="plAddDay"${draft.days.length >= 7 ? " disabled" : ""}>+ Add a day</button>`;
}
$("#planEd").addEventListener("input", ev => {
  const t = ev.target;
  if (t.id === "pl-start" && draft.program) { draft.program.start = t.value; return; }
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
  else if (b.id === "plNoProg") { draft.program = null; draft.days.forEach(d => d.items.forEach(x => { delete x.kind; })); drawPlanEditor(); toast("Program removed. The plan keeps the sets and reps as written."); }
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
  if (draft.program && !/^\d{4}-\d{2}-\d{2}$/.test(draft.program.start || "")) { err.textContent = "Pick a start date for the program."; return; }
  const p = { title: draft.title.trim(), notes: draft.notes.trim(), days, program: draft.program ? { ...draft.program, daysPerWeek: draft.program.daysPerWeek || trainDays(days) } : null };
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
  if (isTimed(x)) return "";
  if (x.deload) return `<div class="hint">Deload week: use about 85–90% of last week's weight and leave plenty in the tank. This is when you recover and get stronger.</div>`;
  if (x.peak && x.kind === "main") return `<div class="hint up">PR week: warm up well, then go for your best set. Stop if form breaks down.</div>`;
  if (!prev) return "";
  const top = topRep(x), done = prev.e.sets.filter(st => st.reps != null);
  if (top && done.length >= nSets(x) && done.every(st => st.reps >= top)) return `<div class="hint up">You hit ${top} reps on every set last time. Add a little weight today (about 5 lb).</div>`;
  return "";
}

let wDraft = null, wClient = null;
function openWorkout(c, dayIdx) {
  const day = S.plan.days[dayIdx]; wClient = c;
  const pr = S.plan.program, wk = progWeek(pr), inProg = pr && wk >= 1 && wk <= pr.weeks;
  const base = day.items.map(x0 => itemForWeek(x0, pr, wk)), where = getWhere();
  wDraft = { clientId: c.id, date: todayISO(), dayName: day.name || `Day ${dayIdx + 1}`, note: "", program: inProg ? progKey(pr) : "", week: inProg ? wk : null, base, where,
    entries: base.map(x0 => placeItem(x0, where)).map(x => ({ name: x.name, ref: x.ref || "", target: [x.sets ? `${x.sets} ×` : "", x.reps || ""].join(" ").trim() + (x.rir ? ` · ${x.rir} in the tank` : ""), timed: isTimed(x), done: false,
      sets: isTimed(x) ? [] : Array.from({ length: nSets(x) }, () => ({ lb: "", reps: "" })), plan: x })) };
  $("#wTitle").textContent = (wDraft.week ? `Week ${wDraft.week} · ` : "") + wDraft.dayName;
  $("#wSub").textContent = S.isTrainer ? `Logging for ${firstName(c.name)}` : "Log each set as you go. Leave a set blank if you skipped it.";
  $("#w-date").value = wDraft.date; $("#w-date").max = todayISO(); $("#w-note").value = ""; $("#wErr").textContent = "";
  drawWorkout(); stopRest(); $("#dlgWorkout").showModal(); keepAwake();
}
/* Switch an open workout between gym and home; sets already typed stay where they are. */
function switchWhere(where) {
  if (wDraft.where === where) return;
  wDraft.where = where; setWhere(where);
  wDraft.entries = wDraft.entries.map((e, i) => { const x = placeItem(wDraft.base[i], where);
    return { ...e, name: x.name, ref: x.ref || "", target: [x.sets ? `${x.sets} ×` : "", x.reps || ""].join(" ").trim() + (x.rir ? ` · ${x.rir} in the tank` : ""), timed: isTimed(x), plan: x,
      sets: isTimed(x) ? [] : (e.sets.length ? e.sets : Array.from({ length: nSets(x) }, () => ({ lb: "", reps: "" }))) }; });
  drawWorkout(); render();
}
function drawWorkout() {
  const ws = $("#wWhere"); if (ws) ws.outerHTML = whereSeg("wWhere", wDraft.where); else $("#wList").insertAdjacentHTML("beforebegin", whereSeg("wWhere", wDraft.where));
  $$("#wWhere [data-where]").forEach(b => b.onclick = () => switchWhere(b.dataset.where));
  $("#wList").innerHTML = wDraft.entries.map((e, ei) => {
    const prev = lastFor(e.name), x = e.plan;
    const last = prev ? `<div class="wlast">Last time (${fmtD(prev.w.date)}): <b>${prev.e.sets.filter(st => st.reps != null).map(fmtSet).join(", ")}</b></div>` : "";
    const head = `<div class="wex-h"><div class="wgrow"><div class="wname">${esc(e.name)}</div><div class="wtarget">Target ${esc(e.target)}${x.rest ? ` · rest ${esc(x.rest)}` : ""}</div></div><div class="wex-a">${refUrl(e.ref) ? `<a class="plink" href="${refUrl(e.ref)}" target="_blank" rel="noopener">Form →</a>` : ""}${e.timed ? "" : `<button type="button" class="restbtn" data-rest="${ei}" aria-label="Start ${fmtClock(restSecs(x.rest))} rest timer">Rest ${fmtClock(restSecs(x.rest))}</button>`}</div></div>${exPics(e.name, e.ref)}`;
    if (e.timed) return `<div class="wex">${head}${x.note ? `<div class="pnote">${esc(x.note)}</div>` : ""}<label class="wdone"><input type="checkbox" data-done="${ei}"${e.done ? " checked" : ""}> Done</label></div>`;
    const ph = prev ? prev.e.sets.filter(st => st.lb != null).map(st => st.lb) : [];
    const rows = e.sets.map((st, si) => `<div class="wset"><span class="snum">Set ${si + 1}</span>
      <label class="wf"><input type="number" inputmode="decimal" step="2.5" min="0" max="2000" data-e="${ei}" data-s="${si}" enterkeyhint="next" data-k="lb" value="${esc(st.lb)}" placeholder="${ph[si] ?? ph[ph.length - 1] ?? ""}" aria-label="${esc(e.name)} set ${si + 1} weight"><span>lb</span></label>
      <label class="wf"><input type="number" inputmode="numeric" step="1" min="0" max="200" data-e="${ei}" data-s="${si}" data-k="reps" value="${esc(st.reps)}" placeholder="${topRep(x) ?? ""}" aria-label="${esc(e.name)} set ${si + 1} reps"><span>reps</span></label></div>`).join("");
    return `<div class="wex">${head}${x.note ? `<div class="pnote">${esc(x.note)}</div>` : ""}${last}${progressHint(x, prev)}${rows}<button type="button" class="linkbtn addset" data-addset="${ei}">+ Add a set</button></div>`;
  }).join("");
}
$("#wList").addEventListener("input", ev => {
  const t = ev.target;
  if (t.dataset.k) wDraft.entries[+t.dataset.e].sets[+t.dataset.s][t.dataset.k] = t.value;
  if (t.dataset.done != null) wDraft.entries[+t.dataset.done].done = t.checked;
});
/* A weight carries down to the later sets of the same exercise (until you type a different one there). */
$("#wList").addEventListener("change", ev => {
  const t = ev.target; if (t.dataset.k !== "lb") return;
  const ei = +t.dataset.e, si = +t.dataset.s, e = wDraft.entries[ei];
  e.autoLb = e.autoLb || {}; delete e.autoLb[si];
  for (let k = si + 1; k < e.sets.length; k++) {
    if (e.sets[k].lb !== "" && !e.autoLb[k]) break;
    e.sets[k].lb = t.value; e.autoLb[k] = true;
    const inp = document.querySelector(`#wList input[data-e="${ei}"][data-s="${k}"][data-k="lb"]`); if (inp) inp.value = t.value;
  }
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
/* Tapping ✓ on the keyboard after a weight jumps to that set's reps; after reps, to the next empty box. */
$("#wList").addEventListener("focusout", ev => {
  const t = ev.target;
  if (!t.dataset || !t.dataset.k || t.value === "" || (ev.relatedTarget && ev.relatedTarget.matches && ev.relatedTarget.matches("[data-k]"))) return;
  const all = $$("#wList input[data-k]"), i = all.indexOf(t);
  const next = all.slice(i + 1).find(x => x.value === "");
  if (!next) return;
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "center", behavior: "smooth" });
});
$("#wList").addEventListener("keydown", ev => {
  if (ev.key !== "Enter" || !ev.target.dataset || !ev.target.dataset.k) return;
  ev.preventDefault();
  const all = $$("#wList input[data-k]"), next = all.slice(all.indexOf(ev.target) + 1).find(x => x.value === "");
  if (next) { next.focus({ preventScroll: true }); next.scrollIntoView({ block: "center", behavior: "smooth" }); } else ev.target.blur();
});
$("#wList").addEventListener("click", ev => { const r = ev.target.closest("[data-rest]"); if (r) { const e = wDraft.entries[+r.dataset.rest]; startRest(restSecs(e.plan.rest), `Rest: ${e.name}`); } });
$("#wList").addEventListener("click", ev => { const b = ev.target.closest("[data-addset]"); if (!b) return; const e = wDraft.entries[+b.dataset.addset]; if (e.sets.length < 12) { const lastLb = e.sets.length ? e.sets[e.sets.length - 1].lb : ""; e.sets.push({ lb: lastLb, reps: "" }); if (lastLb !== "") { e.autoLb = e.autoLb || {}; e.autoLb[e.sets.length - 1] = true; } drawWorkout(); } });
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
    const before = S.workouts.slice();
    await api.addWorkout({ clientId: wClient.id, date, dayName: wDraft.dayName, entries, note: $("#w-note").value.trim(), program: wDraft.program || null });
    $("#dlgWorkout").close(); await loadWorkouts();
    const sets = entries.reduce((a, e) => a + e.sets.length, 0);
    const prevBest = liftHistory(before), prs = entries.map(e => { const v = bestE1(e), h = prevBest[e.name]; return v && h && h.length && v > Math.max(...h.map(p => p.e1)) + 0.01 ? { name: e.name, v } : null; }).filter(Boolean);
    if (prs.length) toast(`🏆 New PR${prs.length > 1 ? "s" : ""}! ${prs.map(p => `${p.name}: ${Math.round(p.v)} lb est. max`).join(" · ")}`);
    else toast(S.isTrainer ? `Workout logged for ${firstName(wClient.name)}` : `Workout saved: ${entries.length} exercises, ${sets} sets. Nice work!`);
    render();
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
const RT = { end: 0, iv: null, done: false, lastTick: null };
let audioCtx = null;
/* Short tick for the last 5 seconds of rest. */
function tick(final) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime;
    /* A soft, clear tick around 1 kHz: easy to hear in earbuds without being harsh. */
    o.type = "sine"; o.frequency.value = final ? 1200 : 1000; o.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.setValueAtTime(0.12, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); o.start(t); o.stop(t + 0.18);
  } catch (_) {}
}
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    [0, 0.28, 0.56].forEach(t0 => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime + t0; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.21, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.start(t); o.stop(t + 0.22); });
  } catch (_) {}
}
function tickRest() {
  const left = (RT.end - Date.now()) / 1000, box = $("#rTimer");
  if (left <= 0 && !RT.done) {
    RT.done = true; clearInterval(RT.iv); RT.iv = null; setTimeout(() => toApp({ type: "restStop" }), 4000);
    box.classList.add("done"); $("#rtTime").textContent = "0:00"; $("#rtNext").textContent = "Time's up. Next set!";
    try { navigator.vibrate && navigator.vibrate([250, 120, 250]); } catch (_) {}
    beep(); return;
  }
  /* 5, 4, 3, 2, 1: a tick each second so you can get set for the next set. */
  const sec = Math.ceil(left);
  if (!RT.done && sec <= 5 && sec >= 1 && sec !== RT.lastTick) { RT.lastTick = sec; tick(false); try { navigator.vibrate && navigator.vibrate(60); } catch (_) {} }
  box.classList.toggle("final", !RT.done && sec <= 5);
  if (!RT.done) { $("#rtTime").textContent = fmtClock(left); $("#rtBar").style.width = Math.max(0, Math.min(100, left / RT.total * 100)) + "%"; }
}
function startRest(sec, next) {
  toApp({ type: "restStart", seconds: Math.round(sec), next: next || "Next set" });
  // A user gesture is happening right now, so the audio can be unlocked for the beep later.
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === "suspended") audioCtx.resume(); } catch (_) {}
  RT.end = Date.now() + sec * 1000; RT.total = sec; RT.done = false; RT.lastTick = null;
  const box = $("#rTimer"); box.hidden = false; box.classList.remove("done");
  $("#rtNext").textContent = next || "Rest";
  clearInterval(RT.iv); RT.iv = setInterval(tickRest, 250); tickRest();
}
function adjustRest(d) {
  setTimeout(() => { if (!RT.done && RT.iv) toApp({ type: "restStart", seconds: Math.round((RT.end - Date.now()) / 1000), next: $("#rtNext").textContent }); }, 0);
  if (RT.done) { startRest(Math.max(15, d), $("#rtNext").textContent === "Time's up. Next set!" ? "Extra rest" : $("#rtNext").textContent); return; }
  RT.end = Math.max(Date.now() + 1000, RT.end + d * 1000); RT.lastTick = null; RT.total = Math.max(RT.total, (RT.end - Date.now()) / 1000); tickRest();
}
function stopRest() { toApp({ type: "restStop" }); clearInterval(RT.iv); RT.iv = null; RT.done = false; const box = $("#rTimer"); if (box) { box.hidden = true; box.classList.remove("done"); } }
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
  const target = S.plan ? trainDays(S.plan.days) * 4 : null;
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
