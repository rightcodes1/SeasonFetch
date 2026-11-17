const CONTROLS = [
  { eyebrow: 'PEOPLE', title: 'User directory', copy: 'Review account status, profile visibility, and access changes.', action: 'Open users' },
  { eyebrow: 'PROFILES', title: 'Profile moderation', copy: 'Inspect public profiles and hide content that violates your rules.', action: 'Review profiles' },
  { eyebrow: 'AVATARS', title: 'Avatar studio assets', copy: 'Manage preset illustrations, frames, accent colors, and uploads.', action: 'Manage assets' },
  { eyebrow: 'SECURITY', title: 'Audit and sessions', copy: 'Track security events and revoke suspicious sessions.', action: 'View audit log' },
  { eyebrow: 'SYSTEM', title: 'Service health', copy: 'Check Supabase, Cinemeta, Torrentio, and Gemini integration status.', action: 'Run health check' }
];

export default function AdminDashboard({ onClose }) {
  return (
    <div className="admin-overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="admin-panel" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <div className="admin-heading">
          <div><span className="section-kicker">ADMIN CONSOLE · FULL ACCESS</span><h2 id="admin-title">SeasonFetch control room</h2><p>Administrative actions are restricted by Supabase authorization and never by client-provided user IDs.</p></div>
          <button className="account-close" onClick={onClose} aria-label="Close admin dashboard">×</button>
        </div>
        <div className="admin-status"><span className="admin-status-dot" /> Authenticated administrator <span>rightcodes1@gmail.com</span></div>
        <div className="admin-grid">
          {CONTROLS.map(control => <article className="admin-card" key={control.title}><span className="section-kicker">{control.eyebrow}</span><h3>{control.title}</h3><p>{control.copy}</p><button className="secondary-button" type="button">{control.action} <span aria-hidden="true">→</span></button></article>)}
        </div>
        <p className="admin-note">Destructive operations will require server-side admin checks and an audit record before they are enabled.</p>
      </section>
    </div>
  );
}
