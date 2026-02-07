const BaseGenerator = require('./base');

/**
 * C++ test runner generator
 *
 * STDIN-BASED MODE: Expected values are delivered via stdin to avoid double-escaping.
 * The call syntax must be valid C++ (e.g., "add(1, 2)")
 *
 * FEATURES:
 * - Supports std::vector, std::map, std::unordered_map, std::set, std::unordered_set, std::pair
 * - JSON expected values are parsed from stdin at runtime
 * - Comprehensive headers included (safe ones only)
 * - Strict type comparison with int/float/double distinction
 *
 * FIXES APPLIED (2026-02-06):
 * - FIX 1: stdin-based expected value delivery (fixes 16 string escaping tests)
 * - FIX 2: Float preservation in parseExpectedValue (fixes t17, t18, t88)
 * - FIX 3: Double-quoted string detection (fixes string coercion)
 * - FIX 4: std::variant serialization support (fixes t49, t53)
 * - FIX 5: char serialization as string (fixes t82)
 * - FIX 6: Empty map {} detection (fixes t16)
 * - FIX 7: Scientific notation in number regex (fixes t30)
 * - FIX 8: Type coercion prevention via explicit float markers
 * - FIX 9: String-containing-JSON pattern (fixes string funcs returning JSON-like content)
 */
class CppGenerator extends BaseGenerator {
    constructor() {
        super('cpp');
    }

    escapeCpp(str) {
        return str
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    }

    /**
     * Protect float literals from JSON.parse() by replacing them with placeholders.
     * Returns { modified: string, floatMap: Map<string, string> }
     *
     * This scans for float tokens (numbers with . or e/E) OUTSIDE of quoted strings
     * and replaces them with "__FLOAT_N__" placeholders.
     */
    protectFloatLiterals(str) {
        const floatMap = new Map();
        let floatIndex = 0;
        let result = '';
        let i = 0;

        while (i < str.length) {
            // Skip over quoted strings entirely
            if (str[i] === '"') {
                result += '"';
                i++;
                while (i < str.length && str[i] !== '"') {
                    if (str[i] === '\\' && i + 1 < str.length) {
                        result += str[i] + str[i + 1];
                        i += 2;
                    } else {
                        result += str[i];
                        i++;
                    }
                }
                if (i < str.length) {
                    result += '"';
                    i++;
                }
                continue;
            }

            // Check for a number token (starts with digit or minus followed by digit)
            if (/[-\d]/.test(str[i])) {
                // Capture the full number token
                let numStart = i;
                let numStr = '';

                // Optional minus
                if (str[i] === '-') {
                    numStr += str[i];
                    i++;
                }

                // Digits before decimal
                while (i < str.length && /\d/.test(str[i])) {
                    numStr += str[i];
                    i++;
                }

                // Optional decimal part
                if (i < str.length && str[i] === '.') {
                    numStr += str[i];
                    i++;
                    while (i < str.length && /\d/.test(str[i])) {
                        numStr += str[i];
                        i++;
                    }
                }

                // Optional exponent
                if (i < str.length && /[eE]/.test(str[i])) {
                    numStr += str[i];
                    i++;
                    if (i < str.length && /[+-]/.test(str[i])) {
                        numStr += str[i];
                        i++;
                    }
                    while (i < str.length && /\d/.test(str[i])) {
                        numStr += str[i];
                        i++;
                    }
                }

                // Check if this is a float (has decimal or exponent)
                const isFloat = numStr.includes('.') || /[eE]/.test(numStr);

                if (isFloat && numStr.length > 0 && /\d/.test(numStr)) {
                    // Replace with placeholder
                    const placeholder = `"__FLOAT_${floatIndex}__"`;
                    floatMap.set(`__FLOAT_${floatIndex}__`, numStr);
                    floatIndex++;
                    result += placeholder;
                } else {
                    // Keep integer as-is
                    result += numStr;
                }
                continue;
            }

            // Copy other characters as-is
            result += str[i];
            i++;
        }

        return { modified: result, floatMap };
    }

