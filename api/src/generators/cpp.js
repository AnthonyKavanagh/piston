const BaseGenerator = require('./base');

/**
 * C++ test runner generator
 *
 * PASS-THROUGH MODE: Call expressions are embedded directly in generated C++ code.
 * The call syntax must be valid C++ (e.g., "add(1, 2)")
 *
 * FEATURES:
 * - Supports std::vector, std::map, std::unordered_map, std::set, std::unordered_set, std::pair
 * - JSON expected values are converted to C++ initializer syntax
 * - Comprehensive headers included (safe ones only)
 * - Strict type comparison
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
     * Parse expected value from frontend.
     * Handles:
     *   - JSON strings like "[[1,1],[2,2]]" → parse as array
     *   - C++ initializer syntax like "{1,2,3}" → convert to [1,2,3]
     *   - Plain strings → keep as-is
     */
    parseExpectedValue(value) {
        if (typeof value !== 'string') {
            return value;
        }

        const trimmed = value.trim();

        // First, try to parse as JSON directly (handles "[[1,1],[2,2]]" etc.)
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
                return JSON.parse(trimmed);
            } catch (e) {
                // Not valid JSON, continue
            }
        }

        // Try to parse as JSON object
        if (trimmed.startsWith('{') && trimmed.endsWith('}') && trimmed.includes(':')) {
            try {
                return JSON.parse(trimmed);
            } catch (e) {
                // Not valid JSON object, might be C++ initializer
            }
        }

        // Handle C++ initializer list syntax: {1,2,3} → [1,2,3]
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
                // Replace { } with [ ] while preserving strings
                let result = '';
                let inString = false;
                let escapeNext = false;

                for (let i = 0; i < trimmed.length; i++) {
                    const char = trimmed[i];

                    if (escapeNext) {
                        result += char;
                        escapeNext = false;
                        continue;
                    }

                    if (char === '\\') {
                        result += char;
                        escapeNext = true;
                        continue;
                    }

                    if (char === '"') {
                        inString = !inString;
                        result += char;
                        continue;
                    }

                    if (!inString) {
                        if (char === '{') {
                            result += '[';
                        } else if (char === '}') {
                            result += ']';
                        } else {
                            result += char;
                        }
                    } else {
                        result += char;
                    }
                }

                // Try to parse as JSON
                const parsed = JSON.parse(result);
                return parsed;
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

        // Try to parse as number
        if (/^-?\d+$/.test(trimmed)) {
            return parseInt(trimmed, 10);
        }
        if (/^-?\d*\.?\d+$/.test(trimmed)) {
            return parseFloat(trimmed);
        }

        return value;
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

        // Generate test calls - call expressions are embedded directly
        const testCalls = testCases.map((tc, i) => {
            // Convert C++ syntax to JSON if needed
            const expected = this.convertCppToJson(tc.expected);
            const expectedJson = this.escapeCpp(JSON.stringify(expected));

            // The call is used directly as C++ code
            const callCode = tc.call;
            return `
    {
        json result;
        result["index"] = ${i};
        try {
            auto actual = ${callCode};
            auto expected = json::parse("${expectedJson}");
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
    return false;
}

template<>
bool compareResults(const bool& actual, const json& expected) {
    if (expected.is_boolean()) {
        return actual == expected.get<bool>();
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

// ============================================================================
// MAIN - TEST EXECUTION
// ============================================================================

int main() {
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
            stdin: ''
        };
    }
}

module.exports = CppGenerator;
