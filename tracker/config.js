// Supabase connection for the Progress Tracker.
// The anon/publishable key is meant to be public: the database's security
// rules (supabase/schema.sql) decide what each signed-in person can see.
// Use the publishable key (sb_publishable_...) or the legacy anon key.
// Never put the service_role or secret key here.
window.TRACKER_CONFIG = {
  supabaseUrl: "https://zfkhkdkibuwpigpvsmkd.supabase.co",
  supabaseAnonKey: "sb_publishable_gqGqZmz4nmN49Z8IxyhCWQ_MRA7tGFD",
  trainerName: "Pete"
};
