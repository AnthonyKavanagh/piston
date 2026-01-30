const BaseGenerator = require('./base');

/**
 * Python test runner generator
 *
 * PASS-THROUGH MODE: Call expressions are passed directly to Python's eval()
 * This supports all Python syntax including lambdas, list comprehensions, f-strings, etc.
 */
class PythonGenerator extends BaseGenerator {
    constructor() {
        super('python');
    }

    generateRunner(userFiles, testCases) {
        const mainFile = userFiles[0];
        const moduleName = mainFile.name.replace(/\.py$/, '');

        // Pass test cases with raw call strings - Python will eval them directly
        const testData = testCases.map(tc => ({
            call: tc.call,
            expected: tc.expected
        }));

        const runnerCode = `
import json
import sys
import math

sys.path.insert(0, '.')

from ${moduleName} import *

def deep_equals(a, b):
    """Deep equality comparison that handles various Python types"""
    # Handle None
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False

    # Handle NaN
    if isinstance(a, float) and isinstance(b, float):
        if math.isnan(a) and math.isnan(b):
            return True

    # Type check with numeric flexibility
    if type(a) != type(b):
        # Allow int/float comparison
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            return a == b
        # Allow list/tuple comparison
        if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
            if len(a) != len(b):
                return False
            return all(deep_equals(x, y) for x, y in zip(a, b))
        return False

    # Lists and tuples
    if isinstance(a, (list, tuple)):
        if len(a) != len(b):
            return False
        return all(deep_equals(x, y) for x, y in zip(a, b))

    # Dictionaries
    if isinstance(a, dict):
        if set(a.keys()) != set(b.keys()):
            return False
        return all(deep_equals(a[k], b[k]) for k in a)

    # Sets
    if isinstance(a, set):
        return a == b

    # Default comparison
    return a == b

def serialize(value):
    """Serialize a Python value to JSON-compatible format"""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
        return value
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return [serialize(v) for v in value]
    if isinstance(value, dict):
        return {str(k): serialize(v) for k, v in value.items()}
    if isinstance(value, set):
        return sorted([serialize(v) for v in value], key=lambda x: (type(x).__name__, str(x)))
    # For other types, try to convert to string
    return str(value)

def convert_expected(val):
    """Convert JSON expected value to Python equivalent for comparison"""
    if val is None:
        return None
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val
    if isinstance(val, str):
        return val
    if isinstance(val, list):
        return [convert_expected(v) for v in val]
    if isinstance(val, dict):
        return {k: convert_expected(v) for k, v in val.items()}
    return val

# Read test cases from stdin
test_cases = json.loads(sys.stdin.read())
results = []

for i, tc in enumerate(test_cases):
    try:
        # Execute the function call directly using Python eval
        # This supports all Python syntax: lambdas, list comprehensions, f-strings, etc.
        actual = eval(tc['call'])

        # Convert expected value from JSON to Python
        expected = convert_expected(tc['expected'])

        # Compare with expected
        passed = deep_equals(actual, expected)

        results.append({
            'index': i,
            'actual': serialize(actual),
            'passed': passed,
            'error': None
        })
    except Exception as e:
        results.append({
            'index': i,
            'actual': None,
            'passed': False,
            'error': f"{type(e).__name__}: {str(e)}"
        })

print(json.dumps(results))
`;

        return {
            files: [
                { name: '__test_runner__.py', content: runnerCode.trim() },
                ...userFiles
            ],
            entryPoint: '__test_runner__.py',
            stdin: JSON.stringify(testData)
        };
    }
}

module.exports = PythonGenerator;
