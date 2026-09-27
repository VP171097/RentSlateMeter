import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, FileText, Lock, Mail, QrCode, ShieldCheck, UserRound, Zap } from 'lucide-react';
import { supabase } from './lib/supabase';
import { APP_NAME, TAGLINE } from './lib/format';
import { BrandMark, ThemeToggle } from './ui';

// Password reset / confirmation emails return here (the app root). Add this
// URL under Supabase → Authentication → URL Configuration → Redirect URLs.
export const AUTH_REDIRECT = location.origin + location.pathname;

export function validatePassword(pw) {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use at least one letter and one number.';
  return null;
}

export function friendlyAuthError(err) {
  const m = String(err?.message || err || '');
  if (/invalid login credentials/i.test(m)) return 'Incorrect email or password.';
  if (/email not confirmed/i.test(m)) return 'Confirm your email first. Check your inbox for the confirmation link.';
  if (/user already registered/i.test(m)) return 'An account with this email already exists. Sign in instead.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/failed to fetch|network/i.test(m)) return 'Could not reach the server. Check your connection.';
  if (/same.*password|should be different/i.test(m)) return 'Choose a password different from your current one.';
  return m || 'Something went wrong. Please try again.';
}

function Field({ icon, children }) {
  const Icon = icon;
  return <div className="field-icon"><Icon size={17} aria-hidden />{children}</div>;
}

export function PasswordInput({ value, onChange, placeholder = 'Password', autoComplete = 'current-password', autoFocus = false }) {
  const [show, setShow] = useState(false);
  return <Field icon={Lock}>
    <input required type={show ? 'text' : 'password'} autoComplete={autoComplete} autoFocus={autoFocus} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
    <button type="button" className="field-toggle" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
  </Field>;
}

function AuthLayout({ children }) {
  return <main className="auth-split page-fade-in">
    <aside className="auth-hero ledger-grid-bg">
      <BrandMark />
      <div className="auth-hero-copy">
        <div className="eyebrow">Owner console</div>
        <h2>Meter readings in. Bills out. Payments tracked.</h2>
        <ul>
          <li><QrCode size={17} />One permanent QR code per meter</li>
          <li><CheckCircle2 size={17} />Approve tenant readings with photo proof</li>
          <li><FileText size={17} />Branded PDF bills with UPI payment QR</li>
          <li><ShieldCheck size={17} />Owner-only access, private bill storage</li>
        </ul>
      </div>
      <p className="auth-hero-foot">{APP_NAME} · {TAGLINE}</p>
    </aside>
    <section className="auth-panel">
      <div className="auth-panel-top"><span className="auth-mobile-brand"><BrandMark /></span><ThemeToggle /></div>
      <div className="auth-form-wrap">{children}</div>
      <p className="footer-note">Tenants: scan the QR code on your meter to open your electricity account.</p>
    </section>
  </main>;
}

