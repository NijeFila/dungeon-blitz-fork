import * as fs from 'fs/promises';
import * as path from 'path';
import { IDatabase, Character, DiscordAccountProfile, SponsorAccountMetadata, UserAccount, UserSaveData } from './Database';
import { Config } from '../core/config';
import { GameData } from '../core/GameData';
import { normalizeAccountIdentifier, PasswordRecord } from '../auth/PasswordAuth';
import { GameDataPersistenceAdapter, MongoGameDataAdapter } from './MongoGameDataAdapter';
import { StructuredLogger } from '../core/StructuredLogger';

const persistenceLog = new StructuredLogger('JsonAdapter');

type AccountCreateJournal = {
    version: 1;
    operation: 'create-account';
    account: UserAccount;
    saveFileName: string;
    createdAt: string;
};

type AccountTransactionFaultStage = 'after-journal' | 'after-save' | 'after-account-commit';

export class JsonAdapter implements IDatabase {
    private static readonly renameRetryDelaysMs = [25, 50, 100, 200, 350];
    private static readonly saveQueues = new Map<string, Promise<void>>();
    private static readonly accountMutationQueues = new Map<string, Promise<void>>();
    private static renameFile = (fromPath: string, toPath: string): Promise<void> =>
        fs.rename(fromPath, toPath);
    private static accountTransactionFaultHook: ((stage: AccountTransactionFaultStage) => void) | null = null;
    private static mongoGameData: GameDataPersistenceAdapter | null = Config.ENABLE_MONGO_GAME_DATA
        ? new MongoGameDataAdapter(
            Config.MONGODB_URI,
            Config.MONGODB_DB_NAME,
            Config.MONGODB_ACCOUNTS_COLLECTION,
            Config.MONGODB_SAVES_COLLECTION,
            Config.MONGODB_COUNTERS_COLLECTION
        )
        : null;
    private accountsPath: string;
    private savesDir: string;
    private legacyAccountsPath: string;
    private legacySavesDir: string;

    constructor() {
        this.accountsPath = path.resolve(Config.DATA_DIR, 'data', 'Accounts.json');
        this.savesDir = path.resolve(Config.DATA_DIR, 'data', 'saves');
        this.legacyAccountsPath = path.resolve(Config.DATA_DIR, 'Accounts.json');
        this.legacySavesDir = path.resolve(Config.DATA_DIR, 'saves');
    }

    public static async initializeMongoGameData(): Promise<void> {
        if (!JsonAdapter.mongoGameData) {
            persistenceLog.info('authority.ready', { mode: 'json' });
            return;
        }

        await JsonAdapter.mongoGameData.connect();
        persistenceLog.info('authority.ready', { mode: 'mongo', database: Config.MONGODB_DB_NAME });
    }

    public static async closeMongoGameData(): Promise<void> {
        await JsonAdapter.mongoGameData?.close();
    }

    public static configureMongoGameDataForTests(adapter: GameDataPersistenceAdapter | null): void {
        JsonAdapter.mongoGameData = adapter;
    }

    public static configureAccountTransactionFaultForTests(
        hook: ((stage: AccountTransactionFaultStage) => void) | null
    ): void {
        JsonAdapter.accountTransactionFaultHook = hook;
    }

    private normalizeCharacterName(value: string | null | undefined): string {
        return String(value ?? '').trim().toLowerCase();
    }

    /**
     * The six Rogue lockbox uniques are Mystic-only above Legendary: their tier 3 ("Y") variants
     * carry the ability-bonus rune chains and the red UI treatment, and there is no drop or forge
     * path that grants tier 3. Promoting owned Legendary copies here — on every load and save —
     * migrates existing characters without needing the server offline.
     */
    private static readonly MYSTIC_ROGUE_GEAR_IDS = new Set([1171, 1172, 1173, 1174, 1175, 1176]);
    private static readonly LEGENDARY_TIER = 2;
    private static readonly MYSTIC_TIER = 3;

    private promoteMysticRogueGear(gears: unknown): void {
        if (!Array.isArray(gears)) {
            return;
        }
        for (const gear of gears) {
            if (!gear || typeof gear !== 'object') {
                continue;
            }
            const entry = gear as { gearID?: number; tier?: number };
            if (
                JsonAdapter.MYSTIC_ROGUE_GEAR_IDS.has(Number(entry.gearID ?? 0)) &&
                Number(entry.tier ?? 0) === JsonAdapter.LEGENDARY_TIER
            ) {
                entry.tier = JsonAdapter.MYSTIC_TIER;
            }
        }
    }

    private normalizeCharacterProgress(character: Character | null | undefined): Character | null | undefined {
        if (!character) {
            return character;
        }

        const xp = Math.max(0, Number(character.xp ?? 0));
        const normalizedLevel = GameData.getPlayerLevelFromXp(xp);
        if (Number(character.level ?? 1) !== normalizedLevel) {
            character.level = normalizedLevel;
        }

        this.promoteMysticRogueGear((character as { equippedGears?: unknown }).equippedGears);
        this.promoteMysticRogueGear((character as { inventoryGears?: unknown }).inventoryGears);

        return character;
    }

