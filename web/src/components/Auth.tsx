import { useState, type FormEvent } from 'react';
import { authMessage, login, register, resetPassword } from '../lib/api';
import { Logo } from './Logo';

export function AuthScreen() {
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in');
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [info, setInfo] = useState(''); const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'up') { if (!name.trim()) throw new Error('Enter your name.'); await register(name, email, password); }
      else if (mode === 'in') await login(email, password);
      else { await resetPassword(email); setInfo('If an account exists for this email, a reset link is on its way.'); }
    } catch (err) {
      setError(err instanceof Error && !(err as { code?: string }).code ? err.message : authMessage(err));
    } finally { setBusy(false); }
  }

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit} noValidate>
        <Logo size={72} />
        <h1>Pupper</h1>
        <p className="muted">{mode === 'reset' ? 'Enter your email and we will send a reset link.' : 'Connect with the people who matter.'}</p>
        {mode === 'up' && <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} required /></label>}
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
        {mode !== 'reset' && <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} minLength={6} required /></label>}
        {error && <p className="error" role="alert">{error}</p>}
        {info && <p className="ok" role="status">{info}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</button>
        {mode === 'in' && <button type="button" className="btn outline" onClick={() => { setMode('up'); setError(''); }}>Create account</button>}
        <div className="auth-links">
          {mode !== 'in' && <button type="button" className="link" onClick={() => { setMode('in'); setError(''); setInfo(''); }}>Back to sign in</button>}
          {mode === 'in' && <button type="button" className="link" onClick={() => { setMode('reset'); setError(''); }}>Forgot password?</button>}
        </div>
      </form>
    </main>
  );
}

export function SetupNeeded() {
  return (
    <main className="auth"><div className="auth-card">
      <Logo size={72} /><h1>Almost there</h1>
      <p className="muted">This build has no Firebase settings. Copy <code>.env.example</code> to <code>web/.env.local</code>, fill in your project values, and restart. See the README for the Firebase Console steps.</p>
    </div></main>
  );
}
