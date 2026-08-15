import { strict as assert } from 'assert';
import * as path from 'path';
import { EntityState, EntityTeam } from '../core/Entity';
import { DungeonCompletionConditions } from '../core/DungeonCompletionConditions';
import { DungeonCompletionSystem } from '../core/DungeonCompletionSystem';
import { GameData } from '../core/GameData';
import { GlobalState } from '../core/GlobalState';
import { LevelConfig } from '../core/LevelConfig';
import { getLevelScopeKey } from '../core/LevelScope';
import { CombatHandler } from '../handlers/CombatHandler';
import { BitBuffer } from '../network/protocol/bitBuffer';

function createBoss(id: number, name: string, hp: number): any {
    return {
        id,
        name,
        EntName: name,
        displayName: 'Greater Bone Golem',
        roomBossName: 'Greater Bone Golem',
        isPlayer: false,
        team: EntityTeam.ENEMY,
        roomId: 8,
        clientSpawned: true,
        hp,
        maxHp: 1000,
        healthDelta: hp - 1000,
        health_delta: hp - 1000,
        dead: hp <= 0,
        destroyed: false,
        entState: hp <= 0 ? EntityState.DEAD : EntityState.ACTIVE
    };
}

function testDamageToSurvivorDoesNotReviveDefeatedTwin(
    levelName: string,
    firstBossName: string,
    secondBossName: string
): void {
    const levelInstanceId = `back-alley-health-${levelName}`;
    const scope = getLevelScopeKey(levelName, levelInstanceId);
    const defeatedBoss = createBoss(81_001, firstBossName, 0);
    const survivingBoss = createBoss(81_002, secondBossName, 1000);
    const token = levelName.endsWith('Hard') ? 82_002 : 82_001;
    const client = {
        token,
        currentLevel: levelName,
        levelInstanceId,
        playerSpawned: true,
        clientEntID: token + 1000,
        character: {
            name: `${levelName}BossHealthTester`,
            CurrentLevel: { name: levelName, x: 0, y: 0 }
        },
        entityIdAliases: new Map<number, number>(),
        entities: new Map([
            [defeatedBoss.id, defeatedBoss],
            [survivingBoss.id, survivingBoss]
        ])
    };
    GlobalState.levelEntities.set(scope, new Map([
        [defeatedBoss.id, defeatedBoss],
        [survivingBoss.id, survivingBoss]
    ]));
    GlobalState.sessionsByToken.set(token, client as never);

    try {
        const resolution = (CombatHandler as any).updateNpcTargetAfterHit(scope, survivingBoss.id, 100);

        assert.equal(resolution.appliedDamage, 100, `${levelName}: surviving boss did not take the hit`);
        assert.equal(survivingBoss.hp, 900, `${levelName}: surviving boss HP was not updated`);
        assert.equal(
            defeatedBoss.hp,
            0,
            `${levelName}: damaging the surviving boss regenerated the defeated boss`
        );
        assert.equal(defeatedBoss.dead, true, `${levelName}: defeated boss was revived by its twin's health sync`);
        assert.equal(
            defeatedBoss.entState,
            EntityState.DEAD,
            `${levelName}: defeated boss returned to active combat state`
        );
    } finally {
        GlobalState.sessionsByToken.delete(token);
        GlobalState.levelEntities.delete(scope);
    }
}

