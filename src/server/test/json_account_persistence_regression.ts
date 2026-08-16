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
        const created = await Promise.all(Array.from({ length: 100 }, (_, index) =>
            adapters[index % adapters.length].createAccount(`concurrent-${index}@example.test`, PASSWORD)
        ));
        const accounts = JSON.parse(await fs.readFile(accountsPath, 'utf8')) as Array<{
            email: string;
            user_id: number;
        }>;
        assert.equal(accounts.length, 100, 'serialized creates must not lose account records');
        assert.equal(new Set(accounts.map((account) => account.user_id)).size, 100, 'account IDs must be unique');
        assert.equal(new Set(created.map((account) => account.user_id)).size, 100, 'callers must receive unique IDs');

        await Promise.all([
            ...Array.from({ length: 20 }, (_, index) => adapters[index % adapters.length].createAccount(
                `interleaved-${index}@example.test`,
                PASSWORD
            )),
            ...Array.from({ length: 20 }, (_, index) => adapters[index % adapters.length].updateAccountPassword(
                `concurrent-${index}@example.test`,
                { ...PASSWORD, passwordHash: (index % 10).toString(16).repeat(128) }
            ))
        ]);
        const interleavedAccounts = JSON.parse(await fs.readFile(accountsPath, 'utf8')) as Array<{
            email: string;
            user_id: number;
        }>;
        assert.equal(interleavedAccounts.length, 120, 'interleaved creates and updates must retain every record');
        assert.equal(
            new Set(interleavedAccounts.map((account) => account.user_id)).size,
            120,
            'interleaved mutations must preserve unique IDs'
        );

        for (const stage of ['after-journal', 'after-save', 'after-account-commit'] as const) {
            const transactionRoot = await fs.mkdtemp(path.join(os.tmpdir(), `db-json-${stage}-`));
            try {
                const transactionAdapter = adapterFor(transactionRoot);
                JsonAdapter.configureAccountTransactionFaultForTests((observedStage) => {
                    if (observedStage === stage) {
                        throw new Error(`injected ${stage} interruption`);
                    }
                });
                await assert.rejects(
                    () => transactionAdapter.createAccount(`${stage}@example.test`, PASSWORD),
                    new RegExp(`injected ${stage} interruption`)
                );
                JsonAdapter.configureAccountTransactionFaultForTests(null);

                const recoveryAdapter = adapterFor(transactionRoot);
                const recoveredAccount = await recoveryAdapter.getAccount(`${stage}@example.test`);
                const committed = stage === 'after-account-commit';
                assert.equal(Boolean(recoveredAccount), committed, `${stage}: recovery must use account publication as commit point`);
                const recoveredSavePath = path.join(
                    transactionRoot,
                    'data',
                    'saves',
                    `${recoveredAccount?.user_id ?? 1}.json`
                );
                if (committed) {
                    await fs.access(recoveredSavePath);
                } else {
                    await assert.rejects(() => fs.access(recoveredSavePath), /ENOENT/);
                }
                const transactionDir = path.join(transactionRoot, 'data', 'transactions');
                assert.deepEqual(
                    await fs.readdir(transactionDir).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error)),
                    [],
                    `${stage}: recovery must consume the transaction journal`
                );
            } finally {
                JsonAdapter.configureAccountTransactionFaultForTests(null);
                await fs.rm(transactionRoot, { recursive: true, force: true });
            }
        }

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
        JsonAdapter.configureAccountTransactionFaultForTests(null);
        (JsonAdapter as any).renameFile = (fromPath: string, toPath: string) => fs.rename(fromPath, toPath);
        await fs.rm(root, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