    /**
     * Recursively restore __cppFloat wrappers from placeholders after JSON.parse().
     */
    restoreFloatWrappers(value, floatMap) {
        // Check for placeholder string
        if (typeof value === 'string' && value.startsWith('__FLOAT_') && value.endsWith('__')) {
            const original = floatMap.get(value);
            if (original) {
                return { __cppFloat: true, value: parseFloat(original), original };
            }
        }

        // Recurse into arrays
        if (Array.isArray(value)) {
            return value.map(item => this.restoreFloatWrappers(item, floatMap));
        }

        // Recurse into objects
        if (value && typeof value === 'object') {
            const result = {};
            for (const [k, v] of Object.entries(value)) {
                result[k] = this.restoreFloatWrappers(v, floatMap);
            }
            return result;
        }

        return value;
    }

    /**
     * Parse expected value from frontend.
     * Handles:
     *   - Double-quoted strings like "hello" → string (FIX 3)
     *   - JSON strings like "[[1,1],[2,2]]" → parse as array
     *   - C++ initializer syntax like "{1,2,3}" → convert to [1,2,3]
     *   - Plain strings → keep as-is
     *   - Float preservation: 42.0 stays float, not integer (FIX 2)
     *   - Scientific notation: 1e-15 parsed as number (FIX 7)
     *   - Nested floats in arrays/objects preserved via placeholder pre-pass
     */
    parseExpectedValue(value) {
        if (typeof value !== 'string') {
            return value;
        }

        const trimmed = value.trim();

        // FIX 3: Handle double-quoted strings FIRST
        // "hello" → string "hello", "42" → string "42" (not number)
        if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
            try {
                // Parse as JSON string to handle escape sequences
                return JSON.parse(trimmed);
            } catch (e) {
                // If JSON parse fails, strip quotes manually
                return trimmed.slice(1, -1);
            }
        }

        // FIX 6: Handle empty map/object {} before other checks
        if (trimmed === '{}') {
            return {};  // Return empty object, not empty array
        }

