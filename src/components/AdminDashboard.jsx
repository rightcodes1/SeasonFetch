import { useEffect, useState } from 'react';
import { apiFetch } from '../services/api.js';

async function getAuthHeaders(supabase) {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token || ''}` };
}

export default function AdminDashboard({ supabase, onClose }) {
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [view, setView] = useState('users');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [actionUser, setActionUser] = useState(null);

  async function load() {
    setBusy(true); setError('');
    try {
      const headers = await getAuthHeaders(supabase);
      const [usersResponse, logsResponse] = await Promise.all([apiFetch('/api/admin/users', { headers }), apiFetch('/api/admin/audit-logs?limit=50', { headers })]);
      const usersData = await usersResponse.json();
      const logsData = await logsResponse.json();
      if (!usersResponse.ok) throw new Error(usersData.error || 'Unable to load users.');
      if (!logsResponse.ok) throw new Error(logsData.error || 'Unable to load audit logs.');
      setUsers(usersData.users || []); setLogs(logsData.logs || []);
    } catch (loadError) { setError(loadError.message); } finally { setBusy(false); }
  }

  useEffect(() => { load(); }, []);

  async function toggleSuspension(user) {
    const shouldSuspend = !user.suspension?.suspended;
    const reason = shouldSuspend ? window.prompt('Reason for suspension:', 'Administrative review') : '';
    if (shouldSuspend && reason === null) return;
    setActionUser(user.id); setError('');
    try {
      const headers = { ...(await getAuthHeaders(supabase)), 'content-type': 'application/json' };
      const response = await apiFetch(`/api/admin/users/${user.id}/suspension`, { method: 'POST', headers, body: JSON.stringify({ suspended: shouldSuspend, reason }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Suspension action failed.');
      await load();
    } catch (actionError) { setError(actionError.message); } finally { setActionUser(null); }
  }

  return <div className="admin-overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="admin-panel admin-panel-wide" role="dialog" aria-modal="true" aria-labelledby="admin-title">
      <div className="admin-heading"><div><span className="section-kicker">ADMIN CONSOLE · FULL ACCESS</span><h2 id="admin-title">SeasonFetch control room</h2><p>Actions are protected by a verified Supabase access token, the admin role, RLS, and audit logging.</p></div><button className="account-close" onClick={onClose} aria-label="Close admin dashboard">×</button></div>
      <div className="admin-tabs"><button className={view === 'users' ? 'active' : ''} onClick={() => setView('users')}>User directory</button><button className={view === 'logs' ? 'active' : ''} onClick={() => setView('logs')}>Audit logs</button><button className="secondary-button admin-refresh" onClick={load}>Refresh</button></div>
      {error && <p className="account-error">{error}</p>}
      {busy ? <div className="admin-loading"><span className="spinner spinner-dark" /> Loading protected admin data…</div> : view === 'users' ? <div className="admin-table">{users.map(user => <div className="admin-user-row" key={user.id}><div><strong>{user.display_name || user.username || 'Unnamed profile'}</strong><span>{user.username ? `@${user.username}` : user.id}</span></div><span className={user.suspension?.suspended ? 'admin-pill suspended' : 'admin-pill'}>{user.suspension?.suspended ? 'Suspended' : 'Active'}</span><button className="secondary-button small-button" disabled={actionUser === user.id} onClick={() => toggleSuspension(user)}>{actionUser === user.id ? 'Saving…' : user.suspension?.suspended ? 'Unsuspend' : 'Suspend'}</button></div>)}{!users.length && <p className="admin-empty">No profiles found yet.</p>}</div> : <div className="admin-table">{logs.map(log => <div className="admin-log-row" key={log.id}><strong>{log.action}</strong><span>Target: {log.target_user_id || 'system'}</span><time>{new Date(log.created_at).toLocaleString()}</time><code>{JSON.stringify(log.metadata || {})}</code></div>)}{!logs.length && <p className="admin-empty">No audit events recorded yet.</p>}</div>}
    </section>
  </div>;
}
