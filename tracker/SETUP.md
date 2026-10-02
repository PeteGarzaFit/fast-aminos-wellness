# Progress Tracker setup

The tracker lives at `/tracker/` on the site. It's plain HTML, CSS and JavaScript,
so it deploys the same way as the homepage. Supabase handles sign-in, data and photos.

Try it without setup: open `/tracker/?demo` (trainer view) or `/tracker/?demo=client`
(client view). Demo mode uses sample data and saves nothing.

## One-time setup (about 10 minutes)

### 1. Create the database
Supabase dashboard → **SQL Editor** → **New query**. Paste all of
`supabase/schema.sql` and click **Run**. It is safe to run again later.

### 2. Allow sign-in links back to the site
**Authentication → URL Configuration**
- **Site URL:** `https://fastaminoswellness.com/tracker/`
- **Redirect URLs:** add `https://fastaminoswellness.com/tracker/` and
  `https://www.fastaminoswellness.com/tracker/`

### 3. Sign-in emails
Clients sign in by tapping a link Supabase emails them. That works right away with
Supabase's built-in email, which is fine for trying it with a few clients.

**Recommended before rolling out (needed for iPhone home-screen use):** connect your own
email sender. Supabase's built-in sender only allows a few emails per hour, and on
free projects it doesn't let you edit the email templates.

1. Create a free account at resend.com (3,000 emails a month) and verify
   `fastaminoswellness.com` there.
2. Supabase → **Authentication → Emails → SMTP Settings**: turn on custom SMTP and
   enter Resend's details (host `smtp.resend.com`, port `465`, user `resend`,
   password = your Resend API key, sender e.g. `tracker@fastaminoswellness.com`).
3. **Authentication → Emails → Templates**: edit **Magic Link** and
   **Confirm signup** so each shows a 6-digit code as well as the link:

```html
<h2>Your FAST AMINOS WELLNESS sign-in</h2>
<p>Enter this code in the Progress Tracker:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>Or <a href="{{ .ConfirmationURL }}">tap here to sign in</a>.</p>
```

Why the code matters: on iPhone, an app added to the home screen keeps its own
sign-in, separate from Safari. Tapping an email link signs the client in to Safari,
not the home-screen app. Typing the code signs in the app itself.

### 4. Add the public key
Project Settings → **API Keys**. Copy the **publishable** key (`sb_publishable_...`),
or the legacy **anon public** key, into `tracker/config.js` as `supabaseAnonKey`. Never use the `service_role` or
secret key.

### 5. Make yourself the trainer
Open `/tracker/`, sign in with your email once, then run this in the SQL Editor
with your email:

```sql
insert into public.trainers (user_id)
select id from auth.users where lower(email) = lower('YOUR_EMAIL')
on conflict do nothing;
```

Reload the tracker. You'll see **Add client**.

## Update: workout plans and check-in replies (October 2026)
Run this once to turn on workout plans and coach replies. It keeps every client,
check-in and photo you already have.

1. Supabase dashboard → **SQL Editor** → **New query**.
2. Paste **all** of `supabase/schema.sql` and click **Run**. "Already exists, skipping"
   notices are normal.
3. Reload `/tracker/`. Each client now has a **Workout plan** section, and every
   check-in has a **Reply** link.

Until this runs, the tracker keeps working as before. You'll just see a note in the
Workout plan section asking for the update.

**Workout plans:** open a client → **Build plan** (or **Edit plan**). Add days, then fill a
day from any gym or home workout on the site, or type your own exercises. Sets, reps,
rest and a note are all editable. The client sees the plan when they sign in, with
links to each exercise's photos on the site.

**Templates:** in the plan builder, **Start from a template** fills in a saved program, which you can
then adjust for that client. **Save as template** stores the plan under its name for future clients;
saving again with the same name updates it. "Phase 1: Build the Base (4-day Upper/Lower)" comes
preloaded. Templates are only visible to you. (Added with a second database update: run
`supabase/schema.sql` again the same way.)

**Replies:** tap **Reply** under any check-in. Your note shows under that check-in, and
your latest reply appears at the top of the client's tracker. Only you can write replies.

## Everyday use
1. **Add client** with their name, email, sex, date of birth and height.
2. At the gym, do their **baseline**: weight, tape measurements, the Omron reading
   and photos. The app saves the gap between the Omron and the tape formula.
3. Tell the client to open `fastaminoswellness.com/tracker`, sign in with that email,
   and add it to their home screen:
   - iPhone: Share button → **Add to Home Screen**
   - Android: menu (⋮) → **Add to Home screen** or **Install app**
4. They log weekly check-ins at home. Only you can enter Omron readings.
5. Recalibrate with a new Omron reading every 4–6 weeks.

## Privacy
- Each client sees only their own records and photos. The rules are in
  `supabase/schema.sql`.
- Photos are stored in a private bucket and shown through links that expire.
- Deleting a client deletes their check-ins and photos.
