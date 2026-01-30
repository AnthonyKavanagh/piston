const BaseGenerator = require('./base');

/**
 * C++ test runner generator
 *
 * PASS-THROUGH MODE: Call expressions are embedded directly in generated C++ code.
 * The call syntax must be valid C++ (e.g., "add(1, 2)")
 *
 * Expected values can be provided in either:
 * - JSON format: [[1,1],[2,2]]
 * - C++ initializer list format: "{{1,1},{2,2}}" (will be auto-converted)
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
            result["actual"] = actual;
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

        // Note: This is a simplified C++ runner that requires nlohmann/json
        const runnerCode = `
#include <iostream>
#include <vector>
#include <map>
#include <string>
#include <limits>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

// User code
${mainFile.content}

// Helper to compare results
template<typename T>
bool compareResults(const T& actual, const json& expected) {
    try {
        json actualJson = actual;
        return actualJson == expected;
    } catch (...) {
        return false;
    }
}

// Specializations for common types
template<>
bool compareResults(const int& actual, const json& expected) {
    if (expected.is_number()) {
        return actual == expected.get<int>();
    }
    return false;
}

template<>
bool compareResults(const double& actual, const json& expected) {
    if (expected.is_number()) {
        double exp = expected.get<double>();
        if (std::isnan(actual) && std::isnan(exp)) return true;
        return actual == exp;
    }
    return false;
}

template<>
bool compareResults(const std::string& actual, const json& expected) {
    if (expected.is_string()) {
        return actual == expected.get<std::string>();
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

template<typename T>
bool compareResults(const std::vector<T>& actual, const json& expected) {
    if (!expected.is_array() || actual.size() != expected.size()) return false;
    for (size_t i = 0; i < actual.size(); ++i) {
        if (!compareResults(actual[i], expected[i])) return false;
    }
    return true;
}

// Specialization for vector of pairs
template<typename T1, typename T2>
bool compareResults(const std::vector<std::pair<T1,T2>>& actual, const json& expected) {
    if (!expected.is_array() || actual.size() != expected.size()) return false;
    for (size_t i = 0; i < actual.size(); ++i) {
        if (!expected[i].is_array() || expected[i].size() != 2) return false;
        json actualPair = {actual[i].first, actual[i].second};
        if (actualPair != expected[i]) return false;
    }
    return true;
}

int main() {
    std::vector<json> results;

    ${testCalls}

    std::cout << json(results).dump() << std::endl;
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
