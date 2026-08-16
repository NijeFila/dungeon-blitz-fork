import { strict as assert } from 'assert';
import { clearBossAuthority, getBossAuthorityRecordsForScope, noteBossEntity } from '../core/BossAuthority';
import { GlobalState } from '../core/GlobalState';
import { LegendsInn } from '../core/LegendsInn';
import { clearRoomBossScope, getOpenBossScene, markRoomBossEntity, noteBossSceneOpened } from '../core/RoomBossState';

const scope = 'JC_Mission2#scope-disposal-regression';

function main(): void {
    const baseline = {
        levelEntities: GlobalState.levelEntities.size,
        quests: GlobalState.levelQuestProgress.size,
        completions: GlobalState.dungeonCompletions.size,
        cutscenes: GlobalState.dungeonCutscenes.size,
        tutorials: GlobalState.tutorialDungeonWorldStates.size,
        deadHostiles: GlobalState.deadServerAuthorityHostilesByScope.size,
        contributions: GlobalState.combatContributions.size,
        lifeNonces: GlobalState.entityLifeNonces.size,
        rewards: GlobalState.entityLastRewardNonces.size
    };
    for (let run = 0; run < 5000; run += 1) {
        const runScope = `${scope}-${run}`;
        const entity = { id: 41, name: 'GreaterBoneGolem', hp: 100, maxHp: 100 };
        GlobalState.levelEntities.set(runScope, new Map([[41, entity]]));
        GlobalState.levelQuestProgress.set(runScope, {} as never);
        GlobalState.dungeonCompletions.set(runScope, {} as never);
        GlobalState.dungeonCutscenes.set(`${runScope}:7`, {} as never);
        GlobalState.tutorialDungeonWorldStates.set(runScope, {} as never);
        GlobalState.deadServerAuthorityHostilesByScope.set(runScope, new Map());
        GlobalState.combatContributions.set(`${runScope}:41:1`, new Map());
        GlobalState.entityLifeNonces.set(`${runScope}:41`, 1);
        GlobalState.entityLastRewardNonces.set(`${runScope}:41`, 1);
        GlobalState.levelRegistry[runScope] = {};
        noteBossEntity(runScope, entity, () => 100);
        markRoomBossEntity(runScope, 41, 7, 'GreaterBoneGolem');
        noteBossSceneOpened(runScope, 7, 41, 'GreaterBoneGolem');
        GlobalState.disposeLevelScope(runScope);
        GlobalState.disposeLevelScope(runScope);
    }

    assert.equal(GlobalState.levelEntities.size, baseline.levelEntities);
    assert.equal(GlobalState.levelQuestProgress.size, baseline.quests);
    assert.equal(GlobalState.dungeonCompletions.size, baseline.completions);
    assert.equal(GlobalState.dungeonCutscenes.size, baseline.cutscenes);
    assert.equal(GlobalState.tutorialDungeonWorldStates.size, baseline.tutorials);
    assert.equal(GlobalState.deadServerAuthorityHostilesByScope.size, baseline.deadHostiles);
    assert.equal(GlobalState.combatContributions.size, baseline.contributions);
    assert.equal(GlobalState.entityLifeNonces.size, baseline.lifeNonces);
    assert.equal(GlobalState.entityLastRewardNonces.size, baseline.rewards);

    const entity = { id: 41, name: 'GreaterBoneGolem', hp: 100, maxHp: 100 };
    GlobalState.levelEntities.set(scope, new Map([[41, entity]]));
    GlobalState.levelQuestProgress.set(scope, {} as never);
    GlobalState.dungeonCompletions.set(scope, {} as never);
    GlobalState.dungeonCutscenes.set(`${scope}:7`, {} as never);
    GlobalState.tutorialDungeonWorldStates.set(scope, {} as never);
    GlobalState.deadServerAuthorityHostilesByScope.set(scope, new Map());
    GlobalState.combatContributions.set(`${scope}:41:1`, new Map());
    GlobalState.entityLifeNonces.set(`${scope}:41`, 1);
    GlobalState.entityLastRewardNonces.set(`${scope}:41`, 1);
    GlobalState.levelRegistry[scope] = {};
    noteBossEntity(scope, entity, () => 100);
    markRoomBossEntity(scope, 41, 7, 'GreaterBoneGolem');
    noteBossSceneOpened(scope, 7, 41, 'GreaterBoneGolem');
    GlobalState.disposeLevelScope(scope);

    assert.equal(GlobalState.levelEntities.has(scope), false);
    assert.equal(GlobalState.levelQuestProgress.has(scope), false);
    assert.equal(GlobalState.dungeonCompletions.has(scope), false);
    assert.equal(GlobalState.dungeonCutscenes.has(`${scope}:7`), false);
    assert.equal(GlobalState.tutorialDungeonWorldStates.has(scope), false);
    assert.equal(GlobalState.deadServerAuthorityHostilesByScope.has(scope), false);
    assert.equal(GlobalState.combatContributions.has(`${scope}:41:1`), false);
    assert.equal(GlobalState.entityLifeNonces.has(`${scope}:41`), false);
    assert.equal(GlobalState.entityLastRewardNonces.has(`${scope}:41`), false);
    assert.equal(GlobalState.levelRegistry[scope], undefined);
    assert.equal(getBossAuthorityRecordsForScope(scope).length, 0);
    assert.equal(getOpenBossScene(scope), null);

    clearBossAuthority(scope);
    clearRoomBossScope(scope);
    LegendsInn.resetScope(scope);
    console.log('level_scope_disposal_regression: PASS');
}

main();