export default function OwnerLogin({ linkError }) {
  const [mode, setMode] = useState('signin'); // signin | setup | forgot
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [error, setError] = useState(linkError || ''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [canSetup, setCanSetup] = useState(false);

  // First-run only: offer owner account setup until an administrator exists.
  useEffect(() => {
    supabase.rpc('admin_exists').then(({ data, error }) => setCanSetup(!error && data === false));
  }, []);

  const switchMode = next => { setMode(next); setError(''); setNotice(''); setPassword(''); setConfirm(''); };

  const submit = async e => {
    e.preventDefault(); setError(''); setNotice('');
    const addr = email.trim().toLowerCase();
    if (mode === 'setup') {
      if (name.trim().length < 2) { setError('Enter your full name.'); return; }
      const pwError = validatePassword(password) || (password !== confirm ? 'Passwords do not match.' : null);
      if (pwError) { setError(pwError); return; }
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: addr, password });
        if (error) throw error;
      } else if (mode === 'setup') {
        const { data, error } = await supabase.auth.signUp({ email: addr, password, options: { emailRedirectTo: AUTH_REDIRECT, data: { full_name: name.trim().replace(/\s+/g, ' ') } } });
        if (error) throw error;
        if (!data.session) { switchMode('signin'); setEmail(addr); setNotice('Account created. Check ' + addr + ' for the confirmation link, then sign in.'); }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: AUTH_REDIRECT });
        if (error) throw error;
        setNotice('If ' + addr + ' has an owner account, a password reset link is on its way. Open it on this device.');
      }
    } catch (err) { setError(friendlyAuthError(err)); } finally { setBusy(false); }
  };

  const titles = {
    signin: ['Welcome back.', 'Sign in to manage meters, readings and bills.'],
    setup: ['Set up owner account', 'First-time setup. This account becomes the property administrator.'],
    forgot: ['Reset your password', 'Enter your owner email and we will send you a reset link.'],
  };

  return <AuthLayout>
    {mode !== 'signin' && <button type="button" className="ghost back-link" onClick={() => switchMode('signin')}><ArrowLeft size={16} />Back to sign in</button>}
    <div className="eyebrow">Owner console</div>
    <h1>{titles[mode][0]}</h1>
    <p className="muted auth-sub">{titles[mode][1]}</p>
    <form className="auth-form" onSubmit={submit} noValidate={false}>
      {mode === 'setup' && <label>Full name<Field icon={UserRound}><input required autoComplete="name" autoFocus maxLength={80} placeholder="Your full name" value={name} onChange={e => setName(e.target.value)} /></Field></label>}
      <label>Email<Field icon={Mail}><input required type="email" autoComplete="email" autoFocus={mode !== 'setup'} placeholder="owner@example.com" value={email} onChange={e => setEmail(e.target.value)} /></Field></label>
      {mode !== 'forgot' && <label>
        <span className="label-row">Password{mode === 'signin' && <button type="button" className="text-link" onClick={() => switchMode('forgot')}>Forgot password?</button>}</span>
        <PasswordInput value={password} onChange={setPassword} autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} />
        {mode === 'setup' && <span className="hint">At least 8 characters, with a letter and a number.</span>}
      </label>}
      {mode === 'setup' && <label>Confirm password<PasswordInput value={confirm} onChange={setConfirm} placeholder="Repeat password" autoComplete="new-password" /></label>}
      {error && <div className="alert" role="alert">{error}</div>}
      {notice && <div className="success" role="status">{notice}</div>}
      <button className="auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'setup' ? 'Create owner account' : 'Send reset link'}{!busy && <ArrowRight size={17} />}</button>
    </form>
    {mode === 'signin' && canSetup && <div className="setup-callout"><Zap size={16} /><span>New here? No owner account exists yet.</span><button type="button" className="text-link" onClick={() => switchMode('setup')}>Set up owner account</button></div>}
  </AuthLayout>;
}

/** Shown after the owner opens a password-reset email link. */
export function SetNewPassword({ onDone }) {
  const [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  const submit = async e => {
    e.preventDefault(); setError('');
    const pwError = validatePassword(password) || (password !== confirm ? 'Passwords do not match.' : null);
    if (pwError) { setError(pwError); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(friendlyAuthError(error)); else setDone(true);
  };
  return <AuthLayout>
    <div className="eyebrow">Password reset</div>
    <h1>{done ? 'Password updated.' : 'Set a new password'}</h1>
    {done ? <>
      <p className="muted auth-sub">Your new password is saved and you are signed in.</p>
      <button className="auth-submit" onClick={onDone}>Continue to owner console<ArrowRight size={17} /></button>
    </> : <form className="auth-form" onSubmit={submit}>
      <label>New password<PasswordInput value={password} onChange={setPassword} autoComplete="new-password" autoFocus /><span className="hint">At least 8 characters, with a letter and a number.</span></label>
      <label>Confirm new password<PasswordInput value={confirm} onChange={setConfirm} placeholder="Repeat password" autoComplete="new-password" /></label>
      {error && <div className="alert" role="alert">{error}</div>}
      <button className="auth-submit" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
    </form>}
  </AuthLayout>;
}