function testClientHealingCannotRestoreBossHealth(
    levelName: string,
    bossName: string
): void {
    const levelInstanceId = `back-alley-client-heal-${levelName}`;
    const scope = getLevelScopeKey(levelName, levelInstanceId);
    const boss = createBoss(83_001, bossName, 500);
    const token = levelName.endsWith('Hard') ? 84_002 : 84_001;
    boss.clientReportedDamageLifeNonce = 0;
    boss.clientReportedDamageByToken = new Map([[token, 500]]);
    const sent: Array<{ packetId: number; payload: Buffer }> = [];
    const client = {
        token,
        currentLevel: levelName,
        currentRoomId: 8,
        levelInstanceId,
        playerSpawned: true,
        clientEntID: token + 1000,
        authoritativeCurrentHp: 1000,
        character: {
            name: `${levelName}ClientHealTester`,
            CurrentLevel: { name: levelName, x: 0, y: 0 }
        },
        entityIdAliases: new Map<number, number>(),
        knownEntityIds: new Set<number>([boss.id]),
        entities: new Map([[boss.id, boss]]),
        send(packetId: number, payload: Buffer): void {
            sent.push({ packetId, payload });
        }
    };
    GlobalState.levelEntities.set(scope, new Map([[boss.id, boss]]));
    GlobalState.sessionsByToken.set(token, client as never);

    try {
        const handled = (CombatHandler as any).recordClientHostileHpDelta(
            client,
            scope,
            boss.id,
            boss.id,
            boss,
            400
        );

        assert.equal(handled, true, `${levelName}: boss heal report was not handled`);
        assert.equal(boss.hp, 500, `${levelName}: client heal changed canonical boss HP`);
        assert.equal(
            boss.clientReportedDamageByToken.get(token),
            500,
            `${levelName}: client heal erased recorded boss damage`
        );
        assert.equal(sent.length, 1, `${levelName}: client heal was not corrected`);
        assert.equal(sent[0].packetId, 0x78, `${levelName}: correction used the wrong packet`);
        assert.equal(
            sent[0].payload.equals((CombatHandler as any).buildHpDeltaPayload(boss.id, -400)),
            true,
            `${levelName}: correction did not remove the client-side heal`
        );

        boss.hp = 0;
        boss.healthDelta = -boss.maxHp;
        boss.health_delta = -boss.maxHp;
        boss.dead = true;
        boss.entState = EntityState.DEAD;
        boss.clientReportedDamageByToken.set(token, boss.maxHp);
        sent.length = 0;

        (CombatHandler as any).recordClientHostileHpDelta(
            client,
            scope,
            boss.id,
            boss.id,
            boss,
            boss.maxHp
        );

        assert.equal(boss.hp, 0, `${levelName}: defeated boss regained canonical HP`);
        assert.equal(boss.dead, true, `${levelName}: defeated boss was revived by a client heal`);
        assert.equal(boss.entState, EntityState.DEAD, `${levelName}: defeated boss returned to active state`);
        assert.equal(
            boss.clientReportedDamageByToken.get(token),
            boss.maxHp,
            `${levelName}: revive report erased the lethal damage record`
        );
        assert.equal(sent.length, 1, `${levelName}: revive report was not corrected`);
    } finally {
        GlobalState.sessionsByToken.delete(token);
        GlobalState.levelEntities.delete(scope);
    }
}

function buildDestroyEntityPayload(entityId: number): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod4(entityId);
    bb.writeMethod15(true);
    return bb.toBuffer();
}

