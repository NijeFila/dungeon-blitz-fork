import { GlobalState } from './GlobalState';
import { DungeonCompletionConditions } from './DungeonCompletionConditions';
import { getScopeLevelName } from './LevelScope';
import { getScopeRuntimeLevel, clearScopeRuntimeLevel } from './RuntimeLevel';
import { isRoomBossEntity } from './RoomBossState';
import { EntityState } from './Entity';
import type { EncounterAuthorityMode } from './DungeonCompletionTypes';
import { StructuredLogger } from './StructuredLogger';

const encounterLog = new StructuredLogger('BossAuthority');

export type CanonicalEntityId = number & { readonly __canonicalEntityId: unique symbol };
export type EncounterLifeNonce = number & { readonly __encounterLifeNonce: unique symbol };
export type BossAuthorityPhase = 'active' | 'terminal';

export type BossAuthorityEntity = Record<string, unknown> & {
    id?: number;
    name?: string;
    EntName?: string;
    isPlayer?: boolean;
    team?: number;
    level?: number;
    maxHp?: number;
    hp?: number;
    dead?: boolean;
    destroyed?: boolean;
    entState?: number;
    roomBossName?: string;
    bossAuthorityKey?: string;
    lifeNonce?: number;
};

export type BossAuthorityEvent =
    | { type: 'damage'; eventId: string; token: number; amount: number; at: number }
    | { type: 'heal'; eventId: string; token: number; amount: number; at: number; accepted: boolean }
    | { type: 'terminal-death'; eventId: string; token: number; at: number }
    | { type: 'reward-granted'; eventId: string; token: number; at: number };

// One dungeon boss, one record, for the whole level scope.
//
// Every client spawns its own copy of a boss and reports damage against that
// copy, so before this the "boss" was really N independent bosses that happened
// to share a name: N health pools, N deaths, N cutscenes. Whoever killed their
// copy first ended the room, and everyone else was left swinging at a corpse
// the server had already written off — or at a boss that was still at full
// health on their screen.
//
// The record below is the single place a boss's level, health pool and death
// live. Client copies are projections of it, never the source.
export type BossAuthorityRecord = {
    levelScope: string;
    canonicalName: string;
    level: number;
    maxHp: number;
    hp: number;
    dead: boolean;
    deadAt: number;
    canonicalEntityId: CanonicalEntityId;
    lifeNonce: EncounterLifeNonce;
    phase: BossAuthorityPhase;
    authorityMode: EncounterAuthorityMode;
    proxyIdsByToken: Map<number, Set<number>>;
    appliedEventIds: Set<string>;
    rewardNonces: Set<string>;
    events: BossAuthorityEvent[];
    // Damage reported per session token. Each client reports only what it dealt,
    // so these sum; keyed by token so a reconnecting player cannot double-count.
    reportedDamageByToken: Map<number, number>;
};

const bossRecordsByScope = new Map<string, Map<string, BossAuthorityRecord>>();
const ENEMY_TEAM = 2;

function normalizeScope(levelScope: string | null | undefined): string {
    return String(levelScope ?? '').trim();
}

