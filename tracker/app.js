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
    if (p) {
      const dd = Math.max(days(p.e.date, r.e.date), 1);
      if (p.e.waist && r.e.waist && Math.abs(r.e.waist - p.e.waist) >= 1 && dd <= 14) r.flags.push(`Waist moved ${sgn(r.e.waist - p.e.waist)} in over ${dd} days. Re-tape to confirm.`);
      if (p.e.neck && r.e.neck && Math.abs(r.e.neck - p.e.neck) >= 0.75) r.flags.push(`Neck changed ${sgn(r.e.neck - p.e.neck)} in. Neck rarely moves this much; check tape placement.`);
      if (p.e.weight && r.e.weight && dd <= 21 && Math.abs(r.e.weight - p.e.weight) / p.e.weight / (dd / 7) > 0.02) r.flags.push(`Weight changed ${sgn(r.e.weight - p.e.weight)} lb in ${dd} days. Check timing, meals and water.`);
    }
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
const fromClientRow = r => ({ id: r.id, userId: r.user_id, email: r.email, name: r.name, sex: r.sex, dob: r.dob, height: num(r.height_in), goal: r.goal });
const toClientRow = c => ({ email: c.email, name: c.name, sex: c.sex, dob: c.dob || null, height_in: c.height, goal: c.goal || null });
const fromCheckinRow = r => ({ id: r.id, clientId: r.client_id, date: r.date, weight: num(r.weight_lb), waist: num(r.waist_in), neck: num(r.neck_in), hip: num(r.hip_in), omron: num(r.omron_bf), photoFront: r.photo_front, photoSide: r.photo_side, note: r.note, enteredBy: r.entered_by, createdAt: r.created_at });
const toCheckinRow = e => ({ client_id: e.clientId, date: e.date, weight_lb: e.weight, waist_in: e.waist, neck_in: e.neck, hip_in: e.hip, omron_bf: e.omron, photo_front: e.photoFront, photo_side: e.photoSide, note: e.note });

function supaApi(sb) {
  const chk = ({ data, error }) => { if (error) throw error; return data; };
  return {
    async isTrainer(userId) { return !!chk(await sb.from("trainers").select("user_id").eq("user_id", userId).maybeSingle()); },
    async listClients() { return chk(await sb.from("clients").select("*").order("name")).map(fromClientRow); },
    async listCheckins(clientId) { return chk(await sb.from("checkins").select("*").eq("client_id", clientId).order("date").order("created_at")).map(fromCheckinRow); },
    async saveClient(c, id) {
      const row = toClientRow(c);
      const d = id ? chk(await sb.from("clients").update(row).eq("id", id).select().single()) : chk(await sb.from("clients").insert(row).select().single());
      return fromClientRow(d);
    },
    async deleteClient(id) {
      const files = chk(await sb.storage.from(BUCKET).list(id, { limit: 1000 })) || [];
      if (files.length) await sb.storage.from(BUCKET).remove(files.map(f => id + "/" + f.name));
      chk(await sb.from("clients").delete().eq("id", id));
    },
    async addCheckin(e) { return fromCheckinRow(chk(await sb.from("checkins").insert(toCheckinRow(e)).select().single())); },
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
    }
  };
}

function demoApi(asClient) {
  const clients = [
    { id: "c1", userId: asClient ? "me" : "u1", email: "sample.client@example.com", name: "Sample Client", sex: "female", dob: "1990-04-12", height: 65, goal: "Lose fat, keep lean mass" },
    { id: "c2", userId: null, email: "sample.two@example.com", name: "Sample Client Two", sex: "male", dob: "1984-11-02", height: 70, goal: "Recomp for summer" }
  ];
  const raw = [["c1","2026-06-08",162.4,31.5,13.5,39.8,30.1],["c1","2026-06-22",161.0,31.2,13.5,39.6],["c1","2026-07-06",159.8,30.9,13.4,39.4],["c1","2026-07-20",158.6,30.6,13.4,39.3,28.9],["c1","2026-08-03",157.9,30.4,13.4,39.1],["c1","2026-08-17",156.8,30.1,13.3,38.9],["c1","2026-08-31",156.2,29.9,13.3,38.8,27.4],["c1","2026-09-14",155.5,29.7,13.3,38.6],["c1","2026-09-28",155.1,29.3,13.3,38.5],
               ["c2","2026-07-15",212.6,40.5,16.2,null,26.8],["c2","2026-07-29",210.9,40.1,16.2,null],["c2","2026-08-05",210.2,38.8,16.1,null],["c2","2026-08-19",208.4,39.6,16.2,null]];
  let entries = raw.map((r, i) => ({ id: "e" + i, clientId: r[0], date: r[1], weight: r[2], waist: r[3], neck: r[4], hip: r[5], omron: r[6] ?? null, note: i === 0 ? "Baseline at the gym" : null, enteredBy: (r[6] != null || !asClient) ? "trainer" : "me", createdAt: String(i).padStart(4, "0") }));
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
    async photoUrls(paths) { const m = {}; paths.forEach(p => { if (photos[p]) m[p] = photos[p]; }); return m; }
  };
}

