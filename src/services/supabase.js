import { createClient } from '@supabase/supabase-js';

const supabaseUrl = String(
  import.meta.env.VITE_SUPABASE_URL
  || (typeof __SEASONFETCH_SUPABASE_URL__ !== 'undefined' ? __SEASONFETCH_SUPABASE_URL__ : '')
).trim();

const supabaseAnonKey = String(
  import.meta.env.VITE_SUPABASE_ANON_KEY
  || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || (typeof __SEASONFETCH_SUPABASE_KEY__ !== 'undefined' ? __SEASONFETCH_SUPABASE_KEY__ : '')
).trim();

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export const authConfigured = Boolean(supabase);
