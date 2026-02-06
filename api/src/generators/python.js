const BaseGenerator = require('./base');

/**
 * Python test runner generator
 *
 * PASS-THROUGH MODE: Call expressions are passed directly to Python's eval()
 * This supports all Python syntax including lambdas, list comprehensions, f-strings, etc.
 *
 * STRICT TYPE COMPARISON:
 * - tuple ≠ list (even with same elements)
 * - int ≠ float (1 ≠ 1.0)
 * - Type-preserving serialization (tuples stay tuples in output)
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
import io

# Comprehensive stdlib imports for challenges
from collections import Counter, defaultdict, deque, OrderedDict, namedtuple, ChainMap
from itertools import permutations, combinations, combinations_with_replacement, product, chain, groupby, accumulate, starmap, takewhile, dropwhile, filterfalse, islice, cycle, repeat, zip_longest
from functools import reduce, partial, lru_cache, cmp_to_key
from operator import add, sub, mul, truediv, floordiv, mod, pow, neg, abs, itemgetter, attrgetter
from heapq import heappush, heappop, heapify, nlargest, nsmallest, heappushpop, heapreplace
from bisect import bisect_left, bisect_right, insort_left, insort_right
from copy import copy, deepcopy
from string import ascii_lowercase, ascii_uppercase, ascii_letters, digits, punctuation
from re import match, search, findall, sub as re_sub, split as re_split, compile as re_compile
from random import randint, random, choice, shuffle, sample, seed
from statistics import mean, median, mode, stdev, variance
from decimal import Decimal, ROUND_HALF_UP, ROUND_DOWN, ROUND_UP
from fractions import Fraction
from datetime import datetime, date, time, timedelta
from typing import List, Dict, Set, Tuple, Optional, Union, Any, Callable

sys.path.insert(0, '.')

# Capture stdout from user code to prevent it from breaking JSON output
__captured_output__ = io.StringIO()
__original_stdout__ = sys.stdout
sys.stdout = __captured_output__

from ${moduleName} import *

def deep_equals(a, b):
    """
    STRICT deep equality comparison - NO type coercion
    - tuple ≠ list (even with same elements)
    - int ≠ float (1 ≠ 1.0)
    - set ≠ frozenset
    """
    # Handle None
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False

    # Handle NaN (only float NaN equals float NaN)
    if isinstance(a, float) and isinstance(b, float):
        if math.isnan(a) and math.isnan(b):
            return True

    # STRICT type check - no coercion
    if type(a) != type(b):
        return False

    # Lists - must be lists (not tuples)
    if isinstance(a, list):
        if len(a) != len(b):
            return False
        return all(deep_equals(x, y) for x, y in zip(a, b))

    # Tuples - must be tuples (not lists)
    if isinstance(a, tuple):
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

    # Frozensets
    if isinstance(a, frozenset):
        return a == b

    # Default comparison (int, float, str, bool, etc.)
    # int and float are NOT equal even if values match
    return a == b

def serialize(value):
    """
    TYPE-PRESERVING serialization to JSON-compatible format
    - Tuples are serialized with type marker: {"__type__": "tuple", "value": [...]}
    - Sets are serialized with type marker: {"__type__": "set", "value": [...]}
    - Frozensets are serialized with type marker: {"__type__": "frozenset", "value": [...]}
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    # Check Counter/OrderedDict/defaultdict BEFORE dict (they are dict subclasses)
    if isinstance(value, Counter):
        return {"__type__": "Counter", "value": {str(k): serialize(v) for k, v in value.items()}}
    if isinstance(value, OrderedDict):
        return {"__type__": "OrderedDict", "value": {str(k): serialize(v) for k, v in value.items()}}
    if isinstance(value, defaultdict):
        return {"__type__": "defaultdict", "value": {str(k): serialize(v) for k, v in value.items()}}
    if isinstance(value, int):
        # Distinguish int from float
        return {"__type__": "int", "value": value}
    if isinstance(value, float):
        if math.isnan(value):
            return {"__type__": "float", "value": "NaN"}
        if math.isinf(value):
            return {"__type__": "float", "value": "Infinity" if value > 0 else "-Infinity"}
        return {"__type__": "float", "value": value}
    if isinstance(value, str):
        return value
    if isinstance(value, tuple):
        return {"__type__": "tuple", "value": [serialize(v) for v in value]}
    if isinstance(value, list):
        return [serialize(v) for v in value]
    if isinstance(value, dict):
        return {"__type__": "dict", "value": {str(k): serialize(v) for k, v in value.items()}}
    if isinstance(value, set):
        return {"__type__": "set", "value": sorted([serialize(v) for v in value], key=lambda x: str(x))}
    if isinstance(value, frozenset):
        return {"__type__": "frozenset", "value": sorted([serialize(v) for v in value], key=lambda x: str(x))}
    if isinstance(value, deque):
        return {"__type__": "deque", "value": [serialize(v) for v in value]}
    # For other types, try to convert to string
    return {"__type__": type(value).__name__, "value": str(value)}

def parse_expected_value(val):
    """
    Parse raw expected value from frontend.
    ALL PARSING LOGIC IS HERE IN BACKEND - frontend passes raw values.
    Handles: JSON, Python literals, tuples, numbers, special values,
    and constructor calls like frozenset(), Counter(), OrderedDict(), deque(), list(range())
    """
    import re
    import ast

    # If not a string, it's already parsed (from JSON) - convert it
    if not isinstance(val, str):
        return convert_expected(val)

    trimmed = val.strip()

    # Try JSON parse first
    try:
        parsed = json.loads(trimmed)
        return convert_expected(parsed)
    except (json.JSONDecodeError, ValueError):
        pass

    # Handle Python special values
    if trimmed == 'True':
        return True
    if trimmed == 'False':
        return False
    if trimmed == 'None':
        return None

    # Handle JavaScript special values (for cross-language compat)
    if trimmed == 'undefined':
        return None  # Python has no undefined, use None
    if trimmed == 'NaN':
        return float('nan')
    if trimmed == 'Infinity':
        return float('inf')
    if trimmed == '-Infinity':
        return float('-inf')

    # Handle constructor calls BEFORE ast.literal_eval
    # These patterns extract literals from inside and use ast.literal_eval safely

    # frozenset({...}) or frozenset()
    if trimmed == 'frozenset()':
        return frozenset()
    fs_match = re.match(r'^frozenset\\(\\{(.*)\\}\\)$', trimmed, re.DOTALL)
    if fs_match:
        inner = fs_match.group(1).strip()
        if not inner:
            return frozenset()
        try:
            inner_set = ast.literal_eval('{' + inner + '}')
            return frozenset(inner_set)
        except:
            pass

    # Counter({...}) or Counter()
    if trimmed == 'Counter()':
        return Counter()
    counter_match = re.match(r'^Counter\\(\\{(.*)\\}\\)$', trimmed, re.DOTALL)
    if counter_match:
        inner = counter_match.group(1).strip()
        if not inner:
            return Counter()
        try:
            inner_dict = ast.literal_eval('{' + inner + '}')
            return Counter(inner_dict)
        except:
            pass

    # OrderedDict([...]) or OrderedDict()
    if trimmed == 'OrderedDict()':
        return OrderedDict()
    od_match = re.match(r'^OrderedDict\\(\\[(.*)\\]\\)$', trimmed, re.DOTALL)
    if od_match:
        inner = od_match.group(1).strip()
        if not inner:
            return OrderedDict()
        try:
            inner_list = ast.literal_eval('[' + inner + ']')
            return OrderedDict(inner_list)
        except:
            pass

    # deque([...]) or deque()
    if trimmed == 'deque()':
        return deque()
    deque_match = re.match(r'^deque\\(\\[(.*)\\]\\)$', trimmed, re.DOTALL)
    if deque_match:
        inner = deque_match.group(1).strip()
        if not inner:
            return deque()
        try:
            inner_list = ast.literal_eval('[' + inner + ']')
            return deque(inner_list)
        except:
            pass

    # defaultdict() - note: we can't preserve the default_factory, so just return empty
    if trimmed == 'defaultdict()':
        return defaultdict()

    # list(range(N)) or list(range(N, M)) or list(range(N, M, S))
    range_match = re.match(r'^list\\(range\\(([^)]+)\\)\\)$', trimmed)
    if range_match:
        args = range_match.group(1).strip()
        try:
            arg_parts = [int(x.strip()) for x in args.split(',')]
            if len(arg_parts) == 1:
                return list(range(arg_parts[0]))
            elif len(arg_parts) == 2:
                return list(range(arg_parts[0], arg_parts[1]))
            elif len(arg_parts) == 3:
                return list(range(arg_parts[0], arg_parts[1], arg_parts[2]))
        except:
            pass

    # Safe math expressions: N**M (power operator for large ints)
    power_match = re.match(r'^(-?\\d+)\\*\\*(-?\\d+)$', trimmed)
    if power_match:
        try:
            base = int(power_match.group(1))
            exp = int(power_match.group(2))
            if 0 <= exp <= 1000:
                return base ** exp
        except:
            pass

    # Handle integers
    if re.match(r'^-?\\d+$', trimmed):
        return int(trimmed)

    # Handle floats
    if re.match(r'^-?\\d*\\.\\d+$', trimmed) or re.match(r'^-?\\d+\\.\\d*$', trimmed):
        return float(trimmed)

    # Normalize JSON-style booleans to Python-style before ast.literal_eval
    # This handles expected values like "(true, false, null)" or "{true: 1}"
    normalized = trimmed
    normalized = re.sub(r'\\btrue\\b', 'True', normalized)
    normalized = re.sub(r'\\bfalse\\b', 'False', normalized)
    normalized = re.sub(r'\\bnull\\b', 'None', normalized)

    # Try Python literal eval for tuples, sets, etc.
    try:
        parsed = ast.literal_eval(normalized)
        return parsed
    except (ValueError, SyntaxError):
        pass

    # Return as string (preserve original value including whitespace)
    return val

def convert_expected(val):
    """
    Convert JSON expected value to Python equivalent for comparison
    Handles type markers from serialization
    """
    if val is None:
        return None
    if isinstance(val, bool):
        return val
    if isinstance(val, dict):
        # Check for type markers
        if "__type__" in val and "value" in val:
            t = val["__type__"]
            v = val["value"]
            if t == "tuple":
                return tuple(convert_expected(x) for x in v)
            if t == "set":
                return set(convert_expected(x) for x in v)
            if t == "frozenset":
                return frozenset(convert_expected(x) for x in v)
            if t == "int":
                return int(v)
            if t == "float":
                if v == "NaN":
                    return float('nan')
                if v == "Infinity":
                    return float('inf')
                if v == "-Infinity":
                    return float('-inf')
                return float(v)
            if t == "dict":
                return {k: convert_expected(x) for k, x in v.items()}
            if t == "deque":
                return deque(convert_expected(x) for x in v)
            if t == "Counter":
                return Counter({k: convert_expected(x) for k, x in v.items()})
            if t == "OrderedDict":
                return OrderedDict((k, convert_expected(x)) for k, x in v.items())
            if t == "defaultdict":
                return defaultdict(None, {k: convert_expected(x) for k, x in v.items()})
            if t == "undefined":
                return None  # Python has no undefined
        # Regular dict without type marker
        return {k: convert_expected(v) for k, v in val.items()}
    if isinstance(val, list):
        return [convert_expected(v) for v in val]
    if isinstance(val, (int, float)):
        return val
    if isinstance(val, str):
        return val
    return val

# Read test cases from stdin
test_cases = json.loads(sys.stdin.read())
results = []

for i, tc in enumerate(test_cases):
    try:
        # Execute the function call directly using Python eval
        # This supports all Python syntax: lambdas, list comprehensions, f-strings, etc.
        actual = eval(tc['call'])

        # Parse expected value from raw input (ALL PARSING IN BACKEND)
        expected = parse_expected_value(tc['expected'])

        # STRICT comparison - no type coercion
        passed = deep_equals(actual, expected)

        results.append({
            'index': i,
            'actual': serialize(actual),
            'expected_serialized': serialize(expected),
            'passed': passed,
            'error': None
        })
    except Exception as e:
        results.append({
            'index': i,
            'actual': None,
            'expected_serialized': None,
            'passed': False,
            'error': f"{type(e).__name__}: {str(e)}"
        })

# Restore stdout and output results
sys.stdout = __original_stdout__
sys.stdout.write(json.dumps(results))
sys.stdout.flush()
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
