import { Client } from '../core/Client';
import { BitBuffer } from '../network/protocol/bitBuffer';
import { BitReader } from '../network/protocol/bitReader';

export class MammothIdolHandler {
    // These are the amounts displayed by class_63's built-in Mammoth Idol package catalog.
    // The client sends only the selected catalog index; it never declares the grant amount.
    private static readonly PACKAGE_AMOUNTS = [50, 105, 180, 375, 1000, 2050, 220, 480] as const;

    static handlePackageSelection(client: Client, data: Buffer): void {
        if (!client.character) {
            return;
        }

        const reader = new BitReader(data);
        const packageId = reader.readMethod9();
        const amount = MammothIdolHandler.PACKAGE_AMOUNTS[packageId];
        if (amount === undefined) {
            console.log(`[MammothIdolHandler] Unknown Mammoth Idol package ID ${packageId}`);
            return;
        }

        const currentBalance = Math.max(0, Math.round(Number(client.character.mammothIdols ?? 0)));
        client.character.mammothIdols = currentBalance + amount;

        const update = new BitBuffer(false);
        update.writeMethod4(client.character.mammothIdols);
        client.sendBitBuffer(0xA1, update);
        client.scheduleCharacterSave('Mammoth Idol package grant');
    }
}
