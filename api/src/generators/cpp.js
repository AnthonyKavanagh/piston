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
     * Convert C++ initializer list syntax to JSON
     * Examples:
     *   "{{1,1},{2,2}}" → [[1,1],[2,2]]
     *   "{1,2,3}" → [1,2,3]
     *   "{}" → []
     */
    convertCppToJson(value) {
        if (typeof value !== 'string') {
            return value;
        }

        // Check if it looks like C++ initializer list syntax
        const trimmed = value.trim();
        if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
            return value; // Not C++ syntax, return as-is
        }

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
            return value;
        }
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
            result["passed"] = passed;
            result["error"] = nullptr;
        } catch (const std::exception& e) {
            result["actual"] = nullptr;
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

// Specializations for common types
template<>
bool compareResults(const int& actual, const json& expected) {
    if (expected.is_number_integer()) {
        return actual == expected.get<int>();
    }
    return false;
}

template<>
bool compareResults(const long long& actual, const json& expected) {
    if (expected.is_number_integer()) {
        return actual == expected.get<long long>();
    }
    return false;
}

template<>
bool compareResults(const double& actual, const json& expected) {
    if (expected.is_number()) {
        double exp = expected.get<double>();
        if (std::isnan(actual) && std::isnan(exp)) return true;
        if (std::isinf(actual) && std::isinf(exp)) return (actual > 0) == (exp > 0);
        return std::abs(actual - exp) < 1e-9;
    }
    return false;
}

template<>
bool compareResults(const float& actual, const json& expected) {
    if (expected.is_number()) {
        float exp = expected.get<float>();
        if (std::isnan(actual) && std::isnan(exp)) return true;
        if (std::isinf(actual) && std::isinf(exp)) return (actual > 0) == (exp > 0);
        return std::abs(actual - exp) < 1e-6f;
    }
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
