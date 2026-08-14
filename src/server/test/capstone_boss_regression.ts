/// <reference types="node" />

import { strict as assert } from 'assert';
import * as path from 'path';
import { DungeonCompletionConditions } from '../core/DungeonCompletionConditions';
import { DungeonCompletionSystem } from '../core/DungeonCompletionSystem';
import { EntityState, EntityTeam } from '../core/Entity';
import { GlobalState } from '../core/GlobalState';
import { LevelConfig } from '../core/LevelConfig';
import { getLevelScopeKey } from '../core/LevelScope';
import { EntityHandler } from '../handlers/EntityHandler';
import { MissionHandler } from '../handlers/MissionHandler';

// The Capstone is a scripted multi-phase encounter. a_Room_FinalNephitFight
// alternates NephitLargeEye with two side eyes by calling AddBuff/SetPowers,
// Revive and Kill on the authored cues. The large eye's OnDefeat ends the fight;
// it closes instead of being removed, then BossFight sends room-boss-clear and
// plays cutSceneDefeatBoss.
//
// NephitSpireMarker is not the boss: PhaseFight fires repeating NephitSpire
// attacks, and their marker can report lethal HP many times during one run.
// Accepting that marker as the objective both misidentifies the encounter and
// still misses the authored finale where the large eye remains on screen.

const BOSS_MAX_HP = 134_560;

// The side eyes and crown die during phase changes, so none may complete the run.
const NEPHIT_PARTS_THAT_MUST_NOT_COMPLETE = [
    'NephitLeftEye',
    'NephitRightEye',
    'NephitCrownEye'
];

// Trash observed dying in AC_Mission6 during the reported run.
const OBSERVED_TRASH = ['SpiritDogPackmate', 'SpiritPyrFiendMini2'];

function createDead(id: number, name: string): any {
    return {
        id,
        name,
        EntName: name,
        characterName: `,${name}`,
        // Every Nephit part reports this display name.
        displayName: /^Nephit/.test(name) ? 'Nephit' : undefined,
        isPlayer: false,
        clientSpawned: false,
        team: EntityTeam.ENEMY,
        roomId: 6,
        hp: 0,
        maxHp: BOSS_MAX_HP,
        dead: true,
        destroyed: true,
        entState: EntityState.DEAD
    };
}

function cleanup(scope: string): void {
    DungeonCompletionSystem.reset(scope);
    GlobalState.levelEntities.delete(scope);
}

function defeat(levelName: string, name: string, tag: string, id: number): boolean {
    const scope = getLevelScopeKey(levelName, tag);
    const entity = createDead(id, name);
    GlobalState.levelEntities.set(scope, new Map([[entity.id, entity]]));
    DungeonCompletionSystem.noteEntityDefeated(scope, entity);
    const objectivesMet = DungeonCompletionSystem.evaluate(scope).objectivesMet;
    cleanup(scope);
    return objectivesMet;
}

function verifyLargeEyeCompletesTheRun(levelName: string, bossName: string, ordinal: number): void {
    const boss = createDead(89_000 + ordinal, bossName);
    boss.clientSpawned = true;
    const client = {
        currentLevel: levelName,
        character: {
            CurrentLevel: { name: levelName }
        }
    };

    assert.equal(
        MissionHandler.shouldCompleteDungeonFromBossHpReport(client as never, boss),
        true,
        `${levelName}: the lethal HP-report path rejects ${bossName}`
    );
    assert.equal(
        MissionHandler.shouldIgnoreUnverifiedDungeonBossDefeat(levelName, boss),
        false,
        `${levelName}: the authored large-eye defeat is not treated as client-authoritative`
    );
    assert.equal(
        defeat(levelName, bossName, `capstone-boss-${ordinal}`, 90_000 + ordinal),
        true,
        `${levelName}: defeating ${bossName} does not satisfy the objectives, so the ` +
        `client's kill report is dropped and the run stays on objectives_pending`
    );
}

function verifyAuthoredFightStaysClientPrivate(levelName: string): void {
    const condition = DungeonCompletionConditions.get(levelName);
    assert.equal(EntityHandler.isClientSpawnLevel(levelName), true, `${levelName}: server NPC seeding overrides authored cues`);
    assert.equal(EntityHandler.usesServerAuthorityHostiles(levelName), false);
    assert.equal(condition?.partyHostileSync, 'none', `${levelName}: server sync can override scripted eye phases`);
    for (const name of ['NephitLargeEye', 'NephitLeftEye', 'NephitRightEye', 'NephitCrownEye', 'NephitSpireMarker']) {
        assert.equal(
            DungeonCompletionConditions.sharesClientHostileWithParty(levelName, createDead(88_000, name)),
            false,
            `${levelName}: ${name} is still promoted into shared hostile state`
        );
    }
}

