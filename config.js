/* Isi URL project dan public anon/publishable key Supabase serta URL Cloudflare Worker. Jangan gunakan Supabase service_role/secret key di browser. */
window.APP_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabaseAnonKey: "YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY",
  fileApiUrl: "https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev"
};