function roundPositive(value: unknown, fallback: number = 0): number {
    const numeric = Math.round(Number(value ?? fallback));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

// The name the record is keyed by. Falls back to the room-boss marker so a boss
// the completion catalog does not name still gets one shared pool rather than
// one per viewer.
export function getBossAuthorityKey(levelScope: string | null | undefined, entity: BossAuthorityEntity): string {
    const scopeKey = normalizeScope(levelScope);
    if (!scopeKey || !entity || entity.isPlayer) {
        return '';
    }

    const canonical = DungeonCompletionConditions.getCanonicalBossName(
        getScopeLevelName(scopeKey),
        entity,
        scopeKey
    );
    if (canonical) {
        return canonical;
    }

    if (!isRoomBossEntity(scopeKey, entity)) {
        return '';
    }

    const markerName = String(entity.roomBossName ?? entity.name ?? entity.EntName ?? '').trim();
    return markerName ? `roomboss:${markerName.toLowerCase()}` : '';
}

export function getBossAuthorityRecord(
    levelScope: string | null | undefined,
    entity: BossAuthorityEntity
): BossAuthorityRecord | null {
    const scopeKey = normalizeScope(levelScope);
    const key = getBossAuthorityKey(scopeKey, entity);
    return key ? bossRecordsByScope.get(scopeKey)?.get(key) ?? null : null;
}

// Creates the record on first sight of a boss and stamps the scope's numbers
// onto this copy. Idempotent — called from every path that sees a boss entity,
// so a copy registered late still lands on the run's existing pool instead of
// starting a fresh one at full health.
export function noteBossEntity(
    levelScope: string | null | undefined,
    entity: BossAuthorityEntity,
    estimateMaxHp: (entity: BossAuthorityEntity, levelScope: string) => number
): BossAuthorityRecord | null {
    const scopeKey = normalizeScope(levelScope);
    const key = getBossAuthorityKey(scopeKey, entity);
    if (!key) {
        return null;
    }

    let scopeRecords = bossRecordsByScope.get(scopeKey);
    if (!scopeRecords) {
        scopeRecords = new Map<string, BossAuthorityRecord>();
        bossRecordsByScope.set(scopeKey, scopeRecords);
    }

    const level = getScopeRuntimeLevel(scopeKey, null, roundPositive(entity.level, 1));
    let record = scopeRecords.get(key);
    if (!record) {
        // Size the pool once, at the level the scope agreed on, and never
        // re-derive it: a pool that moves under an in-flight fight is a bar that
        // jumps on every screen.
        entity.level = level;
        const maxHp = Math.max(
            1,
            roundPositive(entity.maxHp) ||
                roundPositive(estimateMaxHp(entity, scopeKey)) ||
                roundPositive(entity.hp, 1)
        );
        record = {
            levelScope: scopeKey,
            canonicalName: key,
            level,
            maxHp,
            hp: maxHp,
            dead: false,
            deadAt: 0,
            canonicalEntityId: roundPositive(entity.id, 0) as CanonicalEntityId,
            lifeNonce: Math.max(0, Math.round(Number(entity.lifeNonce ?? 0))) as EncounterLifeNonce,
            phase: 'active',
            authorityMode: DungeonCompletionConditions.getEncounterAuthorityMode(getScopeLevelName(scopeKey)),
            proxyIdsByToken: new Map<number, Set<number>>(),
            appliedEventIds: new Set<string>(),
            rewardNonces: new Set<string>(),
            events: [],
            reportedDamageByToken: new Map<number, number>()
        };
        scopeRecords.set(key, record);
        encounterLog.info('encounter.created', {
            levelScope: scopeKey,
            canonicalEntityId: record.canonicalEntityId,
            canonicalName: record.canonicalName,
            lifeNonce: record.lifeNonce,
            authorityMode: record.authorityMode,
            maxHp: record.maxHp
        });
    }

    applyBossAuthorityToEntity(record, entity);
    return record;
}

// Projects the record onto one client copy.
//
// Deliberately narrow. The health paths already resolve and converge hp/maxHp
// across copies, and a second writer for those numbers only fights the first —
// so the record follows their arithmetic rather than overriding it. What it
// does own is the level every copy is scaled at, and the fact of the death,
// because those are the two things that were previously decided per viewer.
export function applyBossAuthorityToEntity(record: BossAuthorityRecord, entity: BossAuthorityEntity): void {
    if (!entity || typeof entity !== 'object') {
        return;
    }

    entity.level = record.level;
    entity.bossAuthorityKey = record.canonicalName;
    if (record.authorityMode === 'canonical') {
        entity.maxHp = record.maxHp;
        entity.hp = record.hp;
    }
    if (record.dead) {
        entity.dead = true;
        if (record.authorityMode === 'canonical') {
            entity.destroyed = true;
            entity.entState = EntityState.DEAD;
        }
        entity.playerDamageContributed = true;
        entity.clientDefeatVerified = true;
    }
}

// Applies one client's reported damage against the shared pool.
//
// Reports are accumulated per token rather than subtracted directly: clients
// re-report the same running total as their local sim catches up, and adding
// those deltas blindly drained the pool several times over in a full party.
export function reportBossDamage(
    levelScope: string | null | undefined,
    entity: BossAuthorityEntity,
    token: number,
    damage: number,
    eventId: string = ''
): { record: BossAuthorityRecord; hp: number; killed: boolean } | null {
    const record = getBossAuthorityRecord(levelScope, entity);
    if (!record) {
        return null;
    }

    const appliedDamage = Math.max(0, Math.round(Number(damage) || 0));
    const sourceToken = Math.max(0, Math.round(Number(token) || 0));
    const normalizedEventId = String(eventId ?? '').trim();
    if (normalizedEventId && record.appliedEventIds.has(normalizedEventId)) {
        return { record, hp: record.hp, killed: false };
    }
    if (normalizedEventId) {
        record.appliedEventIds.add(normalizedEventId);
    }
    if (appliedDamage > 0) {
        const previous = Math.max(0, Math.round(Number(record.reportedDamageByToken.get(sourceToken) ?? 0)));
        record.reportedDamageByToken.set(sourceToken, Math.min(record.maxHp, previous + appliedDamage));
        record.events.push({
            type: 'damage',
            eventId: normalizedEventId || `damage:${sourceToken}:${record.events.length + 1}`,
            token: sourceToken,
            amount: appliedDamage,
            at: Date.now()
        });
    }

    let totalReported = 0;
    for (const reported of record.reportedDamageByToken.values()) {
        totalReported += Math.max(0, Math.round(Number(reported) || 0));
    }

    const wasDead = record.dead;
    record.hp = Math.max(0, record.maxHp - Math.min(record.maxHp, totalReported));
    if (record.hp <= 0 && !record.dead) {
        record.dead = true;
        record.deadAt = Date.now();
        record.phase = 'terminal';
    }
    if (appliedDamage > 0) {
        encounterLog.sampledDebug('intent.damage_applied', eventId || `${record.lifeNonce}:${totalReported}`, 0.1, {
            levelScope: record.levelScope,
            canonicalEntityId: record.canonicalEntityId,
            lifeNonce: record.lifeNonce,
            authorityMode: record.authorityMode,
            token: sourceToken,
            eventId: normalizedEventId,
            amount: appliedDamage,
            hp: record.hp
        });
    }

    applyBossAuthorityToEntity(record, entity);
    return { record, hp: record.hp, killed: record.dead && !wasDead };
}

// The health paths stay the arithmetic; the record just remembers what they
// decided, so the ledger clamps against a real pool and the death reaches
// viewers the copy sweep never matched.
export function adoptBossAuthorityHealth(
    levelScope: string | null | undefined,
    entity: BossAuthorityEntity,
    currentHp: number,
    maxHp: number
): BossAuthorityRecord | null {
    const record = getBossAuthorityRecord(levelScope, entity);
    if (!record) {
        return null;
    }

    if (record.phase === 'terminal') {
        applyBossAuthorityToEntity(record, entity);
        return record;
    }

    record.maxHp = Math.max(1, Math.round(Number(maxHp) || record.maxHp));
    record.hp = Math.max(0, Math.min(record.maxHp, Math.round(Number(currentHp) || 0)));
    if (record.hp <= 0 && !record.dead) {
        record.dead = true;
        record.deadAt = Date.now();
        record.phase = 'terminal';
    }
    applyBossAuthorityToEntity(record, entity);
    return record;
}

// Pushes the record onto every copy of this boss the server holds — the shared
// level map plus each session's own entity map. Call after any change so a
// viewer that never fired a shot still sees the bar move.
export function syncBossAuthorityCopies(
    levelScope: string | null | undefined,
    record: BossAuthorityRecord
): number {
    const scopeKey = normalizeScope(levelScope);
    if (!scopeKey) {
        return 0;
    }

    let synced = 0;
    const stamp = (candidate: BossAuthorityEntity): void => {
        // Cheap rejects first. Resolving a canonical boss name clones a catalog
        // entry, and this sweep runs on every boss health tick across every
        // session's entity map — the overwhelming majority of what it walks is
        // trash mobs and props.
        if (!candidate || candidate.isPlayer || Number(candidate.team ?? 0) !== ENEMY_TEAM) {
            return;
        }
        if (candidate.bossAuthorityKey !== undefined && candidate.bossAuthorityKey !== record.canonicalName) {
            return;
        }
        if (
            candidate.bossAuthorityKey !== record.canonicalName &&
            getBossAuthorityKey(scopeKey, candidate) !== record.canonicalName
        ) {
            return;
        }
        applyBossAuthorityToEntity(record, candidate);
        synced++;
    };

    for (const candidate of GlobalState.levelEntities.get(scopeKey)?.values() ?? []) {
        stamp(candidate);
    }
    for (const session of GlobalState.getSessionsInLevelScope(scopeKey)) {
        for (const candidate of session.entities?.values() ?? []) {
            stamp(candidate);
        }
    }

    return synced;
}

export function isBossAuthorityDead(levelScope: string | null | undefined, entity: BossAuthorityEntity): boolean {
    return Boolean(getBossAuthorityRecord(levelScope, entity)?.dead);
}

// True once the scope owns this boss's pool, which is the condition the combat
// paths use to decide they may commit the kill themselves instead of waiting
// for one client's defeat signal.
export function hasBossAuthorityPool(levelScope: string | null | undefined, entity: BossAuthorityEntity): boolean {
    return Boolean(getBossAuthorityRecord(levelScope, entity));
}

export function registerBossAuthorityProxy(
    levelScope: string | null | undefined,
    entity: BossAuthorityEntity,
    token: number,
    localEntityId: number
): BossAuthorityRecord | null {
    const record = getBossAuthorityRecord(levelScope, entity);
    if (!record) {
        return null;
    }
    const sourceToken = Math.max(0, Math.round(Number(token) || 0));
    const proxyId = Math.max(0, Math.round(Number(localEntityId) || 0));
    if (sourceToken > 0 && proxyId > 0) {
        const proxyIds = record.proxyIdsByToken.get(sourceToken) ?? new Set<number>();
        proxyIds.add(proxyId);
        record.proxyIdsByToken.set(sourceToken, proxyIds);
    }
    applyBossAuthorityToEntity(record, entity);
    return record;
}

export function reportBossHealIntent(
    levelScope: string | null | undefined,
    entity: BossAuthorityEntity,
    token: number,
    amount: number,
    eventId: string,
    allowHealing: boolean
): { record: BossAuthorityRecord; accepted: boolean } | null {
    const record = getBossAuthorityRecord(levelScope, entity);
    if (!record) {
        return null;
    }
    const normalizedEventId = String(eventId ?? '').trim();
    if (normalizedEventId && record.appliedEventIds.has(normalizedEventId)) {
        return { record, accepted: false };
    }
    if (normalizedEventId) {
        record.appliedEventIds.add(normalizedEventId);
    }
    const healAmount = Math.max(0, Math.round(Number(amount) || 0));
    const accepted = Boolean(allowHealing && record.phase === 'active' && healAmount > 0);
    if (accepted) {
        record.hp = Math.min(record.maxHp, record.hp + healAmount);
    }
    record.events.push({
        type: 'heal',
        eventId: normalizedEventId || `heal:${token}:${record.events.length + 1}`,
        token: Math.max(0, Math.round(Number(token) || 0)),
        amount: healAmount,
        at: Date.now(),
        accepted
    });
    encounterLog.sampledDebug('intent.heal_observed', `${record.lifeNonce}:${record.events.length}`, 0.1, {
        levelScope: record.levelScope,
        canonicalEntityId: record.canonicalEntityId,
        lifeNonce: record.lifeNonce,
        authorityMode: record.authorityMode,
        token,
        eventId: normalizedEventId,
        amount: healAmount,
        accepted,
        hp: record.hp
    });
    applyBossAuthorityToEntity(record, entity);
    return { record, accepted };
}

export function markBossAuthorityTerminalDeath(
    levelScope: string | null | undefined,
    entity: BossAuthorityEntity,
    token: number,
    eventId: string
): { record: BossAuthorityRecord; transitioned: boolean } | null {
    const record = getBossAuthorityRecord(levelScope, entity);
    if (!record) {
        return null;
    }
    const normalizedEventId = String(eventId ?? '').trim();
    if (normalizedEventId && record.appliedEventIds.has(normalizedEventId)) {
        return { record, transitioned: false };
    }
    if (normalizedEventId) {
        record.appliedEventIds.add(normalizedEventId);
    }
    const transitioned = record.phase !== 'terminal';
    if (transitioned) {
        record.phase = 'terminal';
        record.dead = true;
        record.hp = 0;
        record.deadAt = Date.now();
        record.events.push({
            type: 'terminal-death',
            eventId: normalizedEventId || `terminal:${token}:${record.events.length + 1}`,
            token: Math.max(0, Math.round(Number(token) || 0)),
            at: record.deadAt
        });
        encounterLog.info('encounter.terminal', {
            levelScope: record.levelScope,
            canonicalEntityId: record.canonicalEntityId,
            canonicalName: record.canonicalName,
            lifeNonce: record.lifeNonce,
            authorityMode: record.authorityMode,
            token,
            eventId: normalizedEventId
        });
    }
    applyBossAuthorityToEntity(record, entity);
    syncBossAuthorityCopies(levelScope, record);
    return { record, transitioned };
}

export function grantBossAuthorityRewardOnce(
    levelScope: string | null | undefined,
    entity: BossAuthorityEntity,
    token: number,
    rewardNonce: string
): boolean {
    const record = getBossAuthorityRecord(levelScope, entity);
    const nonce = String(rewardNonce ?? '').trim();
    if (!record || record.phase !== 'terminal' || !nonce || record.rewardNonces.has(nonce)) {
        return false;
    }
    record.rewardNonces.add(nonce);
    record.events.push({
        type: 'reward-granted',
        eventId: `reward:${nonce}`,
        token: Math.max(0, Math.round(Number(token) || 0)),
        at: Date.now()
    });
    encounterLog.info('reward.granted', {
        levelScope: record.levelScope,
        canonicalEntityId: record.canonicalEntityId,
        lifeNonce: record.lifeNonce,
        token,
        rewardNonce: nonce
    });
    return true;
}

export function getBossAuthorityRecordsForScope(
    levelScope: string | null | undefined
): BossAuthorityRecord[] {
    return [...(bossRecordsByScope.get(normalizeScope(levelScope))?.values() ?? [])];
}

export function clearBossAuthority(levelScope: string | null | undefined): void {
    const scopeKey = normalizeScope(levelScope);
    if (!scopeKey) {
        return;
    }

    bossRecordsByScope.delete(scopeKey);
    clearScopeRuntimeLevel(scopeKey);
}

export function clearAllBossAuthority(): void {
    bossRecordsByScope.clear();
}

GlobalState.registerLevelScopeDisposer(clearBossAuthority);
