// Shared by the admin server routes and the admin web app. No node imports in this file.
export const ROLES = ['owner', 'admin', 'moderator', 'content_editor', 'support'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', moderator: 'Moderator', content_editor: 'Content editor', support: 'Support' };

export const PERMS = [
  'map.view', 'map.edit',
  'players.view', 'players.moderate', 'players.economy', 'players.reset',
  'reports.view', 'reports.resolve',
  'store.view', 'store.edit', 'store.refund',
  'economy.view', 'economy.edit',
  'content.view', 'content.edit', 'content.rollback',
  'liveops.view', 'liveops.edit', 'maintenance.toggle',
  'audit.view', 'staff.manage',
] as const;
export type Perm = (typeof PERMS)[number];

const ALL = [...PERMS] as Perm[];
export const ROLE_PERMS: Record<Role, Perm[]> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== 'staff.manage'),
  moderator: ['map.view', 'players.view', 'players.moderate', 'reports.view', 'reports.resolve', 'liveops.view', 'audit.view'],
  content_editor: ['map.view', 'map.edit', 'content.view', 'content.edit', 'content.rollback', 'economy.view', 'store.view', 'liveops.view'],
  support: ['map.view', 'players.view', 'reports.view', 'store.view', 'economy.view'],
};

export function can(role: Role | undefined, perm: Perm) { return !!role && ROLE_PERMS[role]?.includes(perm); }

export interface AdminUser { id: number; email: string; name: string; role: Role; disabled: boolean; createdAt: number; lastLogin: number | null }
export interface AuditRow { id: number; ts: number; actorId: number | null; actorEmail: string; actorRole: string; action: string; targetType: string; targetId: string; summary: string; before: unknown; after: unknown; ip: string }

export type SanctionKind = 'ban' | 'suspend' | 'mute';
export interface Sanction { id: number; accountId: string; kind: SanctionKind; reason: string; createdAt: number; expiresAt: number | null; issuedBy: string; revokedAt: number | null; revokedBy: string | null; revokeReason: string | null }

export interface PlayerRow { id: string; email: string | null; name: string; createdAt: number; lastSeen: number | null; online: boolean; cash: number; bank: number; level: number; plots: number; status: 'ok' | 'banned' | 'suspended' | 'muted'; spent: number; reports: number }
export interface VehicleRec { id: string; model: string; plate?: string; color?: string; value?: number; registered?: boolean; stolen?: boolean }
export interface ItemRec { id: string; qty: number }
export interface PlayerDetail {
  id: string; email: string | null; name: string; createdAt: number; lastSeen: number | null; online: boolean; ip?: string | null; device?: string | null;
  state: Record<string, unknown>; cash: number; bank: number; level: number; xp: number; x: number | null; z: number | null;
  inventory: ItemRec[]; vehicles: VehicleRec[]; plots: PlotRec[]; skills: Record<string, number>;
  sanctions: Sanction[]; purchases: PurchaseRow[]; reports: ChatReport[]; notes: { id: number; ts: number; by: string; text: string }[];
}
export interface PlotRec { id: string; ownerId: string | null; ownerName?: string | null; x: number; z: number; price: number; forSale: boolean; flags: string[]; name?: string | null; zone?: string | null; area?: number | null }
export interface PurchaseRow { id: string; accountId: string; accountName?: string; itemId: string; itemName?: string; amount: number; currency: 'NGN' | 'USD'; status: 'paid' | 'refunded' | 'failed' | 'pending' | 'chargeback'; provider: string; ref: string | null; promo?: string | null; createdAt: number; refundedAt?: number | null; refundReason?: string | null }
export interface ChatReport { id: number; reporterId: string; reporterName?: string; targetId: string; targetName?: string; channel: string; message: string; context?: string[]; createdAt: number; status: 'open' | 'actioned' | 'dismissed'; resolution?: string | null; resolvedBy?: string | null }
export interface LivePlayer { id: string; name: string; x: number; z: number; heading?: number; activity?: string; level?: number; since?: number }
export interface Flag { key: string; enabled: boolean; rollout: number; description: string; audience: 'all' | 'staff' | 'beta'; updatedAt: number; updatedBy: string }
export interface Announcement { id: number; ts: number; by: string; kind: 'info' | 'warn' | 'event'; message: string; target: 'all' | 'ids'; targetIds?: string[]; expiresAt: number | null; delivered: number }
export interface Maintenance { enabled: boolean; message: string; eta: number | null; allowStaff: boolean }
export interface OpsStatus { version: string; uptimeSec: number; online: number; peak24h: number; connections: number; tickMs: number; memoryMb: number; dbMb: number; maintenance: Maintenance; accounts: number; bannedNow: number; openReports: number; revenue30d: { NGN: number; USD: number }; simulated?: boolean }
export interface ContentVersion { version: number; kind: string; savedAt: number; by: string; note: string; items: number; hash: string }
export interface Issue { level: 'error' | 'warn'; path: string; msg: string }