async function testDamagedClientAuthorityBossDestroyIsFinal(
    levelName: string,
    bossName: string,
    token: number,
    completeFromTelemetry: boolean = false
): Promise<void> {
    const levelInstanceId = `back-alley-final-death-${levelName}`;
    const scope = getLevelScopeKey(levelName, levelInstanceId);
    const boss = createBoss(85_000 + token, bossName, 500);
    const derivedMaxHp = (CombatHandler as any).estimateHostileMaxHp(boss, levelName);
    assert.ok(derivedMaxHp > 1, `${levelName}: could not derive the live boss health pool`);
    boss.maxHp = derivedMaxHp;
    boss.hp = derivedMaxHp;
    boss.healthDelta = 0;
    boss.health_delta = 0;
    if (completeFromTelemetry) {
        boss.clientSpawned = false;
        boss.hybridCanonicalHostile = true;
    }
    const sent: Array<{ packetId: number; payload: Buffer }> = [];
    const client = {
        token,
        userId: token,
        currentLevel: levelName,
        currentRoomId: 8,
        levelInstanceId,
        playerSpawned: true,
        clientEntID: token + 1000,
        authoritativeCurrentHp: 1000,
        character: {
            name: `${levelName}FinalDeathTester`,
            CurrentLevel: { name: levelName, x: 0, y: 0 },
            missions: {}
        },
        entityIdAliases: new Map<number, number>(),
        knownEntityIds: new Set<number>([boss.id]),
        entities: new Map([[boss.id, boss]]),
        activeDungeonCutsceneScope: '',
        activeDungeonCutsceneRoomId: 0,
        lastDungeonCutsceneStartAt: 0,
        send(packetId: number, payload: Buffer): void {
            sent.push({ packetId, payload });
        }
    };
    GlobalState.levelEntities.set(scope, new Map([[boss.id, boss]]));
    GlobalState.sessionsByToken.set(token, client as never);

    try {
        (CombatHandler as any).recordClientHostileHpDelta(
            client,
            scope,
            boss.id,
            boss.id,
            boss,
            completeFromTelemetry ? -derivedMaxHp : -1
        );
        assert.equal(boss.playerDamageContributed, true, `${levelName}: boss damage was not recorded`);

        if (!completeFromTelemetry) {
            await CombatHandler.handleEntityDestroy(client as never, buildDestroyEntityPayload(boss.id));
        }

        assert.equal(boss.hp, 0, `${levelName}: boss destroy was corrected back to positive HP`);
        assert.equal(boss.dead, true, `${levelName}: damaged boss destroy did not commit death`);
        assert.equal(boss.destroyed, true, `${levelName}: damaged boss was allowed to respawn`);
        if (completeFromTelemetry) {
            assert.equal(
                sent.some((packet) => packet.packetId === 0x07),
                true,
                `${levelName}: verified HP pool did not send the boss dead state`
            );
            assert.equal(
                sent.some((packet) => packet.packetId === 0x0D),
                false,
                `${levelName}: verified boss was removed before the room script could observe its dead state`
            );
        } else {
            assert.equal(
                sent.some((packet) => packet.packetId === 0x07),
                false,
                `${levelName}: server sent an alive-state correction for the defeated boss`
            );
        }
    } finally {
        DungeonCompletionSystem.reset(scope);
        GlobalState.sessionsByToken.delete(token);
        GlobalState.levelEntities.delete(scope);
        GlobalState.combatContributions.clear();
    }
}

async function testFullBackAlleyEncounterCompletes(): Promise<void> {
    const levelName = 'JC_Mission2';
    const levelInstanceId = 'back-alley-full-encounter';
    const scope = getLevelScopeKey(levelName, levelInstanceId);
    const token = 86_007;
    const mortis = createBoss(172_001, 'GreaterBoneGolem2', 500);
    const seelie = createBoss(172_002, 'GreaterBoneGolem', 500);
    const bosses = [mortis, seelie];
    const sent: Array<{ packetId: number; payload: Buffer }> = [];

    for (const boss of bosses) {
        const maxHp = (CombatHandler as any).estimateHostileMaxHp(boss, levelName);
        boss.maxHp = maxHp;
        boss.hp = maxHp;
        boss.healthDelta = 0;
        boss.health_delta = 0;
        boss.clientSpawned = false;
        boss.hybridCanonicalHostile = true;
    }

    const client = {
        token,
        userId: token,
        currentLevel: levelName,
        currentRoomId: 8,
        levelInstanceId,
        playerSpawned: true,
        clientEntID: token + 1000,
        authoritativeCurrentHp: 1000,
        character: {
            name: 'BackAlleyFullEncounterTester',
            CurrentLevel: { name: levelName, x: 0, y: 0 },
            missions: {}
        },
        entityIdAliases: new Map<number, number>(),
        knownEntityIds: new Set<number>(bosses.map((boss) => boss.id)),
        entities: new Map(bosses.map((boss) => [boss.id, boss])),
        activeDungeonCutsceneScope: '',
        activeDungeonCutsceneRoomId: 0,
        lastDungeonCutsceneStartAt: 0,
        send(packetId: number, payload: Buffer): void {
            sent.push({ packetId, payload });
        }
    };
    GlobalState.levelEntities.set(scope, new Map(bosses.map((boss) => [boss.id, boss])));
    GlobalState.sessionsByToken.set(token, client as never);

    try {
        for (const boss of bosses) {
            (CombatHandler as any).recordClientHostileHpDelta(
                client,
                scope,
                boss.id,
                boss.id,
                boss,
                -boss.maxHp
            );
        }

        assert.equal(mortis.destroyed, true, 'Mortis did not remain permanently dead');
        assert.equal(seelie.destroyed, true, 'Seelie Ravager did not remain permanently dead');
        assert.equal(
            sent.filter((packet) => packet.packetId === 0x07).length,
            2,
            'both local boss entities did not receive a final dead state'
        );
        assert.equal(
            DungeonCompletionSystem.evaluate(scope).objectivesMet,
            true,
            'defeating both Back Alley bosses did not satisfy the dungeon objectives'
        );

        DungeonCompletionSystem.noteCutsceneStart(scope, 8, Date.now());
        assert.equal(DungeonCompletionSystem.noteCutsceneEnd(scope, 8, Date.now() + 1), true);
        assert.equal(
            DungeonCompletionSystem.evaluate(scope).ready,
            true,
            'the post-boss cinematic did not unlock the Back Alley victory screen'
        );
    } finally {
        DungeonCompletionSystem.reset(scope);
        GlobalState.sessionsByToken.delete(token);
        GlobalState.levelEntities.delete(scope);
        GlobalState.combatContributions.clear();
    }
}

