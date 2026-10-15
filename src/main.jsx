import { Component, StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AUTH_LINK, AUTH_STORAGE_KEY, supabase } from './lib/supabase';
import TenantAccess from './TenantPortal';
import OwnerLogin, { SetNewPassword } from './OwnerLogin';
import { BrandMark } from './ui';
import { launchMeter, registerPwa } from './lib/pwa';
import './styles.css';

// The owner console pulls in jsPDF/QR tooling; tenants scanning on a phone never download it.
const OwnerApp = lazy(() => import('./OwnerApp'));

registerPwa();

const tokenFromHash = () => {
  const m = location.hash.match(/^#\/m\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
};
// Installed app opened from the home screen: reopen the tenant's meter, if any.
const initialToken = () => tokenFromHash() || (location.hash ? null : launchMeter());

const START_TIMEOUT_MS = 10000;
const withTimeout = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
const reload = () => location.reload();
const signInAgain = () => {
  try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch { /* ignore */ }
  location.replace(location.pathname);
};

/** Start-up screen: the logo, and after a few seconds a way out instead of an endless wait. */
function LoadingScreen({ failed = false }) {
  const [slow, setSlow] = useState(failed);
  useEffect(() => { if (failed) return; const t = setTimeout(() => setSlow(true), 6000); return () => clearTimeout(t); }, [failed]);
  return <main className="center"><div className="loading-screen">
    <BrandMark />
    {slow && <div className="loading-help">
      <p className="muted">{failed ? 'Couldn\'t load RentSlate Meter. Check your internet connection.' : 'Still connecting… This is taking longer than usual.'}</p>
      <div className="row-actions center-actions">
        <button onClick={reload}>Retry</button>
        <button className="secondary" onClick={signInAgain}>Sign in again</button>
      </div>
    </div>}
  </div></main>;
}

/** Shows LoadingScreen with Retry if the owner console fails to download (e.g. network drop). */
class LoadBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <LoadingScreen failed /> : this.props.children; }
}

function App() {
  const [token, setToken] = useState(initialToken);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(AUTH_LINK.recovery);

  useEffect(() => {
    const onHash = () => setToken(tokenFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (token) return;
    // Never wait forever for the saved sign-in to be restored (it may need a token
    // refresh over a slow network). If it finishes later, onAuthStateChange
    // below still signs the owner in.
    withTimeout(supabase.auth.getSession(), START_TIMEOUT_MS)
      .then(res => { if (res?.data?.session) setSession(res.data.session); setLoading(false); })
      .catch(() => setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') setRecovery(false);
    });
    return () => data.subscription.unsubscribe();
  }, [token]);

  if (token) return <TenantAccess key={token} token={token} />;
  if (loading) return <LoadingScreen />;
  if (recovery && session) return <SetNewPassword onDone={() => setRecovery(false)} />;
  return session
    ? <LoadBoundary><Suspense fallback={<LoadingScreen />}><OwnerApp key={session.user.id} /></Suspense></LoadBoundary>
    : <OwnerLogin linkError={AUTH_LINK.error} />;
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