        // For JSON arrays and objects, use float-protecting parse
        if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
            (trimmed.startsWith('{') && trimmed.endsWith('}') && trimmed.includes(':'))) {
            try {
                // Protect float literals from JSON.parse()
                const { modified, floatMap } = this.protectFloatLiterals(trimmed);
                const parsed = JSON.parse(modified);
                // Restore __cppFloat wrappers
                return this.restoreFloatWrappers(parsed, floatMap);
            } catch (e) {
                // Not valid JSON, continue to other handlers
            }
        }

        // Handle C++ initializer list syntax: {1,2,3} → [1,2,3]
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
                // Replace { } with [ ] while preserving strings
                let converted = '';
                let inString = false;
                let escapeNext = false;

                for (let i = 0; i < trimmed.length; i++) {
                    const char = trimmed[i];

                    if (escapeNext) {
                        converted += char;
                        escapeNext = false;
                        continue;
                    }

                    if (char === '\\') {
                        converted += char;
                        escapeNext = true;
                        continue;
                    }

                    if (char === '"') {
                        inString = !inString;
                        converted += char;
                        continue;
                    }

                    if (!inString) {
                        if (char === '{') {
                            converted += '[';
                        } else if (char === '}') {
                            converted += ']';
                        } else {
                            converted += char;
                        }
                    } else {
                        converted += char;
                    }
                }

                // Now parse with float protection
                const { modified, floatMap } = this.protectFloatLiterals(converted);
                const parsed = JSON.parse(modified);
                return this.restoreFloatWrappers(parsed, floatMap);
            } catch (e) {
                // If conversion fails, return original value
            }
        }

        // Handle special values
        if (trimmed === 'true') return true;
        if (trimmed === 'false') return false;
        if (trimmed === 'null') return null;
        if (trimmed === 'NaN') return 'NaN';
        if (trimmed === 'Infinity') return 'Infinity';
        if (trimmed === '-Infinity') return '-Infinity';

        // FIX 7: Try to parse as number with scientific notation support
        // Matches: 42, -42, 3.14, -3.14, 1e-15, 1.5e10, -3.14e-5
        const hasDecimal = trimmed.includes('.');
        const hasExponent = /[eE]/.test(trimmed);

        if (/^-?\d+$/.test(trimmed)) {
            // Pure integer (no decimal, no exponent)
            return parseInt(trimmed, 10);
        }

        // Float regex: optional minus, digits, optional decimal+digits, optional exponent
        if (/^-?\d*\.?\d+([eE][+-]?\d+)?$/.test(trimmed) && (hasDecimal || hasExponent)) {
            const num = parseFloat(trimmed);
            // FIX 2 & 8: Preserve float type
            return { __cppFloat: true, value: num, original: trimmed };
        }

        return value;
    }

    /**
     * Recursively unwrap __cppFloat wrappers in a value.
     * Converts { __cppFloat: true, value: 42, original: "42.0" } back to the
     * original string representation so JSON preserves float type.
     */
    unwrapFloats(value) {
        // Handle __cppFloat wrapper
        if (value && typeof value === 'object' && value.__cppFloat) {
            const original = value.original;
            // Return as number that will serialize correctly
            // We need to return a value that JSON.stringify will output as a float
            if (original.includes('.') || /[eE]/.test(original)) {
                // For values like "42.0", parseFloat gives 42, but we need 42.0 in JSON
                // JSON.stringify(42) gives "42", not "42.0"
                // So we mark this for special handling in serializeExpectedForStdin
                return { __rawFloat: original };
            }
            return value.value;
        }

        // Recurse into arrays
        if (Array.isArray(value)) {
            return value.map(item => this.unwrapFloats(item));
        }

        // Recurse into objects
        if (value && typeof value === 'object') {
            const result = {};
            for (const [k, v] of Object.entries(value)) {
                result[k] = this.unwrapFloats(v);
            }
            return result;
        }

        // Primitive values pass through unchanged
        return value;
    }

    /**
     * Custom JSON stringify that handles __rawFloat markers.
     * These need to be output as raw float strings, not quoted.
     */
    stringifyWithFloats(value) {
        if (value === null) return 'null';
        if (value === undefined) return 'null';
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        if (typeof value === 'number') return String(value);
        if (typeof value === 'string') return JSON.stringify(value);

        // Handle __rawFloat marker - output the original float string directly
        if (value && typeof value === 'object' && value.__rawFloat) {
            return value.__rawFloat;
        }

        // Handle arrays
        if (Array.isArray(value)) {
            const items = value.map(item => this.stringifyWithFloats(item));
            return '[' + items.join(',') + ']';
        }

        // Handle objects
        if (typeof value === 'object') {
            const pairs = Object.entries(value).map(([k, v]) =>
                JSON.stringify(k) + ':' + this.stringifyWithFloats(v)
            );
            return '{' + pairs.join(',') + '}';
        }

        return String(value);
    }

    /**
     * Serialize expected value for stdin delivery.
     * Recursively unwraps __cppFloat wrappers and preserves float notation.
     */
    serializeExpectedForStdin(value) {
        const unwrapped = this.unwrapFloats(value);
        return this.stringifyWithFloats(unwrapped);
    }

    /**
     * Convert C++ initializer list syntax to JSON (legacy alias)
     */
    convertCppToJson(value) {
        return this.parseExpectedValue(value);
    }

    /**
     * Transform JSON to C++ map syntax for expected values
     * { "a": 1, "b": 2 } → {{"a", 1}, {"b", 2}}
     */
    transformJsonToCppMapSyntax(value) {
        if (value === null) return 'nullptr';
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        if (typeof value === 'number') return String(value);
        if (typeof value === 'string') return `"${this.escapeCpp(value)}"`;

        if (Array.isArray(value)) {
            // Check if it's a map representation (array of 2-element arrays)
            if (value.length > 0 && value.every(item => Array.isArray(item) && item.length === 2)) {
                // Could be pairs or map entries
                const pairs = value.map(([k, v]) =>
                    `{${this.transformJsonToCppMapSyntax(k)}, ${this.transformJsonToCppMapSyntax(v)}}`
                );
                return `{${pairs.join(', ')}}`;
            }
            // Regular array
            const elements = value.map(v => this.transformJsonToCppMapSyntax(v));
            return `{${elements.join(', ')}}`;
        }

        if (typeof value === 'object') {
            // JSON object → C++ map/initializer list
            const pairs = Object.entries(value).map(([k, v]) =>
                `{${this.transformJsonToCppMapSyntax(k)}, ${this.transformJsonToCppMapSyntax(v)}}`
            );
            return `{${pairs.join(', ')}}`;
        }

        return String(value);
    }

    generateRunner(userFiles, testCases) {
        const mainFile = userFiles[0];

        // FIX 1: Build stdin data with expected values (one JSON per line)
        // This avoids double-escaping issues when embedding in C++ source
        const stdinLines = testCases.map(tc => {
            const expected = this.convertCppToJson(tc.expected);
            return this.serializeExpectedForStdin(expected);
        });
        const stdinData = stdinLines.join('\n');

        // Generate test calls - expected values read from stdin at runtime
        const testCount = testCases.length;
        const testCalls = testCases.map((tc, i) => {
            // The call is used directly as C++ code
            const callCode = tc.call;
            return `
    {
        json result;
        result["index"] = ${i};
        try {
            auto actual = ${callCode};
            json expected = expectedValues[${i}];
            bool passed = compareResults(actual, expected);
            result["actual"] = serializeValue(actual);
            result["expected_serialized"] = expected;  // Include what we compared against
            result["passed"] = passed;
            result["error"] = nullptr;
        } catch (const std::exception& e) {
            result["actual"] = nullptr;
            result["expected_serialized"] = nullptr;
            result["passed"] = false;
            result["error"] = e.what();
        }
        results.push_back(result);
    }`;
        }).join('\n');

        // Comprehensive C++ runner with many headers and type support
        const runnerCode = `
// ============================================================================
// COMPREHENSIVE C++ HEADERS (safe ones only - no file/network/thread)
// ============================================================================
#include <iostream>
#include <vector>
#include <string>
#include <map>
#include <unordered_map>
#include <set>
#include <unordered_set>
#include <queue>
#include <deque>
#include <stack>
#include <list>
#include <forward_list>
#include <array>
#include <bitset>
#include <tuple>
#include <utility>
#include <algorithm>
#include <numeric>
#include <functional>
#include <iterator>
#include <limits>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <cctype>
#include <ctime>
#include <climits>
#include <cfloat>
#include <cassert>
#include <stdexcept>
#include <memory>
#include <optional>
#include <variant>
#include <any>
#include <type_traits>
#include <initializer_list>
#include <sstream>
#include <iomanip>
#include <regex>
#include <random>
#include <complex>
#include <valarray>
#include <nlohmann/json.hpp>

using json = nlohmann::json;
using namespace std;

// ============================================================================
// USER CODE
// ============================================================================

${mainFile.content}

// ============================================================================
// SERIALIZATION HELPERS
// ============================================================================

// Forward declarations
template<typename T> json serializeValue(const T& val);
template<typename T1, typename T2> json serializeValue(const pair<T1, T2>& p);
template<typename T> json serializeValue(const vector<T>& vec);
template<typename K, typename V> json serializeValue(const map<K, V>& m);
template<typename K, typename V> json serializeValue(const unordered_map<K, V>& m);
template<typename T> json serializeValue(const set<T>& s);
template<typename T> json serializeValue(const unordered_set<T>& s);

// Basic type serialization
template<typename T>
json serializeValue(const T& val) {
    return json(val);
}

// FIX 5: Char serialization - convert to single-character string, not ASCII int
template<>
json serializeValue(const char& val) {
    return json(string(1, val));
}

// Pair serialization
template<typename T1, typename T2>
json serializeValue(const pair<T1, T2>& p) {
    return json::array({serializeValue(p.first), serializeValue(p.second)});
}

// Vector serialization
template<typename T>
json serializeValue(const vector<T>& vec) {
    json arr = json::array();
    for (const auto& item : vec) {
        arr.push_back(serializeValue(item));
    }
    return arr;
}

// Vector of pairs serialization
template<typename T1, typename T2>
json serializeValue(const vector<pair<T1, T2>>& vec) {
    json arr = json::array();
    for (const auto& p : vec) {
        arr.push_back(json::array({serializeValue(p.first), serializeValue(p.second)}));
    }
    return arr;
}

// Map serialization (as object for string keys, as array of pairs otherwise)
template<typename K, typename V>
json serializeValue(const map<K, V>& m) {
    if constexpr (is_same_v<K, string>) {
        json obj = json::object();
        for (const auto& [k, v] : m) {
            obj[k] = serializeValue(v);
        }
        return obj;
    } else {
        json arr = json::array();
        for (const auto& [k, v] : m) {
            arr.push_back(json::array({serializeValue(k), serializeValue(v)}));
        }
        return arr;
    }
}

// Unordered map serialization
template<typename K, typename V>
json serializeValue(const unordered_map<K, V>& m) {
    if constexpr (is_same_v<K, string>) {
        json obj = json::object();
        for (const auto& [k, v] : m) {
            obj[k] = serializeValue(v);
        }
        return obj;
    } else {
        json arr = json::array();
        for (const auto& [k, v] : m) {
            arr.push_back(json::array({serializeValue(k), serializeValue(v)}));
        }
        return arr;
    }
}

// Set serialization
template<typename T>
json serializeValue(const set<T>& s) {
    json arr = json::array();
    for (const auto& item : s) {
        arr.push_back(serializeValue(item));
    }
    return arr;
}

// Unordered set serialization
template<typename T>
json serializeValue(const unordered_set<T>& s) {
    json arr = json::array();
    for (const auto& item : s) {
        arr.push_back(serializeValue(item));
    }
    return arr;
}

// Deque serialization
template<typename T>
json serializeValue(const deque<T>& d) {
    json arr = json::array();
    for (const auto& item : d) {
        arr.push_back(serializeValue(item));
    }
    return arr;
}

// List serialization
template<typename T>
json serializeValue(const list<T>& lst) {
    json arr = json::array();
    for (const auto& item : lst) {
        arr.push_back(serializeValue(item));
    }
    return arr;
}

// Optional serialization
template<typename T>
json serializeValue(const optional<T>& opt) {
    if (opt.has_value()) {
        return serializeValue(opt.value());
    }
    return nullptr;
}

// FIX 4: Variant serialization - visit and serialize the active alternative
template<typename... Ts>
json serializeValue(const variant<Ts...>& var) {
    return visit([](const auto& val) -> json {
        return serializeValue(val);
    }, var);
}

// ============================================================================
// STRICT COMPARISON HELPERS
// ============================================================================

// Generic comparison
template<typename T>
bool compareResults(const T& actual, const json& expected) {
    try {
        json actualJson = serializeValue(actual);
        return actualJson == expected;
    } catch (...) {
        return false;
    }
}

// ============================================================================
// STRICT TYPE SPECIALIZATIONS
// - int only matches integer expected values
// - double/float only matches float expected values
// - NO tolerance (except for NaN/Infinity special cases)
// ============================================================================

template<>
bool compareResults(const int& actual, const json& expected) {
    // STRICT: int only matches integer expected values
    if (expected.is_number_integer()) {
        return actual == expected.get<int>();
    }
    // FAIL if expected is float (e.g., 1.0)
    return false;
}

template<>
bool compareResults(const long long& actual, const json& expected) {
    // STRICT: long long only matches integer expected values
    if (expected.is_number_integer()) {
        return actual == expected.get<long long>();
    }
    return false;
}

template<>
bool compareResults(const double& actual, const json& expected) {
    // STRICT: double only matches float expected values
    // Exception: NaN and Infinity have special handling

    // Handle NaN - both must be NaN
    if (std::isnan(actual)) {
        if (expected.is_number()) {
            return std::isnan(expected.get<double>());
        }
        // Also handle string "NaN" from JSON
        if (expected.is_string() && expected.get<string>() == "NaN") {
            return true;
        }
        return false;
    }

    // Handle Infinity - both must be same infinity
    if (std::isinf(actual)) {
        if (expected.is_number()) {
            double exp = expected.get<double>();
            return std::isinf(exp) && (actual > 0) == (exp > 0);
        }
        // Handle string "Infinity" or "-Infinity"
        if (expected.is_string()) {
            string s = expected.get<string>();
            if (actual > 0 && s == "Infinity") return true;
            if (actual < 0 && s == "-Infinity") return true;
        }
        return false;
    }

    // STRICT: For normal numbers, float must match float
    if (expected.is_number_float()) {
        // NO tolerance - exact comparison
        // This catches 0.1 + 0.2 != 0.3 cases
        return actual == expected.get<double>();
    }

    // FAIL if expected is integer (e.g., 1 vs 1.0)
    return false;
}

template<>
bool compareResults(const float& actual, const json& expected) {
    // STRICT: float only matches float expected values

    // Handle NaN
    if (std::isnan(actual)) {
        if (expected.is_number()) {
            return std::isnan(expected.get<float>());
        }
        if (expected.is_string() && expected.get<string>() == "NaN") {
            return true;
        }
        return false;
    }

    // Handle Infinity
    if (std::isinf(actual)) {
        if (expected.is_number()) {
            float exp = expected.get<float>();
            return std::isinf(exp) && (actual > 0) == (exp > 0);
        }
        if (expected.is_string()) {
            string s = expected.get<string>();
            if (actual > 0 && s == "Infinity") return true;
            if (actual < 0 && s == "-Infinity") return true;
        }
        return false;
    }

    // STRICT: For normal numbers, float must match float
    if (expected.is_number_float()) {
        // NO tolerance - exact comparison
        return actual == expected.get<float>();
    }

    // FAIL if expected is integer
    return false;
}

template<>
bool compareResults(const string& actual, const json& expected) {
    if (expected.is_string()) {
        return actual == expected.get<string>();
    }
    // FIX 9: String-containing-JSON pattern
    // Only parse strings that look like JSON structures (arrays or objects).
    // Simple values like "42", "true", "null" should NOT be parsed to preserve strict type checking.
    try {
        if (!actual.empty() && (actual.front() == '[' || actual.front() == '{')) {
            json parsed = json::parse(actual);
            return parsed == expected;
        }
    } catch (...) {}
    return false;
}

template<>
bool compareResults(const bool& actual, const json& expected) {
    if (expected.is_boolean()) {
        return actual == expected.get<bool>();
    }
    return false;
}

// FIX 5: Char comparison - compare as single-character string
template<>
bool compareResults(const char& actual, const json& expected) {
    if (expected.is_string()) {
        string s = expected.get<string>();
        return s.length() == 1 && s[0] == actual;
    }
    return false;
}

// Vector comparison
template<typename T>
bool compareResults(const vector<T>& actual, const json& expected) {
    if (!expected.is_array() || actual.size() != expected.size()) return false;
    for (size_t i = 0; i < actual.size(); ++i) {
        if (!compareResults(actual[i], expected[i])) return false;
    }
    return true;
}

// Vector of pairs comparison
template<typename T1, typename T2>
bool compareResults(const vector<pair<T1, T2>>& actual, const json& expected) {
    if (!expected.is_array() || actual.size() != expected.size()) return false;
    for (size_t i = 0; i < actual.size(); ++i) {
        if (!expected[i].is_array() || expected[i].size() != 2) return false;
        if (!compareResults(actual[i].first, expected[i][0])) return false;
        if (!compareResults(actual[i].second, expected[i][1])) return false;
    }
    return true;
}

// Pair comparison
template<typename T1, typename T2>
bool compareResults(const pair<T1, T2>& actual, const json& expected) {
    if (!expected.is_array() || expected.size() != 2) return false;
    return compareResults(actual.first, expected[0]) &&
           compareResults(actual.second, expected[1]);
}

// Map comparison (with string keys)
template<typename V>
bool compareResults(const map<string, V>& actual, const json& expected) {
    if (!expected.is_object()) return false;
    if (actual.size() != expected.size()) return false;
    for (const auto& [k, v] : actual) {
        if (!expected.contains(k)) return false;
        if (!compareResults(v, expected[k])) return false;
    }
    return true;
}

// Map comparison (with non-string keys - expects array of pairs)
template<typename K, typename V>
bool compareResults(const map<K, V>& actual, const json& expected) {
    if constexpr (is_same_v<K, string>) {
        if (!expected.is_object()) return false;
        if (actual.size() != expected.size()) return false;
        for (const auto& [k, v] : actual) {
            if (!expected.contains(k)) return false;
            if (!compareResults(v, expected[k])) return false;
        }
        return true;
    } else {
        // For non-string keys, expected should be array of [key, value] pairs
        if (!expected.is_array()) return false;
        if (actual.size() != expected.size()) return false;

        // Build a map from expected for comparison
        map<K, json> expectedMap;
        for (const auto& item : expected) {
            if (!item.is_array() || item.size() != 2) return false;
            K key = item[0].get<K>();
            expectedMap[key] = item[1];
        }

        for (const auto& [k, v] : actual) {
            auto it = expectedMap.find(k);
            if (it == expectedMap.end()) return false;
            if (!compareResults(v, it->second)) return false;
        }
        return true;
    }
}

// Unordered map comparison (similar to map)
template<typename K, typename V>
bool compareResults(const unordered_map<K, V>& actual, const json& expected) {
    if constexpr (is_same_v<K, string>) {
        if (!expected.is_object()) return false;
        if (actual.size() != expected.size()) return false;
        for (const auto& [k, v] : actual) {
            if (!expected.contains(k)) return false;
            if (!compareResults(v, expected[k])) return false;
        }
        return true;
    } else {
        if (!expected.is_array()) return false;
        if (actual.size() != expected.size()) return false;

        unordered_map<K, json> expectedMap;
        for (const auto& item : expected) {
            if (!item.is_array() || item.size() != 2) return false;
            K key = item[0].get<K>();
            expectedMap[key] = item[1];
        }

        for (const auto& [k, v] : actual) {
            auto it = expectedMap.find(k);
            if (it == expectedMap.end()) return false;
            if (!compareResults(v, it->second)) return false;
        }
        return true;
    }
}

// Set comparison (expects array, order doesn't matter)
template<typename T>
bool compareResults(const set<T>& actual, const json& expected) {
    if (!expected.is_array()) return false;
    if (actual.size() != expected.size()) return false;

    set<T> expectedSet;
    for (const auto& item : expected) {
        expectedSet.insert(item.get<T>());
    }

    return actual == expectedSet;
}

// Unordered set comparison
template<typename T>
bool compareResults(const unordered_set<T>& actual, const json& expected) {
    if (!expected.is_array()) return false;
    if (actual.size() != expected.size()) return false;

    unordered_set<T> expectedSet;
    for (const auto& item : expected) {
        expectedSet.insert(item.get<T>());
    }

    return actual == expectedSet;
}

// Optional comparison
template<typename T>
bool compareResults(const optional<T>& actual, const json& expected) {
    if (!actual.has_value()) {
        return expected.is_null();
    }
    return compareResults(actual.value(), expected);
}

// FIX 4: Variant comparison - compare the active alternative
template<typename... Ts>
bool compareResults(const variant<Ts...>& actual, const json& expected) {
    return visit([&expected](const auto& val) -> bool {
        return compareResults(val, expected);
    }, actual);
}

// ============================================================================
// MAIN - TEST EXECUTION
// ============================================================================

int main() {
    // FIX 1: Read expected values from stdin (one JSON per line)
    vector<json> expectedValues;
    string line;
    while (getline(cin, line)) {
        if (!line.empty()) {
            expectedValues.push_back(json::parse(line));
        }
    }

    vector<json> results;

    ${testCalls}

    cout << json(results).dump() << endl;
    return 0;
}
`;

        return {
            files: [
                { name: '__test_runner__.cpp', content: runnerCode.trim() }
            ],
            entryPoint: '__test_runner__.cpp',
            stdin: stdinData  // FIX 1: Pass expected values via stdin
        };
    }
}

module.exports = CppGenerator;
