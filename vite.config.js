import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Expose only public Supabase URL and public anon/publishable keys (never secret/service-role keys)
  // so Vercel Preview/Production builds work whether configured with VITE_, NEXT_PUBLIC_, or bare Supabase integration names.
  const publicSupabaseUrl = String(
    env.VITE_SUPABASE_URL
    || env.NEXT_PUBLIC_SUPABASE_URL
    || env.SUPABASE_URL
    || ""
  ).trim();
  const publicSupabaseKey = String(
    env.VITE_SUPABASE_ANON_KEY
    || env.VITE_SUPABASE_PUBLISHABLE_KEY
    || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || env.SUPABASE_ANON_KEY
    || env.SUPABASE_PUBLISHABLE_KEY
    || ""
  ).trim();

  return {
    plugins: [react()],
    define: {
      __SEASONFETCH_SUPABASE_URL__: JSON.stringify(publicSupabaseUrl),
      __SEASONFETCH_SUPABASE_KEY__: JSON.stringify(publicSupabaseKey)
    },
    server: {
      host: "0.0.0.0",
      port: 3000,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3001",
          changeOrigin: true
        }
      }
    }
  };
});