    private async readSaveFile(userId: number): Promise<UserSaveData | null> {
        for (const savePath of [
            path.join(this.savesDir, `${userId}.json`),
            path.join(this.legacySavesDir, `${userId}.json`)
        ]) {
            try {
                const data = await fs.readFile(savePath, 'utf8');
                if (!data.trim()) {
                    return { user_id: userId, characters: [] };
                }
                return JSON.parse(data) as UserSaveData;
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    continue;
                }
                if (err instanceof SyntaxError) {
                    persistenceLog.error('save.invalid_json', { path: savePath });
                    return null;
                }
                throw err;
            }
        }

        return null;
    }

    private async ensureSavesDir(): Promise<void> {
        try {
            await fs.mkdir(this.savesDir, { recursive: true });
        } catch (err) {
            // Ignore if exists
        }
    }

    private static delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private static isRetryableRenameError(err: any): boolean {
        return ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(String(err?.code ?? ''));
    }

    private async renameWithRetry(tmpPath: string, savePath: string): Promise<void> {
        for (let attempt = 0; attempt <= JsonAdapter.renameRetryDelaysMs.length; attempt += 1) {
            try {
                await JsonAdapter.renameFile(tmpPath, savePath);
                return;
            } catch (err: any) {
                const delayMs = JsonAdapter.renameRetryDelaysMs[attempt];
                if (!JsonAdapter.isRetryableRenameError(err) || delayMs == null) {
                    throw err;
                }

                await JsonAdapter.delay(delayMs);
            }
        }

        throw new Error(`[JsonAdapter] Failed to rename ${tmpPath} to ${savePath}`);
    }

    private async syncDirectory(directoryPath: string): Promise<void> {
        let handle: fs.FileHandle | null = null;
        try {
            handle = await fs.open(directoryPath, 'r');
            await handle.sync();
        } catch (err: any) {
            // Windows does not consistently allow opening a directory handle. The file itself
            // is still flushed before rename; POSIX hosts additionally get the directory flush.
            if (!['EISDIR', 'EPERM', 'EACCES', 'EINVAL', 'ENOTSUP'].includes(String(err?.code ?? ''))) {
                throw err;
            }
        } finally {
            await handle?.close().catch(() => undefined);
        }
    }

    private get accountTransactionDir(): string {
        return path.join(path.dirname(this.accountsPath), 'transactions');
    }

    private async writeAccountCreateJournal(account: UserAccount): Promise<string> {
        await fs.mkdir(this.accountTransactionDir, { recursive: true });
        const journalPath = path.join(
            this.accountTransactionDir,
            `account-create-${account.user_id}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
        );
        const tmpPath = `${journalPath}.${process.pid}.tmp`;
        const journal: AccountCreateJournal = {
            version: 1,
            operation: 'create-account',
            account,
            saveFileName: `${account.user_id}.json`,
            createdAt: new Date().toISOString()
        };
        let handle: fs.FileHandle | null = null;
        try {
            handle = await fs.open(tmpPath, 'wx');
            await handle.writeFile(JSON.stringify(journal, null, 2), 'utf8');
            await handle.sync();
            await handle.close();
            handle = null;
            await this.renameWithRetry(tmpPath, journalPath);
            await this.syncDirectory(this.accountTransactionDir);
            return journalPath;
        } finally {
            await handle?.close().catch(() => undefined);
            await fs.rm(tmpPath, { force: true }).catch(() => undefined);
        }
    }

    private parseAccountCreateJournal(raw: string, journalPath: string): AccountCreateJournal {
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (error: any) {
            throw new Error(`[JsonAdapter] Invalid account transaction journal ${journalPath}: ${error?.message ?? error}`);
        }
        if (!parsed || typeof parsed !== 'object') {
            throw new Error(`[JsonAdapter] Invalid account transaction journal ${journalPath}: expected object`);
        }
        const journal = parsed as Partial<AccountCreateJournal>;
        const account = journal.account as UserAccount | undefined;
        const userId = Math.max(0, Math.round(Number(account?.user_id ?? 0)));
        if (
            journal.version !== 1 ||
            journal.operation !== 'create-account' ||
            !account ||
            userId <= 0 ||
            !normalizeAccountIdentifier(account.email) ||
            journal.saveFileName !== `${userId}.json`
        ) {
            throw new Error(`[JsonAdapter] Invalid account transaction journal ${journalPath}: unsupported shape`);
        }
        return journal as AccountCreateJournal;
    }

    private async removeAccountCreateJournal(journalPath: string): Promise<void> {
        await fs.rm(journalPath, { force: true });
        await this.syncDirectory(this.accountTransactionDir);
    }

    private async recoverAccountCreateTransactions(accounts: UserAccount[]): Promise<void> {
        let journalNames: string[];
        try {
            journalNames = (await fs.readdir(this.accountTransactionDir))
                .filter((name) => /^account-create-\d+-.*\.json$/.test(name))
                .sort();
        } catch (err: any) {
            if (err?.code === 'ENOENT') {
                return;
            }
            throw err;
        }

        for (const journalName of journalNames) {
            const journalPath = path.join(this.accountTransactionDir, journalName);
            const journal = this.parseAccountCreateJournal(await fs.readFile(journalPath, 'utf8'), journalPath);
            const accountExists = accounts.some((account) => account.user_id === journal.account.user_id);
            const savePath = path.join(this.savesDir, journal.saveFileName);
            if (accountExists) {
                try {
                    await fs.access(savePath);
                } catch (err: any) {
                    if (err?.code !== 'ENOENT') {
                        throw err;
                    }
                    await this.performSaveCharacters(journal.account.user_id, [], savePath);
                }
            } else {
                // Account publication is the commit point. A save left before that point is an
                // orphan and is rolled back; a published account is completed above.
                await fs.rm(savePath, { force: true });
            }
            await this.removeAccountCreateJournal(journalPath);
        }
    }

    private async prepareAccountCreate(account: UserAccount): Promise<string> {
        const journalPath = await this.writeAccountCreateJournal(account);
        JsonAdapter.accountTransactionFaultHook?.('after-journal');
        await this.performSaveCharacters(account.user_id, [], path.join(this.savesDir, `${account.user_id}.json`));
        JsonAdapter.accountTransactionFaultHook?.('after-save');
        return journalPath;
    }

    private async performSaveCharacters(
        userId: number,
        characters: Character[],
        savePath: string
    ): Promise<void> {
        await this.ensureSavesDir();
        const normalizedCharacters = this.mergeLiveSessionCharacter(
            userId,
            Array.isArray(characters) ? characters : []
        );
        // The read-back below only exists to guard against clobbering a populated save with
        // an empty list, so only pay for it when the list actually is empty. Every level
        // transfer runs this path twice; on Mongo each skipped read is a network round trip
        // that was blocking the client's packet queue.
        if (normalizedCharacters.length === 0) {
            const existing = JsonAdapter.mongoGameData
                ? { user_id: userId, characters: await JsonAdapter.mongoGameData.loadCharacters(userId) }
                : await this.readSaveFile(userId);

            if (existing && Array.isArray(existing.characters) && existing.characters.length > 0) {
                persistenceLog.warn('save.empty_overwrite_rejected', { path: savePath, userId });
                return;
            }
        }

        if (JsonAdapter.mongoGameData) {
            await JsonAdapter.mongoGameData.saveCharacters(userId, normalizedCharacters);
            return;
        }

        const saveData: UserSaveData = { user_id: userId, characters: normalizedCharacters };
        const tmpPath = `${savePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

        try {
            await fs.writeFile(tmpPath, JSON.stringify(saveData, null, 2));
            await this.renameWithRetry(tmpPath, savePath);
        } finally {
            await fs.rm(tmpPath, { force: true }).catch(() => undefined);
        }
    }

    private mergeLiveSessionCharacter(userId: number, characters: Character[]): Character[] {
        const nextCharacters = Array.isArray(characters)
            ? characters.map((entry) => this.normalizeCharacterProgress(entry) as Character)
            : [];

        try {
            const { GlobalState } = require('../core/GlobalState') as typeof import('../core/GlobalState');
            const liveSessions = GlobalState.getActiveSessionsByUserId(userId);
            for (const session of liveSessions) {
                const liveCharacter = this.normalizeCharacterProgress(session.character);
                if (!liveCharacter) {
                    continue;
                }

                const normalizedName = this.normalizeCharacterName(liveCharacter?.name);
                const index = nextCharacters.findIndex((entry) =>
                    this.normalizeCharacterName(entry?.name) === normalizedName
                );

                if (index >= 0) {
                    nextCharacters[index] = liveCharacter;
                } else {
                    nextCharacters.push(liveCharacter);
                }
            }
        } catch {
            return nextCharacters;
        }

        return nextCharacters;
    }

    private static async waitForQueuedSave(savePath: string): Promise<void> {
        const pendingSave = JsonAdapter.saveQueues.get(savePath);
        if (!pendingSave) {
            return;
        }

        await pendingSave.catch(() => undefined);
    }

    private normalizeEmailAliases(value: unknown): string[] {
        if (!Array.isArray(value)) {
            return [];
        }

        return Array.from(new Set(
            value
                .map((entry) => normalizeAccountIdentifier(entry))
                .filter((entry) => entry.length > 0)
        ));
    }

    private parseAccounts(data: string, sourcePath: string): UserAccount[] {
        if (!data.trim()) {
            return [];
        }

        const parsed = JSON.parse(data) as unknown;
        if (!Array.isArray(parsed)) {
            throw new Error(`[JsonAdapter] Accounts JSON at ${sourcePath} is not an array`);
        }

        const accounts = parsed.map((entry, index) => {
            const candidate = entry as Partial<UserAccount> | null;
            const email = normalizeAccountIdentifier(candidate?.email);
            const userId = Number(candidate?.user_id);
            if (!candidate || !email || !Number.isSafeInteger(userId) || userId <= 0) {
                throw new Error(`[JsonAdapter] Invalid account record ${index} at ${sourcePath}`);
            }

            const emailAliases = this.normalizeEmailAliases(candidate.emailAliases);
            return {
                ...candidate,
                email,
                ...(emailAliases.length > 0 ? { emailAliases } : {}),
                user_id: userId
            } as UserAccount;
        });

        const userIds = new Set<number>();
        const identifiers = new Set<string>();
        const discordIds = new Set<string>();
        for (const account of accounts) {
            if (userIds.has(account.user_id)) {
                throw new Error(`[JsonAdapter] Duplicate account user_id ${account.user_id} at ${sourcePath}`);
            }
            userIds.add(account.user_id);

            for (const identifier of [account.email, ...this.normalizeEmailAliases(account.emailAliases)]) {
                if (identifiers.has(identifier)) {
                    throw new Error(`[JsonAdapter] Duplicate account identifier ${identifier} at ${sourcePath}`);
                }
                identifiers.add(identifier);
            }

            const discordId = this.normalizeDiscordId(account.discordId);
            if (discordId) {
                if (discordIds.has(discordId)) {
                    throw new Error(`[JsonAdapter] Duplicate Discord account ${discordId} at ${sourcePath}`);
                }
                discordIds.add(discordId);
            }
        }

        return accounts;
    }

    private async readAccountsFile(accountsPath: string): Promise<UserAccount[]> {
        return this.parseAccounts(await fs.readFile(accountsPath, 'utf8'), accountsPath);
    }

    private async readAccountsFromDisk(): Promise<UserAccount[]> {
        try {
            const accounts = await this.readAccountsFile(this.accountsPath);
            await this.recoverAccountCreateTransactions(accounts);
            await this.ensureBootstrapSaves(accounts);
            return accounts;
        } catch (err: any) {
            if (err?.code === 'ENOENT') {
                try {
                    const legacyAccounts = await this.readAccountsFile(this.legacyAccountsPath);
                    await this.recoverAccountCreateTransactions(legacyAccounts);
                    return legacyAccounts;
                } catch (legacyErr: any) {
                    if (legacyErr?.code === 'ENOENT') {
                        const bootstrapAccounts = await this.materializeBootstrapData();
                        await this.recoverAccountCreateTransactions(bootstrapAccounts);
                        return bootstrapAccounts;
                    }
                    throw legacyErr;
                }
            }

            try {
                const backup = await this.readAccountsFile(`${this.accountsPath}.bak`);
                persistenceLog.error('account_authority.backup_recovered', { path: this.accountsPath });
                await this.recoverAccountCreateTransactions(backup);
                return backup;
            } catch (backupErr: any) {
                throw new Error(
                    `[JsonAdapter] Refusing to continue with invalid accounts authority at ${this.accountsPath}: `
                    + `${err?.message ?? err}. Backup recovery failed: ${backupErr?.message ?? backupErr}`
                );
            }
        }
    }

    private async ensureBootstrapSaves(accounts: UserAccount[]): Promise<void> {
        const accountIds = new Set(accounts.map((account) => account.user_id));
        let fixtures: string[];
        try {
            fixtures = await fs.readdir(path.join(path.dirname(this.accountsPath), 'fixtures', 'singleplayer', 'saves'));
        } catch (err: any) {
            if (err?.code === 'ENOENT') {
                return;
            }
            throw err;
        }

        await this.ensureSavesDir();
        await Promise.all(fixtures
            .filter((name) => /^\d+\.json$/.test(name))
            .filter((name) => accountIds.has(Number.parseInt(name, 10)))
            .map(async (name) => {
                const destination = path.join(this.savesDir, name);
                try {
                    const fixturePath = path.join(
                        path.dirname(this.accountsPath),
                        'fixtures',
                        'singleplayer',
                        'saves',
                        name
                    );
                    await fs.copyFile(fixturePath, destination, fs.constants.COPYFILE_EXCL);
                } catch (err: any) {
                    if (err?.code !== 'EEXIST') {
                        throw err;
                    }
                }
            }));
    }

    private async materializeBootstrapData(): Promise<UserAccount[]> {
        let accounts: UserAccount[];
        try {
            accounts = await this.readAccountsFile(path.join(
                path.dirname(this.accountsPath),
                'fixtures',
                'singleplayer',
                'Accounts.json'
            ));
        } catch (err: any) {
            if (err?.code === 'ENOENT') {
                return [];
            }
            throw err;
        }

        await this.writeAccountsAtomic(accounts);
        await this.ensureBootstrapSaves(accounts);
        persistenceLog.info('fixture.initialized', { accountCount: accounts.length });
        return accounts;
    }

    private async writeAccountsAtomic(accounts: UserAccount[]): Promise<void> {
        await fs.mkdir(path.dirname(this.accountsPath), { recursive: true });
        // Validate before touching either the primary or its last-known-good backup.
        this.parseAccounts(JSON.stringify(accounts), this.accountsPath);

        try {
            const currentAccounts = await this.readAccountsFile(this.accountsPath);
            const backupPath = `${this.accountsPath}.bak`;
            const backupTmpPath = `${backupPath}.${process.pid}.${Date.now()}.tmp`;
            let backupHandle: fs.FileHandle | null = null;
            try {
                backupHandle = await fs.open(backupTmpPath, 'wx');
                await backupHandle.writeFile(JSON.stringify(currentAccounts, null, 2), 'utf8');
                await backupHandle.sync();
                await backupHandle.close();
                backupHandle = null;
                await this.renameWithRetry(backupTmpPath, backupPath);
                await this.syncDirectory(path.dirname(this.accountsPath));
            } finally {
                await backupHandle?.close().catch(() => undefined);
                await fs.rm(backupTmpPath, { force: true }).catch(() => undefined);
            }
        } catch (err: any) {
            if (err?.code !== 'ENOENT') {
                throw err;
            }
        }

        const tmpPath = `${this.accountsPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
        let handle: fs.FileHandle | null = null;
        try {
            handle = await fs.open(tmpPath, 'wx');
            await handle.writeFile(JSON.stringify(accounts, null, 2), 'utf8');
            await handle.sync();
            await handle.close();
            handle = null;
            await this.renameWithRetry(tmpPath, this.accountsPath);
            await this.syncDirectory(path.dirname(this.accountsPath));
        } finally {
            await handle?.close().catch(() => undefined);
            await fs.rm(tmpPath, { force: true }).catch(() => undefined);
        }
    }

    private async mutateAccounts<T>(
        mutation: (accounts: UserAccount[]) => Promise<T> | T,
        afterCommit?: () => Promise<void>
    ): Promise<T> {
        const queueKey = this.accountsPath;
        const previous = JsonAdapter.accountMutationQueues.get(queueKey) ?? Promise.resolve();
        let result!: T;
        const current = previous
            .catch(() => undefined)
            .then(async () => {
                const accounts = await this.readAccountsFromDisk();
                result = await mutation(accounts);
                await this.writeAccountsAtomic(accounts);
                await afterCommit?.();
            });

        JsonAdapter.accountMutationQueues.set(queueKey, current);
        try {
            await current;
            return result;
        } finally {
            if (JsonAdapter.accountMutationQueues.get(queueKey) === current) {
                JsonAdapter.accountMutationQueues.delete(queueKey);
            }
        }
    }

    private accountMatchesEmail(account: UserAccount, normalizedEmail: string): boolean {
        if (normalizeAccountIdentifier(account.email) === normalizedEmail) {
            return true;
        }

        return this.normalizeEmailAliases(account.emailAliases).includes(normalizedEmail);
    }

    private normalizeDiscordId(value: unknown): string {
        return String(value ?? '').trim();
    }

    private assertUsableDiscordProfile(discordUser: DiscordAccountProfile): { discordId: string; discordEmail: string } {
        const discordId = this.normalizeDiscordId(discordUser?.id);
        const discordEmail = normalizeAccountIdentifier(discordUser?.email);
        if (!discordId) {
            throw new Error('Cannot link Discord without a Discord user id.');
        }
        if (!discordEmail || discordUser.emailVerified !== true) {
            throw new Error('Discord account must include a verified email before it can be linked.');
        }
        return { discordId, discordEmail };
    }

    private applySponsorMetadata(account: UserAccount, sponsor?: SponsorAccountMetadata): UserAccount {
        if (!sponsor) {
            return account;
        }

        const sponsorEligible = sponsor.sponsorEligible === true;
        const sponsorStatus = String(sponsor.sponsorStatus ?? '').trim() ||
            (sponsorEligible ? 'active' : 'none');

        return {
            ...account,
            isSponsor: sponsorEligible,
            sponsorEligible,
            sponsorStatus,
            sponsorSource: String(sponsor.sponsorSource ?? '').trim() || account.sponsorSource,
            sponsorCheckedAt: String(sponsor.sponsorCheckedAt ?? '').trim() || new Date().toISOString(),
            sponsorRecordId: String(sponsor.sponsorRecordId ?? '').trim() || account.sponsorRecordId
        };
    }

    private applyDiscordProfile(
        account: UserAccount,
        discordUser: DiscordAccountProfile,
        sponsor?: SponsorAccountMetadata
    ): UserAccount {
        const { discordId, discordEmail } = this.assertUsableDiscordProfile(discordUser);
        const displayName = String(
            discordUser.displayName ||
            discordUser.globalName ||
            discordUser.username ||
            ''
        ).trim();
        const sponsorStatus = String(account.sponsorStatus ?? '').trim() || 'unknown';

        return this.applySponsorMetadata({
            ...account,
            discordId,
            discordUsername: String(discordUser.username ?? '').trim(),
            discordGlobalName: String(discordUser.globalName ?? '').trim(),
            discordDisplayName: displayName,
            discordEmail,
            discordEmailVerified: true,
            discordAvatar: String(discordUser.avatar ?? '').trim(),
            discordLinkedAt: account.discordLinkedAt || new Date().toISOString(),
            discordSyncRequired: true,
            accountSource: account.accountSource || 'discord_oauth',
            sponsorStatus,
            sponsorEligible: Boolean(account.sponsorEligible ?? false)
        }, sponsor);
    }

    private async readAccounts(): Promise<UserAccount[]> {
        const pendingMutation = JsonAdapter.accountMutationQueues.get(this.accountsPath);
        if (pendingMutation) {
            await pendingMutation;
        }
        return this.readAccountsFromDisk();
    }

    public async getAccount(email: string): Promise<UserAccount | null> {
        if (JsonAdapter.mongoGameData) {
            return JsonAdapter.mongoGameData.getAccount(email);
        }
        const normalizedEmail = normalizeAccountIdentifier(email);
        if (!normalizedEmail) {
            return null;
        }

        const accounts = await this.readAccounts();
        return accounts.find(acc => this.accountMatchesEmail(acc, normalizedEmail)) ?? null;
    }

    public async getAccountById(userId: number): Promise<UserAccount | null> {
        if (JsonAdapter.mongoGameData) {
            return JsonAdapter.mongoGameData.getAccountById(userId);
        }
        const normalizedUserId = Math.max(0, Math.round(Number(userId ?? 0)));
        if (!normalizedUserId) {
            return null;
        }

        const accounts = await this.readAccounts();
        return accounts.find(acc => acc.user_id === normalizedUserId) ?? null;
    }

    public async getAccountId(email: string): Promise<number | null> {
        if (JsonAdapter.mongoGameData) {
            return JsonAdapter.mongoGameData.getAccountId(email);
        }
        const account = await this.getAccount(email);
        return account ? account.user_id : null;
    }

    public async findAccountByDiscordId(discordId: string): Promise<UserAccount | null> {
        if (JsonAdapter.mongoGameData) {
            return JsonAdapter.mongoGameData.findAccountByDiscordId(discordId);
        }
        const normalizedDiscordId = this.normalizeDiscordId(discordId);
        if (!normalizedDiscordId) {
            return null;
        }

        const accounts = await this.readAccounts();
        return accounts.find(acc => this.normalizeDiscordId(acc.discordId) === normalizedDiscordId) ?? null;
    }

    public async linkDiscordToAccount(
        userId: number,
        discordUser: DiscordAccountProfile,
        sponsor?: SponsorAccountMetadata
    ): Promise<UserAccount> {
        if (JsonAdapter.mongoGameData) {
            return JsonAdapter.mongoGameData.linkDiscordToAccount(userId, discordUser, sponsor);
        }
        await fs.mkdir(path.dirname(this.accountsPath), { recursive: true });

        const normalizedUserId = Math.max(0, Math.round(Number(userId ?? 0)));
        const { discordId } = this.assertUsableDiscordProfile(discordUser);
        if (!normalizedUserId) {
            throw new Error('Cannot link Discord without a game account.');
        }

        return this.mutateAccounts((accounts) => {
            const accountIndex = accounts.findIndex(acc => acc.user_id === normalizedUserId);
            if (accountIndex < 0) {
                throw new Error('Game account not found.');
            }

            const existingDiscordOwner = accounts.find(acc =>
                acc.user_id !== normalizedUserId &&
                this.normalizeDiscordId(acc.discordId) === discordId
            );
            if (existingDiscordOwner) {
                throw new Error('Discord account is already linked to another game account.');
            }

            const existingAccountDiscordId = this.normalizeDiscordId(accounts[accountIndex].discordId);
            if (existingAccountDiscordId && existingAccountDiscordId !== discordId) {
                throw new Error('Game account is already linked to another Discord account.');
            }

            const account = this.applyDiscordProfile(accounts[accountIndex], discordUser, sponsor);
            accounts[accountIndex] = account;
            return account;
        });
    }

    public async createDiscordAccount(
        email: string,
        discordUser: DiscordAccountProfile,
        sponsor?: SponsorAccountMetadata
    ): Promise<UserAccount> {
        if (JsonAdapter.mongoGameData) {
            return JsonAdapter.mongoGameData.createDiscordAccount(email, discordUser, sponsor);
        }
        await this.ensureSavesDir();
        await fs.mkdir(path.dirname(this.accountsPath), { recursive: true });

        const normalizedEmail = normalizeAccountIdentifier(email);
        const { discordId, discordEmail } = this.assertUsableDiscordProfile(discordUser);
        if (!normalizedEmail) {
            throw new Error('Cannot create Discord account without a generated email.');
        }

        let journalPath: string | null = null;
        return this.mutateAccounts(async (accounts) => {
            const existingDiscordIndex = accounts.findIndex(acc => this.normalizeDiscordId(acc.discordId) === discordId);
            if (existingDiscordIndex >= 0) {
                const account = this.applyDiscordProfile(accounts[existingDiscordIndex], discordUser, sponsor);
                accounts[existingDiscordIndex] = account;
                return account;
            }

            const existingEmailOwner = accounts.find(acc => this.accountMatchesEmail(acc, normalizedEmail));
            if (existingEmailOwner) {
                throw new Error('Discord-derived account email is already used by another game account.');
            }

            const maxId = accounts.length > 0 ? Math.max(...accounts.map(a => a.user_id)) : 0;
            const newId = maxId + 1;
            const aliases = discordEmail !== normalizedEmail &&
                !accounts.some(acc => this.accountMatchesEmail(acc, discordEmail))
                ? [discordEmail]
                : [];
            const account = this.applyDiscordProfile({
                email: normalizedEmail,
                ...(aliases.length > 0 ? { emailAliases: aliases } : {}),
                user_id: newId,
                accountSource: 'discord_oauth'
            }, discordUser, sponsor);

            journalPath = await this.prepareAccountCreate(account);
            accounts.push(account);
            return account;
        }, async () => {
            if (!journalPath) {
                return;
            }
            JsonAdapter.accountTransactionFaultHook?.('after-account-commit');
            await this.removeAccountCreateJournal(journalPath);
        });
    }

    public async createAccount(email: string, passwordRecord: PasswordRecord): Promise<UserAccount> {
        if (JsonAdapter.mongoGameData) {
            return JsonAdapter.mongoGameData.createAccount(email, passwordRecord);
        }
        await this.ensureSavesDir();
        await fs.mkdir(path.dirname(this.accountsPath), { recursive: true });

        const normalizedEmail = normalizeAccountIdentifier(email);
        if (!normalizedEmail) {
            throw new Error('Cannot create account without an email.');
        }

        let journalPath: string | null = null;
        return this.mutateAccounts(async (accounts) => {
            const existing = accounts.find(acc => this.accountMatchesEmail(acc, normalizedEmail));
            if (existing) {
                throw new Error('Account already exists.');
            }

            const maxId = accounts.length > 0 ? Math.max(...accounts.map(a => a.user_id)) : 0;
            const newId = maxId + 1;
            const account: UserAccount = {
                email: normalizedEmail,
                user_id: newId,
                ...passwordRecord
            };

            journalPath = await this.prepareAccountCreate(account);
            accounts.push(account);
            return account;
        }, async () => {
            if (!journalPath) {
                return;
            }
            JsonAdapter.accountTransactionFaultHook?.('after-account-commit');
            await this.removeAccountCreateJournal(journalPath);
        });
    }

    public async updateAccountPassword(email: string, passwordRecord: PasswordRecord): Promise<UserAccount | null> {
        if (JsonAdapter.mongoGameData) {
            return JsonAdapter.mongoGameData.updateAccountPassword(email, passwordRecord);
        }
        await fs.mkdir(path.dirname(this.accountsPath), { recursive: true });

        const normalizedEmail = normalizeAccountIdentifier(email);
        if (!normalizedEmail) {
            return null;
        }

        return this.mutateAccounts((accounts) => {
            const index = accounts.findIndex(acc => this.accountMatchesEmail(acc, normalizedEmail));
            if (index < 0) {
                return null;
            }

            const existingAccount = accounts[index] as UserAccount & { password?: unknown };
            const { password: _plaintextPassword, ...safeExistingAccount } = existingAccount;
            const emailAliases = this.normalizeEmailAliases(safeExistingAccount.emailAliases);
            const account: UserAccount = {
                ...safeExistingAccount,
                email: normalizeAccountIdentifier(safeExistingAccount.email) || normalizedEmail,
                ...(emailAliases.length > 0 ? { emailAliases } : {}),
                ...passwordRecord
            };
            accounts[index] = account;
            return account;
        });
    }

    public async loadCharacters(userId: number): Promise<Character[]> {
        await JsonAdapter.waitForQueuedSave(path.join(this.savesDir, `${userId}.json`));
        const characters = JsonAdapter.mongoGameData
            ? await JsonAdapter.mongoGameData.loadCharacters(userId)
            : (await this.readSaveFile(userId))?.characters;
        if (!Array.isArray(characters)) {
            return [];
        }
        return characters.map((entry) => this.normalizeCharacterProgress(entry) as Character);
    }

    public async loadAllCharacterRecords(): Promise<UserSaveData[]> {
        if (JsonAdapter.mongoGameData) {
            return JsonAdapter.mongoGameData.loadAllCharacterRecords();
        }
        const records: UserSaveData[] = [];

        try {
            const files = await fs.readdir(this.savesDir);
            for (const file of files) {
                if (!file.endsWith('.json')) {
                    continue;
                }

                try {
                    const data = await fs.readFile(path.join(this.savesDir, file), 'utf8');
                    if (!data.trim()) {
                        continue;
                    }

                    const save = JSON.parse(data) as UserSaveData;
                    if (!Array.isArray(save.characters)) {
                        continue;
                    }

                    records.push(save);
                } catch {
                    continue;
                }
            }
        } catch {
            return [];
        }

        return records;
    }

    public async loadCharacterRecordsByGuild(guildName: string): Promise<UserSaveData[]> {
        const cleanName = String(guildName ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
        if (!cleanName) {
            return [];
        }

        if (JsonAdapter.mongoGameData) {
            return JsonAdapter.mongoGameData.loadCharacterRecordsByGuild(guildName);
        }

        // JSON authority is the local/dev backend with a handful of saves, so the scan stays
        // here; it just no longer returns records the caller would immediately discard.
        const records = await this.loadAllCharacterRecords();
        return records.filter((save) =>
            (Array.isArray(save.characters) ? save.characters : []).some((character) => {
                const guild = character?.guild;
                if (!guild || typeof guild !== 'object') {
                    return false;
                }
                return String((guild as Record<string, unknown>).name ?? '')
                    .trim()
                    .replace(/\s+/g, ' ')
                    .toLowerCase() === cleanName;
            })
        );
    }

    public async saveCharacters(userId: number, characters: Character[]): Promise<void> {
        const savePath = path.join(this.savesDir, `${userId}.json`);
        const previousWrite = JsonAdapter.saveQueues.get(savePath) ?? Promise.resolve();
        const currentWrite = previousWrite
            .catch(() => undefined)
            .then(() => this.performSaveCharacters(userId, characters, savePath));

        JsonAdapter.saveQueues.set(savePath, currentWrite);

        try {
            await currentWrite;
        } finally {
            if (JsonAdapter.saveQueues.get(savePath) === currentWrite) {
                JsonAdapter.saveQueues.delete(savePath);
            }
        }
    }

    public async saveCharacterSnapshot(userId: number, character: Character): Promise<Character[]> {
        const characters = await this.loadCharacters(userId);
        const normalizedName = this.normalizeCharacterName(character?.name);
        const index = characters.findIndex((entry) =>
            this.normalizeCharacterName(entry?.name) === normalizedName
        );

        if (index >= 0) {
            characters[index] = character;
        } else {
            characters.push(character);
        }

        await this.saveCharacters(userId, characters);
        return characters;
    }

    public async isCharacterNameTaken(name: string): Promise<boolean> {
         if (JsonAdapter.mongoGameData) {
            return JsonAdapter.mongoGameData.isCharacterNameTaken(name);
         }
         // This is expensive in JSON, but matches Python implementation
         // In real DB, this would be a query.
         // Here we iterate all files.
         const cleanName = name.trim().toLowerCase();
         
         try {
             const files = await fs.readdir(this.savesDir);
             for (const file of files) {
                 if (!file.endsWith('.json')) continue;
                 try {
                    const data = await fs.readFile(path.join(this.savesDir, file), 'utf8');
                    if (!data.trim()) continue;
                    const save: UserSaveData = JSON.parse(data);
                    if (save.characters.some(c => c.name.trim().toLowerCase() === cleanName)) {
                        return true;
                    }
                 } catch (err) {
                     continue;
                 }
             }
         } catch (err) {
             // Directory might not exist yet
         }
         return false;
    }

    public async getAccountIdByCharName(charName: string): Promise<number | null> {
         if (JsonAdapter.mongoGameData) {
            return JsonAdapter.mongoGameData.getAccountIdByCharName(charName);
         }
         const cleanName = charName.trim().toLowerCase();
         try {
             const files = await fs.readdir(this.savesDir);
             for (const file of files) {
                 if (!file.endsWith('.json')) continue;
                 try {
                    const data = await fs.readFile(path.join(this.savesDir, file), 'utf8');
                    if (!data.trim()) continue;
                    const save: UserSaveData = JSON.parse(data);
                    if (save.characters.some(c => c.name.trim().toLowerCase() === cleanName)) {
                        return save.user_id;
                    }
                 } catch (err) {
                     continue;
                 }
             }
         } catch (err) {
             // Directory might not exist yet
         }
         return null;
    }
}
