const BaseGenerator = require('./base');

/**
 * JavaScript/Node.js test runner generator
 *
 * PASS-THROUGH MODE: Call expressions are passed directly to JavaScript's eval()
 * This supports all JavaScript syntax including arrow functions, template literals, etc.
 *
 * STRICT TYPE COMPARISON:
 * - Arrays must be arrays (not array-like objects)
 * - undefined ≠ null
 * - Type-preserving serialization
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
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const util = require('util');

// ============================================================================
// UTILITY CLASSES FOR CHALLENGES
// ============================================================================

/**
 * Counter - like Python's collections.Counter
 */
class Counter extends Map {
    constructor(iterable) {
        super();
        if (iterable) {
            for (const item of iterable) {
                this.increment(item);
            }
        }
    }

    increment(key, count = 1) {
        this.set(key, (this.get(key) || 0) + count);
        return this;
    }

    decrement(key, count = 1) {
        const newVal = (this.get(key) || 0) - count;
        if (newVal <= 0) {
            this.delete(key);
        } else {
            this.set(key, newVal);
        }
        return this;
    }

    mostCommon(n) {
        const sorted = [...this.entries()].sort((a, b) => b[1] - a[1]);
        return n ? sorted.slice(0, n) : sorted;
    }

    total() {
        let sum = 0;
        for (const count of this.values()) sum += count;
        return sum;
    }

    toObject() {
        return Object.fromEntries(this);
    }
}

/**
 * Deque - double-ended queue
 */
class Deque {
    constructor(iterable = []) {
        this._data = [...iterable];
    }

    pushFront(item) { this._data.unshift(item); return this; }
    pushBack(item) { this._data.push(item); return this; }
    popFront() { return this._data.shift(); }
    popBack() { return this._data.pop(); }
    peekFront() { return this._data[0]; }
    peekBack() { return this._data[this._data.length - 1]; }
    get length() { return this._data.length; }
    isEmpty() { return this._data.length === 0; }
    toArray() { return [...this._data]; }
    [Symbol.iterator]() { return this._data[Symbol.iterator](); }
}

/**
 * PriorityQueue - min-heap by default
 */
class PriorityQueue {
    constructor(compareFn = (a, b) => a - b) {
        this._heap = [];
        this._compare = compareFn;
    }

    push(item) {
        this._heap.push(item);
        this._bubbleUp(this._heap.length - 1);
        return this;
    }

    pop() {
        if (this._heap.length === 0) return undefined;
        const top = this._heap[0];
        const last = this._heap.pop();
        if (this._heap.length > 0) {
            this._heap[0] = last;
            this._bubbleDown(0);
        }
        return top;
    }

    peek() { return this._heap[0]; }
    get length() { return this._heap.length; }
    isEmpty() { return this._heap.length === 0; }

    _bubbleUp(i) {
        while (i > 0) {
            const parent = Math.floor((i - 1) / 2);
            if (this._compare(this._heap[i], this._heap[parent]) >= 0) break;
            [this._heap[i], this._heap[parent]] = [this._heap[parent], this._heap[i]];
            i = parent;
        }
    }

    _bubbleDown(i) {
        const n = this._heap.length;
        while (true) {
            const left = 2 * i + 1;
            const right = 2 * i + 2;
            let smallest = i;
            if (left < n && this._compare(this._heap[left], this._heap[smallest]) < 0) smallest = left;
            if (right < n && this._compare(this._heap[right], this._heap[smallest]) < 0) smallest = right;
            if (smallest === i) break;
            [this._heap[i], this._heap[smallest]] = [this._heap[smallest], this._heap[i]];
            i = smallest;
        }
    }

    toArray() { return [...this._heap]; }
}

/**
 * DefaultMap - like Python's defaultdict
 */
class DefaultMap extends Map {
    constructor(defaultFactory = () => undefined) {
        super();
        this._default = defaultFactory;
    }

    get(key) {
        if (!this.has(key)) {
            this.set(key, this._default());
        }
        return super.get(key);
    }
}

// ============================================================================
// UTILITY OBJECTS
// ============================================================================

