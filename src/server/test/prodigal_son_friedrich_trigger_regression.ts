import { strict as assert } from 'assert';
import * as path from 'path';
import { EntityState, EntityTeam } from '../core/Entity';
import { GlobalState } from '../core/GlobalState';
import { LevelConfig } from '../core/LevelConfig';
import { getClientLevelScope } from '../core/LevelScope';
import { MovementAuthority } from '../core/MovementAuthority';
import { LevelHandler } from '../handlers/LevelHandler';
import { BitBuffer } from '../network/protocol/bitBuffer';

const LEVEL = 'JC_Mission3';
const ROOM_ID = 1971923064;
const TRIGGER_NAME = 'am_Trigger_01';
const TRIGGER_KEY = `${LEVEL}:${ROOM_ID}:${TRIGGER_NAME}`;

function buildMovePayload(entityId: number, deltaX: number, deltaY: number): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod4(entityId);
    bb.writeMethod45(deltaX);
    bb.writeMethod45(deltaY);
    bb.writeMethod45(0);
    bb.writeMethod6(EntityState.ACTIVE, 2);
    bb.writeMethod15(false); // bLeft
    bb.writeMethod15(true); // bRunning
    bb.writeMethod15(false); // bJumping
    bb.writeMethod15(false); // bDropping
    bb.writeMethod15(false); // bBackpedal
    bb.writeMethod15(false); // airborne
    return bb.toBuffer();
}

function createClient(): any {
    const token = 91_301;
    const entityId = 91_302;
    const sentPackets: Array<{ id: number; payload: Buffer }> = [];
    const client: any = {
        token,
        userId: token,
        clientEntID: entityId,
        playerSpawned: true,
        currentLevel: LEVEL,
        levelInstanceId: 'friedrich-trigger-test',
        currentRoomId: ROOM_ID,
        authoritativeMaxHp: 5_000,
        authoritativeCurrentHp: 5_000,
        character: {
            name: 'TriggerTester',
            level: 23,
            class: 'rogue',
            MasterClass: 0,
            CurrentLevel: { name: LEVEL, x: 10_000, y: -1_400 }
        },
        entities: new Map<number, any>(),
        entityIdAliases: new Map<number, number>(),
        knownEntityIds: new Set<number>(),
        triggeredLevelStates: new Set<string>(),
        movementAuthority: MovementAuthority.createState(),
        sentPackets,
        send(id: number, payload: Buffer): void {
            sentPackets.push({ id, payload: Buffer.from(payload) });
        },
        sendBitBuffer(id: number, bb: BitBuffer): void {
            sentPackets.push({ id, payload: bb.toBuffer() });
        }
    };
    const player = {
        id: entityId,
        isPlayer: true,
        ownerToken: token,
        ownerUserId: token,
        team: EntityTeam.PLAYER,
        x: 10_000,
        y: -1_400,
        v: 0,
        hp: 5_000,
        maxHp: 5_000,
        entState: EntityState.ACTIVE,
        roomId: ROOM_ID
    };
    client.entities.set(entityId, player);
    client.knownEntityIds.add(entityId);

    const scope = getClientLevelScope(client);
    GlobalState.levelEntities.set(scope, new Map([[entityId, player]]) as any);
    GlobalState.sessionsByToken.set(token, client);
    GlobalState.refreshSessionIndexes(client);
    MovementAuthority.reset(client, 'spawn', player.x, player.y, Date.now() - 250);
    return client;
}

function main(): void {
    LevelConfig.load(path.resolve(__dirname, '../data'));
    const levelEntities = new Map(GlobalState.levelEntities);
    const sessionsByToken = new Map(GlobalState.sessionsByToken);
    const sessionsByLevelScope = new Map(GlobalState.sessionsByLevelScope);

    try {
        const client = createClient();

        // A door/cutscene correction can place the first accepted movement beyond the narrow
        // authored trigger. Friedrich still has to receive the wake-up trigger in that case.
        LevelHandler.handleEntityIncrementalUpdate(client, buildMovePayload(client.clientEntID, 10, 0));

        assert.equal(client.triggeredLevelStates.has(TRIGGER_KEY), true, 'the already-past trigger was missed');
        assert.equal(
            client.sentPackets.filter((packet: { id: number }) => packet.id === 0x40).length,
            1,
            'the authored room trigger packet was not sent exactly once'
        );

        LevelHandler.handleEntityIncrementalUpdate(client, buildMovePayload(client.clientEntID, 10, 0));
        assert.equal(
            client.sentPackets.filter((packet: { id: number }) => packet.id === 0x40).length,
            1,
            'the recovered room trigger was sent more than once'
        );
        console.log('prodigal_son_friedrich_trigger_regression: ok');
    } finally {
        GlobalState.levelEntities = levelEntities as any;
        GlobalState.sessionsByToken = sessionsByToken as any;
        GlobalState.sessionsByLevelScope = sessionsByLevelScope as any;
    }
}

main();
