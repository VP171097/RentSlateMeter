import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { supabase } from './lib/supabase';
import { APP_NAME, TAGLINE } from './lib/format';
import TenantAccess from './TenantPortal';
import { BrandMark, ThemeToggle } from './ui';
import './styles.css';

// The owner console pulls in jsPDF/QR tooling; tenants scanning on a phone never download it.
const OwnerApp = lazy(() => import('./OwnerApp'));

const tokenFromHash = () => {
  const m = location.hash.match(/^#\/m\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
};

function App() {
  const [token, setToken] = useState(tokenFromHash);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onHash = () => setToken(tokenFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (token) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [token]);

  if (token) return <TenantAccess key={token} token={token} />;
  if (loading) return <main className="center"><BrandMark /></main>;
  return session ? <Suspense fallback={<main className="center"><BrandMark /></main>}><OwnerApp key={session.user.id} /></Suspense> : <Login />;
}

function Login() {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [signup, setSignup] = useState(false);
  const [msg, setMsg] = useState(null), [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setMsg(null); setBusy(true);
    const r = signup ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (r.error) setMsg({ ok: false, text: r.error.message });
    else if (signup && !r.data.session) setMsg({ ok: true, text: 'Check your email to confirm the administrator account, then sign in.' });
  };
  return <main className="center page-fade-in"><div className="auth-shell">
    <div className="scan-top"><BrandMark /><ThemeToggle /></div>
    <form className="card login" onSubmit={submit}>
      <div className="eyebrow">Owner console</div>
      <h1>{signup ? 'Create administrator' : 'Welcome back.'}</h1>
      <p className="muted">{signup ? 'The first account created becomes the property administrator.' : 'Sign in to manage meters, readings and bills.'}</p>
      <input required type="email" autoComplete="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
      <input required minLength={6} type="password" autoComplete={signup ? 'new-password' : 'current-password'} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
      {msg && <div className={msg.ok ? 'success' : 'alert'}>{msg.text}</div>}
      <button disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button>
      <button type="button" className="secondary" onClick={() => { setSignup(!signup); setMsg(null); }}>{signup ? 'Sign in instead' : 'Create administrator'}</button>
    </form>
    <p className="footer-note">{APP_NAME} · {TAGLINE}</p>
  </div></main>;
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
