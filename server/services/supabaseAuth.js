import { createRemoteJWKSet, jwtVerify } from 'jose';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const jwks = supabaseUrl ? createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)) : null;

export function getBearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export async function verifySupabaseToken(token) {
  if (!jwks || !supabaseUrl || !token) throw new Error('Authentication is not configured.');
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `${supabaseUrl}/auth/v1`,
    audience: 'authenticated'
  });
  if (!payload.sub) throw new Error('Invalid Supabase access token.');
  return payload;
}

export async function supabaseRequest(path, token, options = {}) {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase server integration is not configured.');
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || 'Supabase request failed.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function supabaseRpc(name, args, token) {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase server integration is not configured.');
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || 'Supabase RPC failed.');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function isAccountSuspended(userId, token) {
  const rows = await supabaseRequest(
    `account_suspensions?select=suspended&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    token
  );
  return Array.isArray(rows) && rows.some(row => row.suspended === true);
}

export function createRequireUser({ verifyToken = verifySupabaseToken, checkSuspension = isAccountSuspended } = {}) {
  return async function requireUserMiddleware(req, res, next) {
    const token = getBearerToken(req);
    let user;
    try {
      user = await verifyToken(token);
      if (!user?.sub) throw new Error('Invalid Supabase access token.');
    } catch {
      return res.status(401).json({ error: 'A valid Supabase access token is required.' });
    }

    try {
      if (await checkSuspension(user.sub, token)) {
        return res.status(403).json({ error: 'Account suspended.' });
      }
    } catch (error) {
      console.error('Account status verification failed:', error.message);
      return res.status(503).json({ error: 'Unable to verify account status. Please try again shortly.' });
    }

    req.supabaseToken = token;
    req.supabaseUser = user;
    return next();
  };
}

export const requireUser = createRequireUser();
