import { strict as assert } from 'assert';
import { StructuredLogger } from '../core/StructuredLogger';

const original = console.log;
const lines: string[] = [];
console.log = (line?: unknown): void => { lines.push(String(line)); };
try {
    new StructuredLogger('Test', { correlationId: 'scope-1' }).info('sample', {
        email: 'person@example.test',
        token: 1234,
        nested: { passwordVerifier: 'secret', safe: 'visible' }
    });
} finally {
    console.log = original;
}
const entry = JSON.parse(lines[0]) as Record<string, unknown>;
assert.equal(entry.component, 'Test');
assert.equal(entry.event, 'sample');
assert.equal(entry.correlationId, 'scope-1');
assert.equal(entry.email, '[redacted]');
assert.equal(entry.token, '[redacted]');
assert.deepEqual(entry.nested, { passwordVerifier: '[redacted]', safe: 'visible' });
console.log('structured_logger_regression: PASS');