const ArrayUtils = {
    range: (start, end, step = 1) => {
        if (end === undefined) { end = start; start = 0; }
        const result = [];
        for (let i = start; step > 0 ? i < end : i > end; i += step) result.push(i);
        return result;
    },
    zip: (...arrays) => {
        const minLen = Math.min(...arrays.map(a => a.length));
        return ArrayUtils.range(minLen).map(i => arrays.map(a => a[i]));
    },
    unzip: (pairs) => pairs.reduce((acc, [a, b]) => { acc[0].push(a); acc[1].push(b); return acc; }, [[], []]),
    chunk: (arr, size) => {
        const result = [];
        for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
        return result;
    },
    flatten: (arr, depth = 1) => arr.flat(depth),
    unique: (arr) => [...new Set(arr)],
    groupBy: (arr, fn) => arr.reduce((acc, item) => {
        const key = typeof fn === 'function' ? fn(item) : item[fn];
        (acc[key] = acc[key] || []).push(item);
        return acc;
    }, {}),
    sum: (arr) => arr.reduce((a, b) => a + b, 0),
    product: (arr) => arr.reduce((a, b) => a * b, 1),
    max: (arr) => Math.max(...arr),
    min: (arr) => Math.min(...arr),
    argmax: (arr) => arr.indexOf(Math.max(...arr)),
    argmin: (arr) => arr.indexOf(Math.min(...arr)),
    shuffle: (arr) => {
        const result = [...arr];
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    },
    sample: (arr, n = 1) => ArrayUtils.shuffle(arr).slice(0, n),
    rotate: (arr, k) => {
        const n = arr.length;
        k = ((k % n) + n) % n;
        return [...arr.slice(-k), ...arr.slice(0, -k)];
    },
    bisectLeft: (arr, x) => {
        let lo = 0, hi = arr.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] < x) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    },
    bisectRight: (arr, x) => {
        let lo = 0, hi = arr.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] <= x) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }
};

const Combinatorics = {
    factorial: (n) => n <= 1 ? 1 : n * Combinatorics.factorial(n - 1),
    permutations: function* (arr, r = arr.length) {
        if (r > arr.length) return;
        if (r === 0) { yield []; return; }
        for (let i = 0; i < arr.length; i++) {
            const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
            for (const perm of Combinatorics.permutations(rest, r - 1)) {
                yield [arr[i], ...perm];
            }
        }
    },
    combinations: function* (arr, r) {
        if (r === 0) { yield []; return; }
        if (r > arr.length) return;
        for (let i = 0; i <= arr.length - r; i++) {
            for (const comb of Combinatorics.combinations(arr.slice(i + 1), r - 1)) {
                yield [arr[i], ...comb];
            }
        }
    },
    product: function* (...arrays) {
        if (arrays.length === 0) { yield []; return; }
        const [first, ...rest] = arrays;
        for (const item of first) {
            for (const combo of Combinatorics.product(...rest)) {
                yield [item, ...combo];
            }
        }
    },
    nCr: (n, r) => {
        if (r > n || r < 0) return 0;
        if (r === 0 || r === n) return 1;
        let result = 1;
        for (let i = 0; i < r; i++) result = result * (n - i) / (i + 1);
        return Math.round(result);
    },
    nPr: (n, r) => {
        if (r > n || r < 0) return 0;
        let result = 1;
        for (let i = 0; i < r; i++) result *= (n - i);
        return result;
    }
};

const MathUtils = {
    gcd: (a, b) => b === 0 ? Math.abs(a) : MathUtils.gcd(b, a % b),
    lcm: (a, b) => Math.abs(a * b) / MathUtils.gcd(a, b),
    isPrime: (n) => {
        if (n < 2) return false;
        if (n === 2) return true;
        if (n % 2 === 0) return false;
        for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
        return true;
    },
    primes: function* (limit) {
        const sieve = new Array(limit + 1).fill(true);
        sieve[0] = sieve[1] = false;
        for (let i = 2; i <= limit; i++) {
            if (sieve[i]) {
                yield i;
                for (let j = i * i; j <= limit; j += i) sieve[j] = false;
            }
        }
    },
    factors: (n) => {
        const result = [];
        for (let i = 1; i * i <= n; i++) {
            if (n % i === 0) {
                result.push(i);
                if (i !== n / i) result.push(n / i);
            }
        }
        return result.sort((a, b) => a - b);
    },
    primeFactors: (n) => {
        const result = [];
        for (let d = 2; d * d <= n; d++) {
            while (n % d === 0) { result.push(d); n /= d; }
        }
        if (n > 1) result.push(n);
        return result;
    },
    mod: (n, m) => ((n % m) + m) % m,
    modPow: (base, exp, mod) => {
        let result = 1n;
        base = BigInt(base) % BigInt(mod);
        exp = BigInt(exp);
        mod = BigInt(mod);
        while (exp > 0n) {
            if (exp % 2n === 1n) result = (result * base) % mod;
            exp = exp / 2n;
            base = (base * base) % mod;
        }
        return Number(result);
    },
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    lerp: (a, b, t) => a + (b - a) * t
};

