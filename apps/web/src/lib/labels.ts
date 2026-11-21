import type { AlertChannel, IncidentStatus, SignalMode, UnitKind, UnitStatus } from '@corridor/core';
import { Ambulance, Flame, Shield, type LucideIcon } from 'lucide-react';

export const UNIT_ICON: Record<UnitKind, LucideIcon> = { ambulance: Ambulance, fire: Flame, police: Shield };

export const UNIT_COLOR: Record<UnitKind, string> = {
  ambulance: '#ff6b6b',
  fire: '#ff9f43',
  police: '#5fa8ff',
};

export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = {
  available: 'Available',
  dispatched: 'Dispatched',
  en_route: 'En route',
  on_scene: 'On scene',
  transporting: 'Transporting',
  at_hospital: 'At hospital',
  returning: 'Returning',
  offline: 'Offline',
};

export const UNIT_STATUS_TONE: Record<UnitStatus, string> = {
  available: 'badge-active',
  dispatched: 'badge-high',
  en_route: 'badge-high',
  on_scene: 'badge-moderate',
  transporting: 'badge-critical',
  at_hospital: 'badge-moderate',
  returning: 'badge-muted',
  offline: 'badge-muted',
};

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  reported: 'Reported',
  verified: 'Queued',
  dispatched: 'Dispatched',
  on_scene: 'On scene',
  transporting: 'Transporting',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
};

export const INCIDENT_STATUS_TONE: Record<IncidentStatus, string> = {
  reported: 'badge-critical',
  verified: 'badge-high',
  dispatched: 'badge-high',
  on_scene: 'badge-moderate',
  transporting: 'badge-critical',
  resolved: 'badge-active',
  cancelled: 'badge-muted',
};

export const SIGNAL_MODE_LABEL: Record<SignalMode, string> = {
  normal: 'Adaptive cycle',
  preclear: 'Pre-clearing',
  green_wave: 'Green wave',
  restore: 'Restoring',
  manual: 'Manual override',
  flash: 'Flashing red',
};

export const SIGNAL_MODE_TONE: Record<SignalMode, string> = {
  normal: 'badge-muted',
  preclear: 'badge-high',
  green_wave: 'badge-active',
  restore: 'badge-moderate',
  manual: 'badge-reroute',
  flash: 'badge-critical',
};

export const CHANNEL_LABEL: Record<AlertChannel, string> = {
  v2x: 'V2X / Public',
  vms: 'VMS board',
  app_push: 'App push',
  hospital: 'Hospital',
  crew: 'Crew',
  system: 'System',
};

export function severityTone(severity: number) {
  return severity >= 5 ? 'badge-critical' : severity >= 4 ? 'badge-high' : 'badge-moderate';
}

/** Green → amber → red ramp for congestion 0..1. */
export function congestionColor(c: number, blocked = false) {
  if (blocked) return '#ff4d4f';
  if (c < 0.35) return '#2fbf8f';
  if (c < 0.55) return '#c9c24a';
  if (c < 0.75) return '#f0a13c';
  return '#ef5a4c';
}

export const pct = (v: number | null | undefined, digits = 0) => (v == null ? '—' : `${v.toFixed(digits)}%`);
