import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AUTH_LINK, supabase } from './lib/supabase';
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
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') setRecovery(false);
    });
    return () => data.subscription.unsubscribe();
  }, [token]);

  if (token) return <TenantAccess key={token} token={token} />;
  if (loading) return <main className="center"><BrandMark /></main>;
  if (recovery && session) return <SetNewPassword onDone={() => setRecovery(false)} />;
  return session ? <Suspense fallback={<main className="center"><BrandMark /></main>}><OwnerApp key={session.user.id} /></Suspense> : <OwnerLogin linkError={AUTH_LINK.error} />;
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
