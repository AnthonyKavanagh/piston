const BaseGenerator = require('./base');

/**
 * C test runner generator
 *
 * PASS-THROUGH MODE: Call expressions are embedded directly in generated C code.
 * The call syntax must be valid C (e.g., "add(1, 2)")
 *
 * Note: C has no exceptions, so errors are limited. Functions must be defined
 * in the user code. Return types must be basic types (int, double, char*, etc.)
 */
class CGenerator extends BaseGenerator {
    constructor() {
        super('c');
    }

    escapeC(str) {
        return str
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    }

    /**
     * Parse expected value from frontend.
     * If it's a string that looks like JSON array/object, parse it.
     */
    parseExpectedValue(expected) {
        if (typeof expected !== 'string') {
            return expected;
        }

        const trimmed = expected.trim();

        // If it looks like a JSON array or object, try to parse it
        if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
            (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
            try {
                return JSON.parse(trimmed);
            } catch (e) {
                // Not valid JSON, keep as string
            }
        }

        // Handle special values
        if (trimmed === 'true') return true;
        if (trimmed === 'false') return false;
        if (trimmed === 'null') return null;

        // Try to parse as number
        if (/^-?\d+$/.test(trimmed)) {
            return parseInt(trimmed, 10);
        }
        if (/^-?\d*\.?\d+$/.test(trimmed)) {
            return parseFloat(trimmed);
        }

        return expected;
    }

    generateRunner(userFiles, testCases) {
        const mainFile = userFiles[0];

        // Generate test calls - call expressions are embedded directly
        // For C, we need to know the return type, so we'll use a macro-based approach
        const testCalls = testCases.map((tc, i) => {
            // Parse expected value first
            const expected = this.parseExpectedValue(tc.expected);
            const expectedJson = this.escapeC(JSON.stringify(expected));
            const callCode = tc.call;

            if (typeof expected === 'number') {
                if (Number.isInteger(expected)) {
                    return `
    {
        int actual = ${callCode};
        int expected = ${expected};
        int passed = (actual == expected);
        printf("{\\"index\\":${i},\\"actual\\":%d,\\"passed\\":%s,\\"error\\":null}", actual, passed ? "true" : "false");
        if (${i} < ${testCases.length - 1}) printf(",");
    }`;
                } else {
                    return `
    {
        double actual = ${callCode};
        double expected = ${expected};
        int passed = (fabs(actual - expected) < 0.0000001);
        printf("{\\"index\\":${i},\\"actual\\":%g,\\"passed\\":%s,\\"error\\":null}", actual, passed ? "true" : "false");
        if (${i} < ${testCases.length - 1}) printf(",");
    }`;
                }
            } else if (typeof expected === 'boolean') {
                return `
    {
        int actual = ${callCode};
        int expected = ${expected ? 1 : 0};
        int passed = (actual == expected);
        printf("{\\"index\\":${i},\\"actual\\":%s,\\"passed\\":%s,\\"error\\":null}", actual ? "true" : "false", passed ? "true" : "false");
        if (${i} < ${testCases.length - 1}) printf(",");
    }`;
            } else if (typeof expected === 'string') {
                const escapedExpected = this.escapeC(expected);
                return `
    {
        char* actual = ${callCode};
        char* expected = "${escapedExpected}";
        int passed = (actual != NULL && strcmp(actual, expected) == 0);
        if (actual != NULL) {
            printf("{\\"index\\":${i},\\"actual\\":\\"");
            print_escaped_string(actual);
            printf("\\",\\"passed\\":%s,\\"error\\":null}", passed ? "true" : "false");
        } else {
            printf("{\\"index\\":${i},\\"actual\\":null,\\"passed\\":false,\\"error\\":null}");
        }
        if (${i} < ${testCases.length - 1}) printf(",");
    }`;
            } else if (expected === null) {
                return `
    {
        void* actual = ${callCode};
        int passed = (actual == NULL);
        printf("{\\"index\\":${i},\\"actual\\":null,\\"passed\\":%s,\\"error\\":null}", passed ? "true" : "false");
        if (${i} < ${testCases.length - 1}) printf(",");
    }`;
            } else if (Array.isArray(expected)) {
                // For arrays, we'll compare as int arrays (most common case)
                const len = expected.length;
                const expectedArr = expected.join(', ');
                return `
    {
        int expected_arr[] = {${expectedArr}};
        int expected_len = ${len};
        int actual_len = 0;
        int* actual = ${callCode};
        // Note: User must return array with known size or NULL-terminate
        // This is a simplified comparison - assumes fixed size arrays
        int passed = 1;
        printf("{\\"index\\":${i},\\"actual\\":[");
        for (int __i = 0; __i < expected_len; __i++) {
            if (actual[__i] != expected_arr[__i]) passed = 0;
            printf("%d", actual[__i]);
            if (__i < expected_len - 1) printf(",");
        }
        printf("],\\"passed\\":%s,\\"error\\":null}", passed ? "true" : "false");
        if (${i} < ${testCases.length - 1}) printf(",");
    }`;
            } else {
                // Default: treat as int
                return `
    {
        int actual = ${callCode};
        int passed = 0; // Unknown expected type
        printf("{\\"index\\":${i},\\"actual\\":%d,\\"passed\\":false,\\"error\\":\\"unsupported expected type\\"}", actual);
        if (${i} < ${testCases.length - 1}) printf(",");
    }`;
            }
        }).join('\n');

        const runnerCode = `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

// Helper function to print escaped strings
void print_escaped_string(const char* s) {
    while (*s) {
        switch (*s) {
            case '"': printf("\\\\\\""); break;
            case '\\\\': printf("\\\\\\\\"); break;
            case '\\n': printf("\\\\n"); break;
            case '\\r': printf("\\\\r"); break;
            case '\\t': printf("\\\\t"); break;
            default: putchar(*s);
        }
        s++;
    }
}

// User code
${mainFile.content}

int main() {
    printf("[");

    ${testCalls}

    printf("]\\n");
    return 0;
}
`;

        return {
            files: [
                { name: '__test_runner__.c', content: runnerCode.trim() }
            ],
            entryPoint: '__test_runner__.c',
            stdin: ''
        };
    }
}

module.exports = CGenerator;
