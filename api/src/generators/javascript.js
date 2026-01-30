const BaseGenerator = require('./base');

/**
 * JavaScript/Node.js test runner generator
 *
 * PASS-THROUGH MODE: Call expressions are passed directly to JavaScript's eval()
 * This supports all JavaScript syntax including arrow functions, template literals, etc.
 */
class JavaScriptGenerator extends BaseGenerator {
    constructor() {
        super('javascript');
    }

    generateRunner(userFiles, testCases) {
        const mainFile = userFiles[0];

        // Pass test cases with raw call strings - JavaScript will eval them directly
        const testData = testCases.map(tc => ({
            call: tc.call,
            expected: tc.expected
        }));

        const runnerCode = `
const fs = require('fs');

// Capture console output from user code to prevent it from breaking JSON output
const __capturedLogs__ = [];
const __originalConsole__ = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console)
};
console.log = (...args) => __capturedLogs__.push({ type: 'log', args });
console.warn = (...args) => __capturedLogs__.push({ type: 'warn', args });
console.error = (...args) => __capturedLogs__.push({ type: 'error', args });
console.info = (...args) => __capturedLogs__.push({ type: 'info', args });

// Load user code
${mainFile.content}

function deepEquals(a, b) {
    // Handle identical values
    if (a === b) return true;

    // Handle null/undefined
    if (a === null || b === null) return a === b;
    if (a === undefined || b === undefined) return a === b;

    // Handle NaN
    if (typeof a === 'number' && typeof b === 'number') {
        if (Number.isNaN(a) && Number.isNaN(b)) return true;
    }

    // Type check
    if (typeof a !== typeof b) return false;

    // Arrays
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((v, i) => deepEquals(v, b[i]));
    }

    // Objects
    if (typeof a === 'object') {
        const keysA = Object.keys(a).sort();
        const keysB = Object.keys(b).sort();
        if (keysA.length !== keysB.length) return false;
        if (!keysA.every((k, i) => k === keysB[i])) return false;
        return keysA.every(k => deepEquals(a[k], b[k]));
    }

    return false;
}

function serialize(value) {
    if (value === undefined) return null;
    if (value === null) return null;
    if (typeof value === 'number') {
        if (Number.isNaN(value)) return 'NaN';
        if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
    }
    if (Array.isArray(value)) {
        return value.map(serialize);
    }
    if (typeof value === 'object') {
        const result = {};
        for (const [k, v] of Object.entries(value)) {
            result[k] = serialize(v);
        }
        return result;
    }
    return value;
}

// Read test cases from stdin
const input = fs.readFileSync(0, 'utf-8');
const testCases = JSON.parse(input);
const results = [];

for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    try {
        // Execute the function call directly using JavaScript eval
        // This supports all JavaScript syntax
        const actual = eval(tc.call);

        // Compare with expected
        const passed = deepEquals(actual, tc.expected);

        results.push({
            index: i,
            actual: serialize(actual),
            passed,
            error: null
        });
    } catch (e) {
        results.push({
            index: i,
            actual: null,
            passed: false,
            error: e.name + ': ' + e.message
        });
    }
}

// Restore original console and output results
// Use process.stdout.write to ensure clean JSON output
process.stdout.write(JSON.stringify(results));
`;

        return {
            files: [
                { name: '__test_runner__.js', content: runnerCode.trim() }
            ],
            entryPoint: '__test_runner__.js',
            stdin: JSON.stringify(testData)
        };
    }
}

module.exports = JavaScriptGenerator;
