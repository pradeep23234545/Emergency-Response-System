import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { changePasswordSchema, type UserRole } from '@corridor/core';
import { toast } from 'sonner';
import { FastForward, KeyRound, RotateCcw, SlidersHorizontal, Users } from 'lucide-react';
import { Loading, PageHeader, Panel, Toggle, reportError } from '@/components/common';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLive } from '@/lib/live';

const ROLES: UserRole[] = ['admin', 'supervisor', 'dispatcher', 'hospital'];
const ROLE_HELP: Record<UserRole, string> = {
  admin: 'Everything, including user management',
  supervisor: 'Dispatch, signal overrides, blockages, simulation',
  dispatcher: 'Log calls and dispatch units',
  hospital: 'Update bed capacity and acknowledge alerts',
};

export default function SettingsPage() {
  const { user, can } = useAuth();
  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Your account, simulation controls and team access."
      />
      <div className="section-grid-wide">
        <div className="grid gap-[14px] content-start">
          {can('simulation') && <SimulationPanel />}
          {can('users') && <UsersPanel />}
        </div>
        <div className="grid gap-[14px] content-start">
          <Panel title="Your account">
            <div className="kv">
              <span>Name</span>
              <strong>{user?.name}</strong>
              <span>Username</span>
              <strong>@{user?.username}</strong>
              <span>Role</span>
              <strong className="uppercase">{user?.role}</strong>
              <span>Zone</span>
              <strong>{user?.zone}</strong>
              <span>Permissions</span>
              <strong className="whitespace-normal">{user ? ROLE_HELP[user.role] : ''}</strong>
            </div>
          </Panel>
          <PasswordPanel />
        </div>
      </div>
    </>
  );
}

function SimulationPanel() {
  const { snapshot } = useLive();
  const [busy, setBusy] = useState(false);
  if (!snapshot) return <Loading />;
  const s = snapshot.settings;
  const set = (patch: Parameters<typeof api.updateSimulation>[0]) => api.updateSimulation(patch).catch(reportError);
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title="Simulation & system"
      subtitle="Changes apply instantly for every connected operator"
      actions={<SlidersHorizontal size={16} className="text-amber-300" />}
    >
      <div className="grid gap-2">
        <Toggle
          on={s.running}
          onChange={(v) => set({ running: v })}
          label="Simulation clock running"
          detail="Pause to freeze traffic, vehicles and signals"
        />
        <Toggle
          on={s.corridorEnabled}
          onChange={(v) => set({ corridorEnabled: v })}
          label="Predictive emergency corridor"
          detail="Turn off to see the baseline: fixed signal cycles and no queue pre-clearing"
        />
        <Toggle
          on={s.autoDispatch}
          onChange={(v) => set({ autoDispatch: v })}
          label="AI auto-dispatch"
          detail="Dispatch the best units to verified calls, highest severity first"
        />
        <Toggle
          on={s.autoIncidents}
          onChange={(v) => set({ autoIncidents: v })}
          label="Synthetic 112 call generator"
          detail="Feed realistic emergency calls into the system"
        />
        <Toggle
          on={s.vehicleAuth}
          onChange={(v) => set({ vehicleAuth: v })}
          label="Vehicle authentication"
          detail="Only registered fleet vehicles may pre-empt signals"
        />
      </div>
      <div className="field mt-4">
        <label htmlFor="speed">Simulation speed · {s.speed}× real time</label>
        <input
          id="speed"
          type="range"
          min={1}
          max={20}
          step={1}
          value={s.speed}
          onChange={(e) => set({ speed: Number(e.target.value) })}
        />
      </div>
      <div className="form-actions">
        <button
          className="btn"
          disabled={busy}
          onClick={() => act(() => api.stepSimulation(300), 'Advanced 5 simulated minutes')}
        >
          <FastForward size={14} /> Skip 5 min
        </button>
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                'Reset the city to the 08:30 baseline? Active incidents and session metrics will be cleared (history stays in the database).',
              )
            ) {
              act(() => api.resetSimulation(), 'Simulation reset');
            }
          }}
        >
          <RotateCcw size={14} /> Reset simulation
        </button>
      </div>
    </Panel>
  );
}

function UsersPanel() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: api.users });
  const update = (id: number, role: UserRole) =>
    api
      .updateUser(id, { role })
      .then(() => {
        toast.success('Role updated');
        qc.invalidateQueries({ queryKey: ['users'] });
      })
      .catch(reportError);
  return (
    <Panel
      title="Team access"
      subtitle="Role-based access control"
      actions={<Users size={16} className="text-teal-300" />}
      bodyClassName="table-wrap"
    >
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Zone</th>
            <th>Last sign-in</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {users.data?.users.map((u) => (
            <tr key={u.id}>
              <td>
                <div className="font-bold text-slate-200">{u.name}</div>
                <div className="mono text-[10px] muted">@{u.username}</div>
              </td>
              <td>{u.zone}</td>
              <td className="mono text-[11px]">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'never'}</td>
              <td>
                <select
                  className="mini-select"
                  value={u.role}
                  disabled={u.id === me?.id}
                  onChange={(e) => update(u.id, e.target.value as UserRole)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function PasswordPanel() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = changePasswordSchema.safeParse({ currentPassword: current, newPassword: next });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    if (next !== confirm) return setError('Passwords do not match');
    setError('');
    try {
      await api.changePassword(current, next);
      toast.success('Password changed', { description: 'Other sessions were signed out.' });
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      reportError(err);
    }
  };
  return (
    <Panel title="Change password" actions={<KeyRound size={16} className="text-amber-300" />}>
      <form className="grid gap-3" onSubmit={submit}>
        <div className="field">
          <label htmlFor="pw-current">Current password</label>
          <input
            id="pw-current"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div className="field">
          <label htmlFor="pw-new">New password</label>
          <input
            id="pw-new"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="field">
          <label htmlFor="pw-confirm">Confirm new password</label>
          <input
            id="pw-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        {error && <div className="login-error">{error}</div>}
        <div className="form-actions">
          <button className="btn btn-primary" type="submit">
            Update password
          </button>
        </div>
      </form>
    </Panel>
  );
}