function verifyRoomBossClearCompletesAfterCinematic(levelName: string, ordinal: number): void {
    const condition = DungeonCompletionConditions.get(levelName);
    assert.equal(condition?.acceptRoomBossClearSignal, true, `${levelName}: ignores the authored boss-fight clear`);

    const scope = getLevelScopeKey(levelName, `capstone-room-clear-${ordinal}`);
    assert.equal(DungeonCompletionSystem.noteRoomBossClear(scope, 7, 1_000), true);
    assert.equal(DungeonCompletionSystem.evaluate(scope, 1_001).reason, 'cutscene_gate_pending');
    DungeonCompletionSystem.noteCutsceneStart(scope, 7, 1_100, true);
    DungeonCompletionSystem.noteCutsceneEnd(scope, 7, 1_200);
    assert.equal(
        DungeonCompletionSystem.evaluate(scope, 1_201).ready,
        true,
        `${levelName}: the rank plate does not unlock after the scripted defeat cinematic`
    );
    cleanup(scope);
}

// The Capstone gates its summary on the authored ending cinematic; the boss kill
// alone must not plate it.
function verifyEndingCutsceneStillGates(levelName: string, ordinal: number): void {
    const condition = DungeonCompletionConditions.get(levelName);
    assert.equal(
        condition?.cutscene?.requiredAfterObjectives,
        true,
        `${levelName}: no longer gates completion on its authored ending cinematic`
    );

    const scope = getLevelScopeKey(levelName, `capstone-gate-${ordinal}`);
    const boss = createDead(91_000 + ordinal, (condition?.bossGroups ?? [])[0][0]);
    GlobalState.levelEntities.set(scope, new Map([[boss.id, boss]]));
    DungeonCompletionSystem.noteEntityDefeated(scope, boss);

    const evaluation = DungeonCompletionSystem.evaluate(scope);
    assert.equal(evaluation.objectivesMet, true, `${levelName}: the boss kill did not register`);
    assert.equal(
        evaluation.ready,
        false,
        `${levelName}: the rank plate appeared before the authored ending skit ran`
    );

    cleanup(scope);
}

function verifyNephitPartsDoNotComplete(levelName: string, ordinal: number): void {
    for (const [index, name] of NEPHIT_PARTS_THAT_MUST_NOT_COMPLETE.entries()) {
        assert.equal(
            defeat(levelName, name, `capstone-part-${ordinal}-${index}`, 92_000 + ordinal * 10 + index),
            false,
            `${levelName}: killing ${name} completed the dungeon — the Nephit's eyes die ` +
            `during the fight, so this plates the summary mid-encounter`
        );
    }
}

function verifyObservedTrashDoesNotComplete(levelName: string, ordinal: number): void {
    for (const [index, name] of OBSERVED_TRASH.entries()) {
        assert.equal(
            defeat(levelName, name, `capstone-trash-${ordinal}-${index}`, 93_000 + ordinal * 10 + index),
            false,
            `${levelName}: killing ${name} completed the dungeon`
        );
    }
}

function main(): void {
    LevelConfig.load(path.resolve(__dirname, '../data'));

    verifyLargeEyeCompletesTheRun('AC_Mission6', 'NephitLargeEye', 1);
    verifyLargeEyeCompletesTheRun('AC_Mission6Hard', 'NephitLargeEyeHard', 2);
    // On Hard the authored room can still report the base class name.
    verifyLargeEyeCompletesTheRun('AC_Mission6Hard', 'NephitLargeEye', 3);

    verifyAuthoredFightStaysClientPrivate('AC_Mission6');
    verifyAuthoredFightStaysClientPrivate('AC_Mission6Hard');
    verifyRoomBossClearCompletesAfterCinematic('AC_Mission6', 1);
    verifyRoomBossClearCompletesAfterCinematic('AC_Mission6Hard', 2);
    verifyEndingCutsceneStillGates('AC_Mission6', 1);
    verifyEndingCutsceneStillGates('AC_Mission6Hard', 2);

    verifyNephitPartsDoNotComplete('AC_Mission6', 1);
    verifyNephitPartsDoNotComplete('AC_Mission6Hard', 2);

    assert.equal(defeat('AC_Mission6', 'NephitSpireMarker', 'capstone-spire-1', 94_001), false);
    assert.equal(defeat('AC_Mission6Hard', 'NephitSpireMarkerHard', 'capstone-spire-2', 94_002), false);

    verifyObservedTrashDoesNotComplete('AC_Mission6', 1);
    verifyObservedTrashDoesNotComplete('AC_Mission6Hard', 2);

    console.log('capstone_boss_regression: ok');
}

main();
