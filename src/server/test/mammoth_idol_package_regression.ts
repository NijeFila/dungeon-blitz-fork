import { strict as assert } from 'assert';
import { MammothIdolHandler } from '../handlers/MammothIdolHandler';
import { BitBuffer } from '../network/protocol/bitBuffer';
import { BitReader } from '../network/protocol/bitReader';

type SentPacket = { id: number; payload: Buffer };

function packagePacket(packageId: number): Buffer {
    const packet = new BitBuffer(false);
    packet.writeMethod9(packageId);
    return packet.toBuffer();
}

function createClient() {
    const sentPackets: SentPacket[] = [];
    const saveReasons: string[] = [];
    return {
        character: { name: 'PackageTester', mammothIdols: 10 },
        sentPackets,
        saveReasons,
        sendBitBuffer(id: number, packet: BitBuffer): void {
            sentPackets.push({ id, payload: packet.toBuffer() });
        },
        scheduleCharacterSave(reason: string): void {
            saveReasons.push(reason);
        }
    };
}

function main(): void {
    const client = createClient();

    MammothIdolHandler.handlePackageSelection(client as never, packagePacket(0));
    assert.equal(client.character.mammothIdols, 60, 'package 0 grants its catalog-defined 50 idols');
    assert.deepEqual(client.saveReasons, ['Mammoth Idol package grant']);

    const balanceUpdate = client.sentPackets.find((packet) => packet.id === 0xA1);
    assert.ok(balanceUpdate, 'a successful grant immediately refreshes the displayed idol balance');
    assert.equal(new BitReader(balanceUpdate.payload).readMethod4(), 60);

    MammothIdolHandler.handlePackageSelection(client as never, packagePacket(5));
    assert.equal(client.character.mammothIdols, 2110, 'the largest package grants 2050 idols');

    const packetsBeforeInvalidSelection = client.sentPackets.length;
    MammothIdolHandler.handlePackageSelection(client as never, packagePacket(99));
    assert.equal(client.character.mammothIdols, 2110, 'an unknown package cannot grant client-declared currency');
    assert.equal(client.sentPackets.length, packetsBeforeInvalidSelection);

    console.log('Mammoth Idol package regression checks passed.');
}

main();
