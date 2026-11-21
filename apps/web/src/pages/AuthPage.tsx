import { useState, type FormEvent } from 'react';
import { registerSchema } from '@corridor/core';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  LogIn,
  MapPinned,
  Route,
  ShieldCheck,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const ZONES = ['Central Zone', 'North Zone', 'East Zone', 'South Zone', 'West Zone', 'City Command'];

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [notice, setNotice] = useState('');
  return (
    <div className="login-shell">
      <div className="login-grid" />
      <section className={`login-card panel reveal ${mode === 'register' ? 'registration-card' : ''}`}>
        <div className="flex items-center gap-3 mb-7">
          <div className="brand-mark">
            <Route size={19} />
          </div>
          <div>
            <div className="brand-title">CORRIDOR</div>
            <div className="brand-subtitle">AI emergency command</div>
          </div>
          <span className="badge badge-active ml-auto">
            <ShieldCheck size={11} /> secure
          </span>
        </div>
        {mode === 'login' ? (
          <LoginForm notice={notice} onRegister={() => (setNotice(''), setMode('register'))} />
        ) : (
          <RegisterForm
            onDone={(username) => {
              setNotice(`Account "${username}" created. Sign in to continue.`);
              setMode('login');
            }}
            onBack={() => setMode('login')}
          />
        )}
        <div className="login-security">
          <LockKeyhole size={13} />
          <span>Authorised personnel only · all actions are audited</span>
        </div>
      </section>
    </div>
  );
}

function LoginForm({ notice, onRegister }: { notice: string; onRegister: () => void }) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="text-center mb-6">
        <div className="eyebrow">CONTROL ROOM ACCESS</div>
        <h1 className="login-title">Sign in to the command centre</h1>
        <p className="muted text-sm">Dispatch, traffic and hospital teams share one live operating picture.</p>
      </div>
      <form onSubmit={submit} className="grid gap-4">
        <div className="field">
          <label htmlFor="login-username">Username</label>
          <div className="input-with-icon">
            <UserRound size={15} />
            <input
              id="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              minLength={3}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <div className="input-with-icon">
            <KeyRound size={15} />
            <input
              id="login-password"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              minLength={6}
            />
            <button
              type="button"
              className="input-action"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>
        {notice && (
          <div className="login-success">
            <ShieldCheck size={14} /> {notice}
          </div>
        )}
        {error && (
          <div className="login-error" role="alert">
            <AlertTriangle size={14} /> {error}
          </div>
        )}
        <button className="btn btn-primary w-full" type="submit" disabled={busy}>
          <LogIn size={15} /> {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="auth-links">
        <button onClick={onRegister}>
          New team member? <strong>Create an account</strong>
        </button>
      </div>
    </>
  );
}

function RegisterForm({ onDone, onBack }: { onDone: (username: string) => void; onBack: () => void }) {
  const [form, setForm] = useState({ username: '', name: '', password: '', confirm: '', zone: ZONES[0] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = registerSchema.safeParse(form);
    const next: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
    if (form.password !== form.confirm) next.confirm = 'Passwords do not match';
    setErrors(next);
    if (Object.keys(next).length || !parsed.success) return;
    setBusy(true);
    try {
      await api.register(parsed.data);
      onDone(parsed.data.username);
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : 'Unable to reach the server' });
    } finally {
      setBusy(false);
    }
  };

  const err = (k: string) => errors[k] && <span className="field-error">{errors[k]}</span>;

  return (
    <>
      <div className="text-center mb-6">
        <div className="eyebrow">NEW ACCOUNT</div>
        <h1 className="login-title">Join the command centre</h1>
        <p className="muted text-sm">
          New accounts start with the dispatcher role. An administrator can grant supervisor or hospital access.
        </p>
      </div>
      <form onSubmit={submit} className="form-grid" noValidate>
        <div className="field">
          <label htmlFor="reg-name">Full name</label>
          <input id="reg-name" value={form.name} onChange={set('name')} autoComplete="name" />
          {err('name')}
        </div>
        <div className="field">
          <label htmlFor="reg-username">Username</label>
          <input id="reg-username" value={form.username} onChange={set('username')} autoComplete="username" />
          {err('username')}
        </div>
        <div className="field">
          <label htmlFor="reg-password">Password</label>
          <input
            id="reg-password"
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
          />
          {err('password') || <span className="field-hint">8+ characters with a letter and a number</span>}
        </div>
        <div className="field">
          <label htmlFor="reg-confirm">Confirm password</label>
          <input
            id="reg-confirm"
            type="password"
            value={form.confirm}
            onChange={set('confirm')}
            autoComplete="new-password"
          />
          {err('confirm')}
        </div>
        <div className="field full">
          <label htmlFor="reg-zone">Command zone</label>
          <div className="input-with-icon">
            <MapPinned size={15} />
            <select id="reg-zone" value={form.zone} onChange={set('zone')}>
              {ZONES.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </div>
        </div>
        {errors.form && (
          <div className="login-error full" role="alert">
            <AlertTriangle size={14} /> {errors.form}
          </div>
        )}
        <div className="form-actions full">
          <button type="button" className="btn" onClick={onBack}>
            Back to sign in
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            <UserPlus size={15} /> {busy ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </form>
    </>
  );
}
