const BaseGenerator = require('./base');

/**
 * Go test runner generator
 *
 * PASS-THROUGH MODE: Call expressions are embedded directly in generated Go code.
 * The call syntax must be valid Go (e.g., "Add(1, 2)")
 */
class GoGenerator extends BaseGenerator {
    constructor() {
        super('go');
    }

    escapeGo(str) {
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

        // Generate inline test calls - call expressions are embedded directly
        const testCalls = testCases.map((tc, i) => {
            const parsedExpected = this.parseExpectedValue(tc.expected);
            const expectedJson = this.escapeGo(JSON.stringify(parsedExpected));
            // The call is used directly as Go code
            const callCode = tc.call;
            return `
	{
		func() {
			defer func() {
				if r := recover(); r != nil {
					results = append(results, TestResult{
						Index:  ${i},
						Actual: nil,
						Passed: false,
						Error:  fmt.Sprintf("%v", r),
					})
				}
			}()
			actual := ${callCode}
			var expected interface{}
			json.Unmarshal([]byte(\`${expectedJson}\`), &expected)
			passed := deepEquals(actual, expected)
			results = append(results, TestResult{
				Index:  ${i},
				Actual: actual,
				Passed: passed,
				Error:  "",
			})
		}()
	}`;
        }).join('\n');

        const runnerCode = `
package main

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
)

type TestResult struct {
	Index  int         \`json:"index"\`
	Actual interface{} \`json:"actual"\`
	Passed bool        \`json:"passed"\`
	Error  string      \`json:"error,omitempty"\`
}

func deepEquals(a, b interface{}) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}

	// Handle numeric comparison
	aVal := reflect.ValueOf(a)
	bVal := reflect.ValueOf(b)

	if isNumeric(aVal.Kind()) && isNumeric(bVal.Kind()) {
		af := toFloat64(a)
		bf := toFloat64(b)
		if math.IsNaN(af) && math.IsNaN(bf) {
			return true
		}
		return af == bf
	}

	// Use reflect.DeepEqual for other types
	return reflect.DeepEqual(a, b)
}

func isNumeric(k reflect.Kind) bool {
	switch k {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
		reflect.Float32, reflect.Float64:
		return true
	}
	return false
}

func toFloat64(v interface{}) float64 {
	switch n := v.(type) {
	case int:
		return float64(n)
	case int8:
		return float64(n)
	case int16:
		return float64(n)
	case int32:
		return float64(n)
	case int64:
		return float64(n)
	case uint:
		return float64(n)
	case uint8:
		return float64(n)
	case uint16:
		return float64(n)
	case uint32:
		return float64(n)
	case uint64:
		return float64(n)
	case float32:
		return float64(n)
	case float64:
		return n
	}
	return 0
}

// User functions should be defined here or imported

func main() {
	var results []TestResult

	${testCalls}

	output, _ := json.Marshal(results)
	fmt.Println(string(output))
}
`;

        return {
            files: [
                { name: 'solution.go', content: mainFile.content },
                { name: '__test_runner__.go', content: runnerCode.trim() }
            ],
            entryPoint: '__test_runner__.go',
            stdin: ''
        };
    }
}

module.exports = GoGenerator;
