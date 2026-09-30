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

### 3. Put the sign-in code in the emails
Clients sign in with a 6-digit code. The code works inside the home-screen app;
a link in the email opens the phone's browser instead.

**Authentication → Emails (Email Templates)**. Edit **Magic Link** and
**Confirm signup** so each includes the code. For example:

```html
<h2>Your FAST AMINOS WELLNESS sign-in code</h2>
<p>Enter this code in the Progress Tracker:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>Or <a href="{{ .ConfirmationURL }}">tap here to sign in</a>.</p>
```

### 4. Add the public key
Project Settings → **API** (or **API Keys**). Copy the **anon / publishable** key
into `tracker/config.js` as `supabaseAnonKey`. Never use the `service_role` or
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

## Before inviting many clients
Supabase's built-in email sender only allows a few emails per hour. Before you
roll this out widely, connect your own sender (for example Resend or Postmark)
under **Project Settings → Authentication → SMTP Settings**.

## Privacy
- Each client sees only their own records and photos. The rules are in
  `supabase/schema.sql`.
- Photos are stored in a private bucket and shown through links that expire.
- Deleting a client deletes their check-ins and photos.
