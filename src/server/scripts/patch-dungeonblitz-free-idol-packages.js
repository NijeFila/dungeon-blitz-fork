#!/usr/bin/env node

require('ts-node/register');

const path = require('path');
const {
    applyPatchesToBody,
    classIndexByName,
    ensureBackup,
    methodIdxForTrait,
    parseAbc,
    parseSwf,
    PatchError,
    writeSwf,
    writeU30
} = require('./swfPatchUtils');

const DEFAULT_SWF = path.resolve(
    __dirname,
    '..',
    '..',
    'client',
    'content',
    'localhost',
    'p',
    'cbp',
    'DungeonBlitz.swf'
);
const PURCHASE_PACKET_ID = 0x115;
const TARGET_CLASS = 'class_63';
const TARGET_METHOD = 'method_1131';

function parseArgs(argv) {
    let swfPath = DEFAULT_SWF;
    let verify = false;
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--swf' || arg === '-s') {
            swfPath = path.resolve(argv[++index] || '');
        } else if (arg === '--verify') {
            verify = true;
        } else if (arg === '--help' || arg === '-h') {
            console.log('Usage: node patch-dungeonblitz-free-idol-packages.js [--verify] [--swf <path>]');
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return { swfPath, verify };
}

function instruction(opcode, ...operands) {
    return Buffer.concat([Buffer.from([opcode]), ...operands.map(writeU30)]);
}

function buildPatchedCode(abc) {
    const uniqueNameIndex = (name, preferred) => {
        if (abc.multinameNames[preferred] === name) return preferred;
        const matches = [];
        abc.multinameNames.forEach((candidate, index) => {
            if (candidate === name) matches.push(index);
        });
        if (matches.length === 1) return matches[0];
        throw new PatchError(`Could not resolve the expected ${name} multiname.`);
    };

    const packet = uniqueNameIndex('Packet', 23);
    const globalGame = uniqueNameIndex('var_1', 1);
    const serverConn = uniqueNameIndex('serverConn', 82);
    const writeUint = uniqueNameIndex('method_9', 110);
    const sendPacket = uniqueNameIndex('SendPacket', 106);

    return Buffer.concat([
        Buffer.from([0xd0, 0x30]),
        instruction(0x5d, packet),
        instruction(0x25, PURCHASE_PACKET_ID),
        instruction(0x4a, packet, 1),
        instruction(0x80, packet),
        Buffer.from([0xd6, 0xd2, 0xd1]),
        instruction(0x4f, writeUint, 1),
        instruction(0x60, globalGame),
        instruction(0x66, serverConn),
        Buffer.from([0xd2]),
        instruction(0x4f, sendPacket, 1),
        Buffer.from([0x47])
    ]);
}

function targetBody(ctx, abc) {
    const classIndex = classIndexByName(abc, TARGET_CLASS);
    if (classIndex === null) throw new PatchError(`Could not find ${TARGET_CLASS}.`);
    const methodIndex = methodIdxForTrait(abc.instances[classIndex].traits, abc, TARGET_METHOD);
    if (methodIndex === null) throw new PatchError(`Could not find ${TARGET_CLASS}.${TARGET_METHOD}.`);
    const body = abc.methodBodies.get(methodIndex);
    if (!body) throw new PatchError(`Could not find the body for ${TARGET_CLASS}.${TARGET_METHOD}.`);
    return body;
}

function patchSwf(swfPath, verify) {
    const ctx = parseSwf(swfPath);
    const abc = parseAbc(ctx);
    const body = targetBody(ctx, abc);
    const expected = buildPatchedCode(abc);
    const current = ctx.body.subarray(body.codeStart, body.codeStart + body.codeLen);

    if (current.equals(expected)) {
        console.log(`${swfPath}: Mammoth Idol packages already grant through packet 0x115.`);
        return;
    }
    if (verify) {
        throw new PatchError(`${swfPath}: Mammoth Idol package selection still uses the external payment flow.`);
    }
    if (body.exceptionCount !== 0) {
        throw new PatchError(`${TARGET_CLASS}.${TARGET_METHOD} unexpectedly contains exception handlers.`);
    }

    const replacement = Buffer.concat([writeU30(expected.length), expected]);
    const { body: patchedBody, delta } = applyPatchesToBody(ctx.body, [{
        key: `${TARGET_CLASS}.${TARGET_METHOD}`,
        start: body.codeLenPos,
        end: body.codeStart + body.codeLen,
        data: replacement,
        detail: 'replace PayPal navigation with authenticated package-selection packet'
    }]);
    ensureBackup(swfPath);
    writeSwf(ctx, patchedBody, delta);

    const verifyCtx = parseSwf(swfPath);
    const verifyAbc = parseAbc(verifyCtx);
    const verifyBody = targetBody(verifyCtx, verifyAbc);
    const installed = verifyCtx.body.subarray(verifyBody.codeStart, verifyBody.codeStart + verifyBody.codeLen);
    if (!installed.equals(buildPatchedCode(verifyAbc))) {
        throw new PatchError('Patched Mammoth Idol package method did not verify after writing.');
    }
    console.log(`${swfPath}: Mammoth Idol packages now grant through packet 0x115.`);
}

const { swfPath, verify } = parseArgs(process.argv);
patchSwf(swfPath, verify);