async function main(): Promise<void> {
    const dataDir = path.resolve(__dirname, '../data');
    LevelConfig.load(dataDir);
    GameData.load(dataDir);

    assert.equal(
        DungeonCompletionConditions.rejectsClientBossHealing('JC_Mission2'),
        true,
        'Back Alley Deals must reject client-side boss healing'
    );
    assert.equal(
        DungeonCompletionConditions.rejectsClientBossHealing('JC_Mission2Hard'),
        true,
        'Back Alley Deals Hard must reject client-side boss healing'
    );
    assert.equal(
        DungeonCompletionConditions.allowsDerivedBossHpCompletion('JC_Mission2'),
        true,
        'Back Alley Deals must accept its verified derived boss health pools'
    );
    assert.equal(
        DungeonCompletionConditions.allowsDerivedBossHpCompletion('JC_Mission2Hard'),
        true,
        'Back Alley Deals Hard must accept its verified derived boss health pools'
    );

    testDamageToSurvivorDoesNotReviveDefeatedTwin(
        'JC_Mission2',
        'GreaterBoneGolem',
        'GreaterBoneGolem2'
    );
    testDamageToSurvivorDoesNotReviveDefeatedTwin(
        'JC_Mission2Hard',
        'GreaterBoneGolemHard',
        'GreaterBoneGolem2Hard'
    );
    testClientHealingCannotRestoreBossHealth('JC_Mission2', 'GreaterBoneGolem2');
    testClientHealingCannotRestoreBossHealth('JC_Mission2Hard', 'GreaterBoneGolem2Hard');
    await testDamagedClientAuthorityBossDestroyIsFinal('JC_Mission2', 'GreaterBoneGolem2', 86_001);
    await testDamagedClientAuthorityBossDestroyIsFinal('JC_Mission2Hard', 'GreaterBoneGolem2Hard', 86_002);
    await testDamagedClientAuthorityBossDestroyIsFinal('JC_Mission2', 'GreaterBoneGolem', 86_003);
    await testDamagedClientAuthorityBossDestroyIsFinal('JC_Mission2Hard', 'GreaterBoneGolemHard', 86_004);
    await testDamagedClientAuthorityBossDestroyIsFinal('JC_Mission2', 'GreaterBoneGolem2', 86_005, true);
    await testDamagedClientAuthorityBossDestroyIsFinal('JC_Mission2Hard', 'GreaterBoneGolem2Hard', 86_006, true);
    await testFullBackAlleyEncounterCompletes();

    console.log('back_alley_boss_health_regression: ok');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
