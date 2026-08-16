import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PasswordRecord } from '../auth/PasswordAuth';
import { JsonAdapter } from '../database/JsonAdapter';

const PASSWORD: PasswordRecord = {
    passwordKdf: 'scrypt',
    passwordSalt: '00'.repeat(16),
    passwordHash: '11'.repeat(64),
    passwordParams: { N: 16384, r: 8, p: 1, keylen: 64 }
};

function adapterFor(root: string): JsonAdapter {
    const adapter = new JsonAdapter() as any;
    adapter.accountsPath = path.join(root, 'data', 'Accounts.json');
    adapter.savesDir = path.join(root, 'data', 'saves');
    adapter.legacyAccountsPath = path.join(root, 'Accounts.json');
    adapter.legacySavesDir = path.join(root, 'saves');
    return adapter as JsonAdapter;
}

async function main(): Promise<void> {
    JsonAdapter.configureMongoGameDataForTests(null);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'db-json-accounts-'));
    const accountsPath = path.join(root, 'data', 'Accounts.json');

    try {
        const bootstrapRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'db-json-bootstrap-'));
        try {
            const fixtureDir = path.join(bootstrapRoot, 'data', 'fixtures', 'singleplayer');
            await fs.mkdir(path.join(fixtureDir, 'saves'), { recursive: true });
            await fs.writeFile(path.join(fixtureDir, 'Accounts.json'), JSON.stringify([{
                email: 'fixture@example.test',
                user_id: 9,
                ...PASSWORD
            }]));
            await fs.writeFile(path.join(fixtureDir, 'saves', '9.json'), JSON.stringify({
                user_id: 9,
                characters: [{ name: 'FixtureHero' }]
            }));
            const bootstrapAdapter = adapterFor(bootstrapRoot);
            assert.equal(
                (await bootstrapAdapter.getAccount('fixture@example.test'))?.user_id,
                9,
                'a fresh runtime must materialize the synthetic account fixture'
            );
            assert.equal(
                (await bootstrapAdapter.loadCharacters(9))[0]?.name,
                'FixtureHero',
                'a fresh runtime must materialize the matching synthetic save fixture'
            );
        } finally {
            await fs.rm(bootstrapRoot, { recursive: true, force: true });
        }

        const adapters = [adapterFor(root), adapterFor(root)];
        const created = await Promise.all(Array.from({ length: 24 }, (_, index) =>
            adapters[index % adapters.length].createAccount(`concurrent-${index}@example.test`, PASSWORD)
        ));
        const accounts = JSON.parse(await fs.readFile(accountsPath, 'utf8')) as Array<{
            email: string;
            user_id: number;
        }>;
        assert.equal(accounts.length, 24, 'serialized creates must not lose account records');
        assert.equal(new Set(accounts.map((account) => account.user_id)).size, 24, 'account IDs must be unique');
        assert.equal(new Set(created.map((account) => account.user_id)).size, 24, 'callers must receive unique IDs');

        const beforeFailure = await fs.readFile(accountsPath, 'utf8');
        const originalRename = (JsonAdapter as any).renameFile;
        (JsonAdapter as any).renameFile = async () => {
            const error = new Error('injected rename failure') as NodeJS.ErrnoException;
            error.code = 'EIO';
            throw error;
        };
        await assert.rejects(
            () => adapters[0].updateAccountPassword('concurrent-0@example.test', {
                ...PASSWORD,
                passwordHash: '22'.repeat(64)
            }),
            /injected rename failure/
        );
        (JsonAdapter as any).renameFile = originalRename;
        assert.equal(
            await fs.readFile(accountsPath, 'utf8'),
            beforeFailure,
            'failed atomic replacement must leave the primary authority intact'
        );
        assert.equal(
            (await fs.readdir(path.dirname(accountsPath))).filter((name) => name.endsWith('.tmp')).length,
            0,
            'failed account writes must remove temporary files'
        );

        await fs.writeFile(accountsPath, '{broken');
        const recovered = await adapters[0].getAccount('concurrent-0@example.test');
        assert.equal(recovered?.email, 'concurrent-0@example.test', 'validated backup must recover a corrupt primary');

        await fs.rm(`${accountsPath}.bak`, { force: true });
        await assert.rejects(
            () => adapters[0].createAccount('must-not-overwrite@example.test', PASSWORD),
            /Refusing to continue with invalid accounts authority/
        );
        assert.equal(await fs.readFile(accountsPath, 'utf8'), '{broken', 'invalid authority must never be replaced by []');

        console.log('json_account_persistence_regression: PASS');
    } finally {
        (JsonAdapter as any).renameFile = (fromPath: string, toPath: string) => fs.rename(fromPath, toPath);
        await fs.rm(root, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