/* ---------- state ---------- */
const CFG = window.TRACKER_CONFIG || {};
const params = new URLSearchParams(location.search);
const DEMO = params.has("demo");
const DEMO_CLIENT = params.get("demo") === "client";
const CONFIGURED = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && !/PASTE/.test(CFG.supabaseAnonKey));
const TRAINER = CFG.trainerName || "your trainer";
const IS_HOME_APP = window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
let sb = null, api = null;
const S = { me: null, isTrainer: false, clients: [], sel: null, checkins: [], urls: {}, screen: "loading", metric: "bf", view: "front", cmpA: null, cmpB: null, overlay: false, fade: 50, authEmail: "", authStep: "email" };
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
  h += `<span class="who" title="${esc(S.me?.email)}">${esc(S.me?.email)}</span><button class="btn ghost sm" id="signOut" type="button">${DEMO ? "Exit demo" : "Sign out"}</button>`;
  el.innerHTML = h;
  const p = $("#clientPick"); if (p) p.onchange = () => selectClient(p.value);
  const a = $("#addClient"); if (a) a.onclick = () => openClient(null);
  $("#signOut").onclick = signOut;
}

/* ---------- screens ---------- */
function render() {
  renderBar();
  const app = $("#app");
  if (S.screen === "loading") { app.innerHTML = `<div class="skel"></div>`; return; }
  if (S.screen === "setup") { app.innerHTML = setupScreen(); return; }
  if (S.screen === "login") { app.innerHTML = loginScreen(); wireLogin(); return; }
  if (S.screen === "noaccess") { app.innerHTML = noAccessScreen(); return; }
  if (!S.clients.length) { app.innerHTML = welcome(); const b = $("#welcomeAdd"); if (b) b.onclick = () => openClient(null); return; }
  const c = client(); const s = series(c, S.checkins);
  app.innerHTML = `<div class="stack">${head(c, s)}${tiles(c, s)}${chartCard(s)}<div class="split">${logCard(c, s)}<div class="stack">${photoCard(s)}${summaryCard(c, s)}</div></div></div>`;
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
  <p>Sign in with the email you gave your trainer. We'll email you a sign-in link. There's no password to remember.</p>
  <form id="fEmail" novalidate><div class="field"><label for="a-email">Email</label><input id="a-email" type="email" autocomplete="email" inputmode="email" value="${esc(S.authEmail)}"></div>
  <div class="err" id="aErr"></div><button class="btn primary wide" id="aSend" type="submit">Email me a sign-in link</button></form></section>`;
}
function wireLogin() {
  const fe = $("#fEmail"), fc = $("#fCode");
  if (fe) fe.onsubmit = async ev => {
    ev.preventDefault();
    const email = $("#a-email").value.trim().toLowerCase(), err = $("#aErr"), btn = $("#aSend");
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
    if (error) err.textContent = "That code didn't work. It may have expired. Check the newest email or go back and request a new one.";
  };
  const back = $("#aBack"); if (back) back.onclick = () => { S.authStep = "email"; render(); };
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
    <div class="actions">${S.isTrainer ? `<button class="btn" id="editClient" type="button">Edit client</button>` : ""}<button class="btn primary" id="newEntry" type="button">${S.isTrainer ? "New check-in" : "Log check-in"}</button></div></div>
  <details class="how"><summary>How the estimate works</summary><p>Each check-in runs the US Navy tape formula on waist, neck${c.sex === "male" ? "" : ", hips"} and height. On gym days the Omron reading is compared with that number and the gap is saved. Home check-ins use the tape number plus the most recent gap. Omron readings swing with water, food and training, so they're taken at the same time of day, before a workout.</p></details>`;
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

const METRICS = { bf: { label: "Body fat", unit: "%", get: r => r.bf, span: 4 }, weight: { label: "Weight", unit: "lb", get: r => r.e.weight, span: 6 }, lean: { label: "Lean mass", unit: "lb", get: r => r.lean, span: 4 }, fat: { label: "Fat mass", unit: "lb", get: r => r.fat, span: 4 }, waist: { label: "Waist", unit: "in", get: r => r.e.waist, span: 2 } };
function chartCard(s) {
  if (!s.rows.length) return "";
  const m = METRICS[S.metric];
  return `<section class="card"><div class="card-h"><h2>${m.label} over time</h2>
    <div class="seg" role="group" aria-label="Metric">${Object.entries(METRICS).map(([k, v]) => `<button type="button" data-metric="${k}" aria-pressed="${k === S.metric}">${v.label}</button>`).join("")}</div></div>
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
    return `<tr><td>${fmtD(e.date, true)}${e.omron != null ? ` <span class="tag">GYM</span>` : ""}${r.flags.map(f => `<span class="flag">${ICON_WARN}<span>${esc(f)}</span></span>`).join("")}${e.note ? `<span class="note">${esc(e.note)}</span>` : ""}</td>
    <td>${f1(e.weight)}</td><td>${f1(e.waist)}</td><td>${f1(e.neck)}</td>${fem ? `<td>${f1(e.hip)}</td>` : ""}
    <td>${f1(r.tape)}</td><td>${e.omron != null ? f1(e.omron) : "–"}</td><td class="bfcell">${f1(r.bf)}</td><td>${f1(r.lean)}</td>
    <td>${canDelete(e) ? `<button type="button" class="btn ghost sm danger" data-del="${esc(e.id)}">Delete</button>` : ""}</td></tr>`; }).join("");
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
  await loadCheckins();
}

/* ---------- client dialog (trainer) ---------- */
let editing = null;
function openClient(c) {
  editing = c;
  $("#cTitle").textContent = c ? "Edit client" : "New client";
  $("#c-name").value = c?.name || ""; $("#c-email").value = c?.email || ""; $("#c-sex").value = c?.sex || "female"; $("#c-dob").value = c?.dob || "";
  $("#c-ft").value = c?.height ? Math.floor(c.height / 12) : ""; $("#c-in").value = c?.height ? Math.round((c.height % 12) * 2) / 2 : "";
  $("#c-goal").value = c?.goal || ""; $("#cErr").textContent = "";
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
  const d = { name, email, sex: $("#c-sex").value, dob: $("#c-dob").value || null, height: ft * 12 + inch, goal: $("#c-goal").value.trim() || null };
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
  $("#eTip").textContent = S.isTrainer ? "Measure at the same time of day as the last check-in, before eating or training. Tape snug, not tight." : "Weigh and measure first thing in the morning, before eating or training. Tape snug, not tight, in the same spots each time.";
  const ph = (id, v) => { $(id).placeholder = v ? "Last: " + f1(v) : ""; };
  ph("#e-weight", last?.e.weight); ph("#e-waist", last?.e.waist); ph("#e-neck", last?.e.neck); ph("#e-hip", last?.e.hip);
  livePreview(); $("#dlgEntry").showModal();
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
  const d = { clientId: c.id, date: $("#e-date").value || todayISO(), weight: num($("#e-weight").value), waist: num($("#e-waist").value), neck: num($("#e-neck").value), hip: c.sex === "male" ? null : num($("#e-hip").value), omron: S.isTrainer ? num($("#e-omron").value) : null, note: $("#e-note").value.trim() || null, photoFront: null, photoSide: null };
  if (d.date > todayISO()) { err.textContent = "The date can't be in the future."; return; }
  if (d.weight == null || d.weight < 50 || d.weight > 700) { err.textContent = "Add today's weight in pounds."; return; }
  const needTape = d.omron == null;
  if (needTape && (d.waist == null || d.neck == null || (c.sex !== "male" && d.hip == null))) { err.textContent = c.sex === "male" ? "Add waist and neck measurements." : "Add waist, neck and hip measurements."; return; }
  if (d.waist != null && d.neck != null && navy(c.sex, c.height, d.waist, d.neck, d.hip) == null && needTape) { err.textContent = "Those tape numbers don't give a valid estimate. Check waist and neck."; return; }
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
