const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const budgets = { any: 711, console: 991, dynamicRequire: 37 };
const handlerLineBudgets = {
    'handlers/CombatHandler.ts': 7121,
    'handlers/LevelHandler.ts': 6687,
    'handlers/EntityHandler.ts': 4472,
    'handlers/MissionHandler.ts': 4216
};

function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return ['dist', 'test', 'node_modules'].includes(entry.name) ? [] : walk(target);
        return entry.isFile() && entry.name.endsWith('.ts') ? [target] : [];
    });
}

const sources = walk(root);
const joined = sources.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const counts = {
    any: (joined.match(/\bany\b/g) ?? []).length,
    console: (joined.match(/console\.(?:log|warn|error|debug)/g) ?? []).length,
    dynamicRequire: (joined.match(/\brequire\s*\(/g) ?? []).length
};
for (const [name, count] of Object.entries(counts)) {
    if (count > budgets[name]) throw new Error(`${name} debt grew: ${count} > ${budgets[name]}`);
}
for (const [relative, budget] of Object.entries(handlerLineBudgets)) {
    const lines = fs.readFileSync(path.join(root, relative), 'utf8').split(/\r?\n/).length;
    if (lines > budget) throw new Error(`${relative} grew beyond its extraction budget: ${lines} > ${budget}`);
}
for (const relative of ['core/BossAuthority.ts', 'core/StructuredLogger.ts']) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    if (/(?:\bas\s+any\b|:\s*any\b|<any>)|\brequire\s*\(/.test(source)) throw new Error(`${relative} introduced an untyped/dynamic boundary`);
}
console.log(`[lint] debt budgets satisfied: any=${counts.any}, console=${counts.console}, dynamicRequire=${counts.dynamicRequire}`);
