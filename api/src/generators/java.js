const BaseGenerator = require('./base');

/**
 * Java test runner generator
 *
 * PASS-THROUGH MODE: Call expressions are embedded directly in generated Java code.
 * The call syntax must be valid Java (e.g., "Solution.add(1, 2)" or just "add(1, 2)")
 *
 * If a call doesn't have a class prefix, the generator will try to find the
 * user's class and prepend it automatically.
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
            const expectedJson = this.escapeJava(JSON.stringify(tc.expected));

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
                Object expected = gson.fromJson("${expectedJson}", Object.class);
                boolean passed = deepEquals(actual, expected);
                results.add(new TestResult(${i}, actual, passed, null));
            } catch (Exception e) {
                results.add(new TestResult(${i}, null, false, e.getClass().getSimpleName() + ": " + e.getMessage()));
            }`;
        }).join('\n');

        // Remove package declaration from user code if present (to allow compilation in same directory)
        let userCode = mainFile.content;
        userCode = userCode.replace(/^\s*package\s+[\w.]+\s*;\s*/m, '');

        const runnerCode = `
import java.util.*;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

// User code
${userCode}

public class __TestRunner__ {
    static Gson gson = new GsonBuilder().serializeNulls().create();

    static class TestResult {
        int index;
        Object actual;
        boolean passed;
        String error;

        TestResult(int i, Object a, boolean p, String e) {
            index = i;
            actual = a;
            passed = p;
            error = e;
        }
    }

    static boolean deepEquals(Object a, Object b) {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;

        // Handle numeric comparison with tolerance for int/double
        if (a instanceof Number && b instanceof Number) {
            double da = ((Number) a).doubleValue();
            double db = ((Number) b).doubleValue();
            if (Double.isNaN(da) && Double.isNaN(db)) return true;
            return da == db;
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

        // Handle arrays (convert to list comparison)
        if (a.getClass().isArray()) {
            int len = java.lang.reflect.Array.getLength(a);
            if (b instanceof List) {
                List<?> lb = (List<?>) b;
                if (len != lb.size()) return false;
                for (int i = 0; i < len; i++) {
                    if (!deepEquals(java.lang.reflect.Array.get(a, i), lb.get(i))) return false;
                }
                return true;
            } else if (b.getClass().isArray()) {
                int lenB = java.lang.reflect.Array.getLength(b);
                if (len != lenB) return false;
                for (int i = 0; i < len; i++) {
                    if (!deepEquals(java.lang.reflect.Array.get(a, i), java.lang.reflect.Array.get(b, i))) return false;
                }
                return true;
            }
        }

        // Handle maps
        if (a instanceof Map && b instanceof Map) {
            Map<?, ?> ma = (Map<?, ?>) a;
            Map<?, ?> mb = (Map<?, ?>) b;
            if (ma.size() != mb.size()) return false;
            for (Object key : ma.keySet()) {
                String keyStr = String.valueOf(key);
                Object va = ma.get(key);
                // Try both the key and string version
                Object vb = mb.containsKey(key) ? mb.get(key) : mb.get(keyStr);
                if (vb == null && !mb.containsKey(key) && !mb.containsKey(keyStr)) return false;
                if (!deepEquals(va, vb)) return false;
            }
            return true;
        }

        return a.equals(b);
    }

    static String serialize(Object obj) {
        if (obj == null) return "null";
        if (obj instanceof Boolean) return obj.toString();
        if (obj instanceof Number) {
            double d = ((Number) obj).doubleValue();
            if (Double.isNaN(d)) return "\\"NaN\\"";
            if (Double.isInfinite(d)) return d > 0 ? "\\"Infinity\\"" : "\\"-Infinity\\"";
            if (obj instanceof Integer || obj instanceof Long) return obj.toString();
            return obj.toString();
        }
        if (obj instanceof String) {
            return "\\"" + ((String) obj).replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"") + "\\"";
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
            int len = java.lang.reflect.Array.getLength(obj);
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < len; i++) {
                if (i > 0) sb.append(",");
                sb.append(serialize(java.lang.reflect.Array.get(obj, i)));
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

    public static void main(String[] args) {
        List<TestResult> results = new ArrayList<>();
        ${testCalls}

        // Output results as JSON
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < results.size(); i++) {
            if (i > 0) sb.append(",");
            TestResult r = results.get(i);
            sb.append("{");
            sb.append("\\"index\\":").append(r.index);
            sb.append(",\\"actual\\":").append(serialize(r.actual));
            sb.append(",\\"passed\\":").append(r.passed);
            sb.append(",\\"error\\":").append(r.error == null ? "null" : "\\"" + r.error.replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"") + "\\"");
            sb.append("}");
        }
        sb.append("]");
        System.out.println(sb.toString());
    }
}
`;

        return {
            files: [
                { name: '__TestRunner__.java', content: runnerCode.trim() }
            ],
            entryPoint: '__TestRunner__.java',
            stdin: ''
        };
    }
}

module.exports = JavaGenerator;
