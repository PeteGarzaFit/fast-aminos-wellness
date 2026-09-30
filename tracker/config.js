// Supabase connection for the Progress Tracker.
// The anon/publishable key is meant to be public: the database's security
// rules (supabase/schema.sql) decide what each signed-in person can see.
// Never put the service_role or secret key here.
window.TRACKER_CONFIG = {
  supabaseUrl: "https://zfkhkdkibuwpigpvsmkd.supabase.co",
  supabaseAnonKey: "PASTE_ANON_KEY_HERE",
  trainerName: "Pete"
};
