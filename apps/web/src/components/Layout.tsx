import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { formatClock } from '@corridor/core';
import {
  Activity,
  BarChart3,
  Bell,
  BrainCircuit,
  Hospital,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Map,
  Menu,
  Route,
  Settings,
  Siren,
  TrafficCone,
  Truck,
  UserRound,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useLive } from '@/lib/live';
import { CHANNEL_LABEL } from '@/lib/labels';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/dispatch', label: 'Dispatch · 112', icon: Siren },
  { href: '/corridor', label: 'Live Corridor', icon: Map },
  { href: '/traffic', label: 'Traffic & Signals', icon: TrafficCone },
  { href: '/hospitals', label: 'Hospitals', icon: Hospital },
  { href: '/fleet', label: 'Fleet', icon: Truck },
  { href: '/ai', label: 'AI Engine', icon: BrainCircuit },
  { href: '/analytics', label: 'Impact Analytics', icon: BarChart3 },
  { href: '/audit', label: 'Audit Trail', icon: ListChecks },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { snapshot, connection } = useLive();
  const active = snapshot?.metrics.activeIncidents ?? 0;

  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0 });
  }, [location]);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="brand flex items-center gap-3 px-2 pb-6">
          <div className="brand-mark">
            <Route size={19} />
          </div>
          <div>
            <div className="brand-title">CORRIDOR</div>
            <div className="brand-subtitle">AI emergency command</div>
          </div>
          <button
            className="btn btn-quiet ml-auto md-hide"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={16} />
          </button>
        </div>
        <div className="nav-group-label mb-2">Operations</div>
        <nav className="grid gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const isActive = href === '/' ? location === '/' : location.startsWith(href);
            return (
              <Link key={href} href={href} className={`nav-item ${isActive ? 'active' : ''}`}>
                <Icon size={16} />
                <span>{label}</span>
                {href === '/dispatch' && active > 0 && <span className="nav-count">{active}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-status">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <span className={`status-dot ${connection !== 'live' ? 'warn' : ''}`} />
            {connection === 'live'
              ? 'Live link established'
              : connection === 'connecting'
                ? 'Connecting…'
                : 'Reconnecting…'}
          </div>
          <div className="mono muted text-[10px] mt-2">
            {snapshot
              ? `SIM ${formatClock(snapshot.simTime)} · ${snapshot.settings.speed}× · ${snapshot.settings.running ? 'RUNNING' : 'PAUSED'}`
              : '—'}
          </div>
          <div className="mono muted text-[10px] mt-1">
            CORRIDOR {snapshot?.settings.corridorEnabled ? 'ENABLED' : 'DISABLED'}
          </div>
        </div>
      </aside>
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}

      <div className="content">
        <header className="topbar">
          <div className="flex items-center gap-3 min-w-0">
            <button className="btn btn-quiet md-show" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Menu size={17} />
            </button>
            <div className="min-w-0">
              <div className="topbar-title truncate">Predictive Emergency Corridor</div>
              <div className="mono muted text-[10px] mt-0.5 truncate">
                SMART CITY OPERATIONS · MULTI-VEHICLE COORDINATION
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`live-pill ${connection !== 'live' ? 'warn' : ''}`}>
              <Activity size={12} /> {connection === 'live' ? 'Live' : 'Offline'}
            </span>
            <AlertBell />
            <UserMenu />
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}

function AlertBell() {
  const { snapshot } = useLive();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  const alerts = snapshot?.alerts ?? [];
  const urgent = alerts.filter((a) => !a.acknowledged && a.level !== 'info').length;
  return (
    <div className="relative" ref={ref}>
      <button className="btn btn-quiet relative" onClick={() => setOpen((o) => !o)} aria-label="Alerts">
        <Bell size={16} />
        {urgent > 0 && <span className="bell-count">{urgent > 9 ? '9+' : urgent}</span>}
      </button>
      {open && (
        <div className="panel dropdown alerts-dropdown">
          <div className="eyebrow px-3 pt-3 pb-2">Recent alerts</div>
          <div className="max-h-[380px] overflow-auto">
            {alerts.slice(0, 12).map((a) => (
              <div key={a.id} className={`dropdown-alert level-${a.level}`}>
                <div className="flex justify-between gap-2">
                  <strong>{a.title}</strong>
                  <span className="mono text-[10px] muted">{formatClock(a.at)}</span>
                </div>
                <div className="text-[11px] muted mt-1">{a.detail}</div>
                <div className="mono text-[9px] mt-1 uppercase tracking-wider text-slate-500">
                  {CHANNEL_LABEL[a.channel]}
                </div>
              </div>
            ))}
            {!alerts.length && <div className="p-4 muted text-xs">No alerts yet.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  if (!user) return null;
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button
        className="flex items-center gap-2 text-right"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
      >
        <div className="hidden sm:block">
          <div className="text-xs font-bold text-slate-200">{user.name}</div>
          <div className="mono text-[10px] muted uppercase">{user.role}</div>
        </div>
        <div className="avatar">{initials || <UserRound size={14} />}</div>
      </button>
      {open && (
        <div className="panel dropdown profile-menu">
          <div className="profile-menu-head">
            <div className="avatar">{initials}</div>
            <div>
              <div className="text-xs font-bold text-slate-100">{user.name}</div>
              <div className="mono text-[10px] muted">
                @{user.username} · {user.zone}
              </div>
            </div>
          </div>
          <div className="profile-menu-items">
            <Link href="/settings" onClick={() => setOpen(false)}>
              <Settings size={14} /> Account & settings
            </Link>
          </div>
          <button className="profile-menu-signout" onClick={() => logout()}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onOutside]);
}
