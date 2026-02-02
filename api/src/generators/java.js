const BaseGenerator = require('./base');

/**
 * Java test runner generator
 *
 * PASS-THROUGH MODE: Call expressions are embedded directly in generated Java code.
 * The call syntax must be valid Java (e.g., "Solution.add(1, 2)" or just "add(1, 2)")
 *
 * If a call doesn't have a class prefix, the generator will try to find the
 * user's class and prepend it automatically.
 *
 * Note: Does NOT use external libraries (no Gson) - pure Java only.
 */
class JavaGenerator extends BaseGenerator {
    constructor() {
        super('java');
    }

    escapeJava(str) {
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
     * Otherwise keep as-is.
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
                return expected;
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

        // Keep as string
        return expected;
    }

    generateRunner(userFiles, testCases) {
        const mainFile = userFiles[0];

        // Extract class names from user code
        const classPattern = /(?:public\s+)?class\s+(\w+)/g;
        const classNames = [];
        let match;
        while ((match = classPattern.exec(mainFile.content)) !== null) {
            classNames.push(match[1]);
        }

        // The primary class to use for unprefixed calls (usually "Solution" or the first found)
        const primaryClass = classNames.find(n => n === 'Solution') || classNames[0] || null;

        // Generate test method calls - call expressions are embedded directly
        const testCalls = testCases.map((tc, i) => {
            // Parse expected value - if it's a string like "[[1,1],[2,2]]", parse it as array
            const parsedExpected = this.parseExpectedValue(tc.expected);
            const expectedJson = this.escapeJava(JSON.stringify(parsedExpected));

            // Check if call already has a class prefix
            let callCode = tc.call;

            if (primaryClass) {
                // Check if the call starts with a function name (no class prefix)
                const hasClassPrefix = /^[A-Z][a-zA-Z0-9_]*\./.test(callCode);

                if (!hasClassPrefix) {
                    // Prepend the primary class name
                    callCode = `${primaryClass}.${callCode}`;
                }
            }

            return `
            try {
                Object actual = ${callCode};
                Object expected = parseJson("${expectedJson}");
                boolean passed = deepEquals(actual, expected);
                results.add(formatResult(${i}, serialize(actual), serialize(expected), passed, null));
            } catch (Exception e) {
                results.add(formatResult(${i}, "null", "null", false, e.getClass().getSimpleName() + ": " + e.getMessage()));
            }`;
        }).join('\n');

        // Remove package declaration from user code if present (to allow compilation in same directory)
        let userCode = mainFile.content;
        userCode = userCode.replace(/^\s*package\s+[\w.]+\s*;\s*/m, '');

        // Extract import statements from user code to put at the top
        const importPattern = /^\s*import\s+[\w.*]+\s*;\s*$/gm;
        const userImports = [];
        let importMatch;
        while ((importMatch = importPattern.exec(userCode)) !== null) {
            userImports.push(importMatch[0].trim());
        }
        // Remove imports from user code (they'll be at the top)
        userCode = userCode.replace(importPattern, '');

        // Remove 'public' modifier from class declarations so only __TestRunner__ is public
        // This is required because Java only allows one public class per file
        userCode = userCode.replace(/public\s+(class|interface|enum)\s+/g, '$1 ');

        // Combine our imports with user imports (deduplicated)
        const allImports = new Set([
            'import java.util.*;',
            'import java.lang.reflect.Array;',
            ...userImports
        ]);
        const importsCode = Array.from(allImports).join('\n');

        const runnerCode = `
${importsCode}

public class __TestRunner__ {

    static String serialize(Object obj) {
        if (obj == null) return "null";
        if (obj instanceof Boolean) return obj.toString();
        if (obj instanceof Number) {
            double d = ((Number) obj).doubleValue();
            if (Double.isNaN(d)) return "\\"NaN\\"";
            if (Double.isInfinite(d)) return d > 0 ? "\\"Infinity\\"" : "\\"-Infinity\\"";
            // Check if it's a whole number
            if (obj instanceof Double || obj instanceof Float) {
                if (d == Math.floor(d) && !Double.isInfinite(d)) {
                    return String.valueOf((long) d);
                }
            }
            return obj.toString();
        }
        if (obj instanceof String) {
            return "\\"" + ((String) obj).replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"").replace("\\n", "\\\\n").replace("\\r", "\\\\r").replace("\\t", "\\\\t") + "\\"";
        }
        if (obj instanceof List) {
            List<?> list = (List<?>) obj;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < list.size(); i++) {
                if (i > 0) sb.append(",");
                sb.append(serialize(list.get(i)));
            }
            sb.append("]");
            return sb.toString();
        }
        if (obj.getClass().isArray()) {
            int len = Array.getLength(obj);
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < len; i++) {
                if (i > 0) sb.append(",");
                sb.append(serialize(Array.get(obj, i)));
            }
            sb.append("]");
            return sb.toString();
        }
        if (obj instanceof Map) {
            Map<?, ?> map = (Map<?, ?>) obj;
            StringBuilder sb = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) sb.append(",");
                first = false;
                sb.append("\\"").append(entry.getKey()).append("\\":");
                sb.append(serialize(entry.getValue()));
            }
            sb.append("}");
            return sb.toString();
        }
        return "\\"" + obj.toString() + "\\"";
    }

    static Object parseJson(String json) {
        json = json.trim();
        if (json.equals("null")) return null;
        if (json.equals("true")) return true;
        if (json.equals("false")) return false;
        if (json.startsWith("\\"") && json.endsWith("\\"")) {
            return json.substring(1, json.length() - 1)
                .replace("\\\\n", "\\n")
                .replace("\\\\r", "\\r")
                .replace("\\\\t", "\\t")
                .replace("\\\\\\"", "\\"")
                .replace("\\\\\\\\", "\\\\");
        }
        if (json.startsWith("[") && json.endsWith("]")) {
            List<Object> list = new ArrayList<>();
            String inner = json.substring(1, json.length() - 1).trim();
            if (inner.isEmpty()) return list;
            for (String item : splitJson(inner)) {
                list.add(parseJson(item));
            }
            return list;
        }
        if (json.startsWith("{") && json.endsWith("}")) {
            Map<String, Object> map = new LinkedHashMap<>();
            String inner = json.substring(1, json.length() - 1).trim();
            if (inner.isEmpty()) return map;
            for (String pair : splitJson(inner)) {
                int colonIdx = findColon(pair);
                if (colonIdx > 0) {
                    String key = pair.substring(0, colonIdx).trim();
                    if (key.startsWith("\\"") && key.endsWith("\\"")) {
                        key = key.substring(1, key.length() - 1);
                    }
                    String val = pair.substring(colonIdx + 1).trim();
                    map.put(key, parseJson(val));
                }
            }
            return map;
        }
        // Try parsing as number
        try {
            if (json.contains(".") || json.contains("e") || json.contains("E")) {
                return Double.parseDouble(json);
            }
            return Long.parseLong(json);
        } catch (NumberFormatException e) {
            return json;
        }
    }

    static int findColon(String s) {
        int depth = 0;
        boolean inString = false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' && (i == 0 || s.charAt(i - 1) != '\\\\')) inString = !inString;
            if (!inString) {
                if (c == '[' || c == '{') depth++;
                else if (c == ']' || c == '}') depth--;
                else if (c == ':' && depth == 0) return i;
            }
        }
        return -1;
    }

    static List<String> splitJson(String json) {
        List<String> result = new ArrayList<>();
        int depth = 0;
        int start = 0;
        boolean inString = false;
        for (int i = 0; i < json.length(); i++) {
            char c = json.charAt(i);
            if (c == '"' && (i == 0 || json.charAt(i - 1) != '\\\\')) inString = !inString;
            if (!inString) {
                if (c == '[' || c == '{') depth++;
                else if (c == ']' || c == '}') depth--;
                else if (c == ',' && depth == 0) {
                    result.add(json.substring(start, i).trim());
                    start = i + 1;
                }
            }
        }
        if (start < json.length()) {
            result.add(json.substring(start).trim());
        }
        return result;
    }

    static boolean deepEquals(Object a, Object b) {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;

        // Handle numeric comparison
        if (a instanceof Number && b instanceof Number) {
            double da = ((Number) a).doubleValue();
            double db = ((Number) b).doubleValue();
            if (Double.isNaN(da) && Double.isNaN(db)) return true;
            return Math.abs(da - db) < 0.0000001;
        }

        // Handle arrays vs lists
        if (a.getClass().isArray()) {
            int len = Array.getLength(a);
            if (b instanceof List) {
                List<?> lb = (List<?>) b;
                if (len != lb.size()) return false;
                for (int i = 0; i < len; i++) {
                    if (!deepEquals(Array.get(a, i), lb.get(i))) return false;
                }
                return true;
            } else if (b.getClass().isArray()) {
                int lenB = Array.getLength(b);
                if (len != lenB) return false;
                for (int i = 0; i < len; i++) {
                    if (!deepEquals(Array.get(a, i), Array.get(b, i))) return false;
                }
                return true;
            }
            return false;
        }

        // Handle lists
        if (a instanceof List && b instanceof List) {
            List<?> la = (List<?>) a;
            List<?> lb = (List<?>) b;
            if (la.size() != lb.size()) return false;
            for (int i = 0; i < la.size(); i++) {
                if (!deepEquals(la.get(i), lb.get(i))) return false;
            }
            return true;
        }

        // Handle maps
        if (a instanceof Map && b instanceof Map) {
            Map<?, ?> ma = (Map<?, ?>) a;
            Map<?, ?> mb = (Map<?, ?>) b;
            if (ma.size() != mb.size()) return false;
            for (Object key : ma.keySet()) {
                String keyStr = String.valueOf(key);
                Object va = ma.get(key);
                Object vb = mb.containsKey(key) ? mb.get(key) : mb.get(keyStr);
                if (vb == null && !mb.containsKey(key) && !mb.containsKey(keyStr)) return false;
                if (!deepEquals(va, vb)) return false;
            }
            return true;
        }

        // String comparison
        if (a instanceof String || b instanceof String) {
            return String.valueOf(a).equals(String.valueOf(b));
        }

        return a.equals(b);
    }

    static String formatResult(int index, String actual, String expectedSerialized, boolean passed, String error) {
        StringBuilder sb = new StringBuilder();
        sb.append("{");
        sb.append("\\"index\\":").append(index);
        sb.append(",\\"actual\\":").append(actual);
        sb.append(",\\"expected_serialized\\":").append(expectedSerialized);
        sb.append(",\\"passed\\":").append(passed);
        sb.append(",\\"error\\":");
        if (error == null) {
            sb.append("null");
        } else {
            sb.append("\\"").append(error.replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"")).append("\\"");
        }
        sb.append("}");
        return sb.toString();
    }

    public static void main(String[] args) {
        List<String> results = new ArrayList<>();

        ${testCalls}

        System.out.println("[" + String.join(",", results) + "]");
    }
}

// User code
${userCode}
`;

        return {
            files: [
                { name: '__TestRunner__.java', content: runnerCode.trim() }
            ],
            entryPoint: '__TestRunner__',
            stdin: ''
        };
    }
}

module.exports = JavaGenerator;