const StringUtils = {
    reverse: (s) => [...s].reverse().join(''),
    isPalindrome: (s) => s === StringUtils.reverse(s),
    count: (s, sub) => s.split(sub).length - 1,
    capitalize: (s) => s.charAt(0).toUpperCase() + s.slice(1),
    words: (s) => s.trim().split(/\\s+/),
    lpad: (s, len, char = ' ') => s.padStart(len, char),
    rpad: (s, len, char = ' ') => s.padEnd(len, char)
};

// ============================================================================
// CAPTURE CONSOLE OUTPUT
// ============================================================================

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

// ============================================================================
// USER CODE
// ============================================================================

${mainFile.content}

// ============================================================================
// STRICT COMPARISON AND SERIALIZATION
// ============================================================================

/**
 * STRICT deep equality - NO type coercion
 * - Arrays must be arrays (not array-like objects)
 * - undefined ≠ null
 * - NaN === NaN (special case)
 * - Set === Set (element comparison, order-independent)
 * - Map === Map (key-value comparison, order-independent)
 */
function deepEquals(a, b) {
    // Handle identical values (including undefined === undefined)
    if (a === b) return true;

    // Handle NaN
    if (typeof a === 'number' && typeof b === 'number') {
        if (Number.isNaN(a) && Number.isNaN(b)) return true;
    }

    // STRICT: null and undefined are different
    if (a === null || b === null) return false;
    if (a === undefined || b === undefined) return false;

    // STRICT: type check (must be exactly the same type)
    if (typeof a !== typeof b) return false;

    // Arrays - STRICT: must both be arrays (not array-like objects)
    const aIsArray = Array.isArray(a);
    const bIsArray = Array.isArray(b);
    if (aIsArray !== bIsArray) return false;
    if (aIsArray) {
        if (a.length !== b.length) return false;
        return a.every((v, i) => deepEquals(v, b[i]));
    }

    // FIX: Set comparison - both must be Sets, compare elements (order-independent)
    const aIsSet = a instanceof Set;
    const bIsSet = b instanceof Set;
    if (aIsSet !== bIsSet) return false;
    if (aIsSet) {
        if (a.size !== b.size) return false;
        for (const item of a) {
            // For primitive items, direct check
            if (typeof item !== 'object' || item === null) {
                if (!b.has(item)) return false;
            } else {
                // For object items, need deep comparison
                let found = false;
                for (const bItem of b) {
                    if (deepEquals(item, bItem)) {
                        found = true;
                        break;
                    }
                }
                if (!found) return false;
            }
        }
        return true;
    }

    // FIX: Map comparison - both must be Maps, compare key-value pairs
    const aIsMap = a instanceof Map;
    const bIsMap = b instanceof Map;
    if (aIsMap !== bIsMap) return false;
    if (aIsMap) {
        if (a.size !== b.size) return false;
        for (const [key, val] of a) {
            if (!b.has(key)) return false;
            if (!deepEquals(val, b.get(key))) return false;
        }
        return true;
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

/**
 * TYPE-PRESERVING serialization
 * - undefined is serialized with type marker
 * - NaN and Infinity are serialized with type markers
 */
function serialize(value) {
    if (value === undefined) {
        return { __type__: 'undefined' };
    }
    if (value === null) {
        return null;
    }
    if (typeof value === 'number') {
        if (Number.isNaN(value)) return { __type__: 'number', value: 'NaN' };
        if (!Number.isFinite(value)) return { __type__: 'number', value: value > 0 ? 'Infinity' : '-Infinity' };
        return value;
    }
    if (typeof value === 'boolean' || typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(serialize);
    }
    if (value instanceof Map) {
        return { __type__: 'Map', value: [...value.entries()].map(([k, v]) => [serialize(k), serialize(v)]) };
    }
    if (value instanceof Set) {
        return { __type__: 'Set', value: [...value].map(serialize) };
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

/**
 * Parse raw expected value from frontend
 * Handles: JSON, special JS values (NaN, Infinity, undefined), numbers, strings,
 * and constructor calls: new Set([...]), new Map([...])
 * ALL PARSING LOGIC IS HERE - frontend passes raw values
 */
function parseExpectedValue(val) {
    // If not a string, it's already been parsed (from JSON)
    if (typeof val !== 'string') {
        return convertExpected(val);
    }

    const trimmed = val.trim();

    // FIX: Handle double-quoted strings FIRST (before JSON.parse changes them)
    // Expected value "42" should be string "42", not number 42
    if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
        // Check if it's a simple quoted string (not JSON object/array)
        // Remove outer quotes and unescape
        try {
            return JSON.parse(trimmed);
        } catch (e) {
            // If JSON parse fails, manually remove quotes
            return trimmed.slice(1, -1);
        }
    }

    // Try JSON parse first (handles arrays, objects, quoted strings, booleans, null, numbers)
    try {
        const parsed = JSON.parse(trimmed);
        return convertExpected(parsed);
    } catch (e) {
        // Not valid JSON, continue with special value handling
    }

    // Handle JavaScript special values
    if (trimmed === 'undefined') return undefined;
    if (trimmed === 'NaN') return NaN;
    if (trimmed === 'Infinity') return Infinity;
    if (trimmed === '-Infinity') return -Infinity;

    // Handle Python literals (for cross-language compatibility)
    if (trimmed === 'True') return true;
    if (trimmed === 'False') return false;
    if (trimmed === 'None') return null;

    // FIX: Handle new Set([...]) constructor syntax
    const setMatch = trimmed.match(/^new\\s+Set\\s*\\(\\s*\\[([\\s\\S]*)\\]\\s*\\)$/);
    if (setMatch) {
        const inner = setMatch[1].trim();
        if (!inner) return new Set();
        try {
            const elements = JSON.parse('[' + inner + ']');
            return new Set(elements.map(convertExpected));
        } catch (e) {
            // JSON.parse failed - fall through to return as string
        }
    }

    // FIX: Handle new Map([...]) constructor syntax
    const mapMatch = trimmed.match(/^new\\s+Map\\s*\\(\\s*\\[([\\s\\S]*)\\]\\s*\\)$/);
    if (mapMatch) {
        const inner = mapMatch[1].trim();
        if (!inner) return new Map();
        try {
            const entries = JSON.parse('[' + inner + ']');
            return new Map(entries.map(([k, v]) => [convertExpected(k), convertExpected(v)]));
        } catch (e) {
            // JSON.parse failed - fall through to return as string
        }
    }

    // Handle integers
    if (/^-?\\d+$/.test(trimmed)) {
        return parseInt(trimmed, 10);
    }

    // Handle floats
    if (/^-?\\d*\\.\\d+$/.test(trimmed) || /^-?\\d+\\.\\d*$/.test(trimmed)) {
        return parseFloat(trimmed);
    }

    // Return as string (preserve original value including whitespace)
    return val;
}

/**
 * Convert expected value from JSON, handling type markers
 */
function convertExpected(val) {
    if (val === null) return null;
    if (val === undefined) return undefined;

    if (typeof val === 'object' && !Array.isArray(val)) {
        // Check for type markers
        if ('__type__' in val) {
            const t = val.__type__;
            if (t === 'undefined') return undefined;
            if (t === 'number') {
                if (val.value === 'NaN') return NaN;
                if (val.value === 'Infinity') return Infinity;
                if (val.value === '-Infinity') return -Infinity;
                return val.value;
            }
            if (t === 'tuple') return val.value.map(convertExpected);  // JS has no tuples, use arrays
            if (t === 'set' || t === 'Set') return new Set(val.value.map(convertExpected));
            if (t === 'Map') return new Map(val.value.map(([k, v]) => [convertExpected(k), convertExpected(v)]));
            if (t === 'int' || t === 'float') return val.value;
            if (t === 'dict') {
                const result = {};
                for (const [k, v] of Object.entries(val.value)) {
                    result[k] = convertExpected(v);
                }
                return result;
            }
        }
        // Regular object
        const result = {};
        for (const [k, v] of Object.entries(val)) {
            result[k] = convertExpected(v);
        }
        return result;
    }

    if (Array.isArray(val)) {
        return val.map(convertExpected);
    }

    return val;
}

// ============================================================================
// TEST EXECUTION
// ============================================================================

const input = fs.readFileSync(0, 'utf-8');
const testCases = JSON.parse(input);
const results = [];

for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    try {
        // Execute the function call directly using JavaScript eval
        const actual = eval(tc.call);

        // Parse expected value from raw input (handles JSON, special values, numbers, strings)
        // ALL PARSING IS DONE HERE IN BACKEND - frontend passes raw values
        const expected = parseExpectedValue(tc.expected);

        // STRICT comparison
        const passed = deepEquals(actual, expected);

        results.push({
            index: i,
            actual: serialize(actual),
            expected_serialized: serialize(expected),
            passed,
            error: null
        });
    } catch (e) {
        results.push({
            index: i,
            actual: null,
            expected_serialized: null,
            passed: false,
            error: e.name + ': ' + e.message
        });
    }
}

// Output results as JSON
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
