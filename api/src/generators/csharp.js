const BaseGenerator = require('./base');

/**
 * C# test runner generator
 *
 * PASS-THROUGH MODE: Call expressions are embedded directly in generated C# code.
 * The call syntax must be valid C# (e.g., "Solution.Add(1, 2)" or just "Add(1, 2)")
 *
 * If a call doesn't have a class prefix, the generator will try to find the
 * user's class and prepend it automatically.
 */
class CSharpGenerator extends BaseGenerator {
    constructor() {
        super('csharp');
    }

    escapeCSharp(str) {
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

        // Extract class names from user code
        // Look for public class or just class declarations
        const classPattern = /(?:public\s+)?(?:static\s+)?class\s+(\w+)/g;
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
            const expectedJson = this.escapeCSharp(JSON.stringify(parsedExpected));

            // Check if call already has a class prefix (e.g., "Solution.Method" or "MyClass.Method")
            // A bare function call starts with a letter and has '(' without a '.' before it
            let callCode = tc.call;

            if (primaryClass) {
                // Check if the call starts with a function name (no class prefix)
                // Pattern: starts with letter, then word chars, then '(' - but NOT preceded by '.'
                const hasClassPrefix = /^[A-Z][a-zA-Z0-9_]*\./.test(callCode);

                if (!hasClassPrefix) {
                    // Prepend the primary class name
                    callCode = `${primaryClass}.${callCode}`;
                }
            }

            return `
            {
                int index = ${i};
                try
                {
                    var actual = ${callCode};
                    var expectedStr = "${expectedJson}";
                    bool passed = CompareWithExpected(actual, expectedStr);
                    results.Add(FormatResult(index, Serialize(actual), passed, null));
                }
                catch (Exception e)
                {
                    results.Add(FormatResult(index, "null", false, e.GetType().Name + ": " + e.Message));
                }
            }`;
        }).join('\n');

        // Embed user code directly like C++
        const runnerCode = `
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

// User code
${mainFile.content}

public class __TestRunner__
{
    static string Serialize(object obj)
    {
        if (obj == null) return "null";
        if (obj is bool b) return b ? "true" : "false";
        if (obj is string s) return "\\"" + s.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"") + "\\"";
        if (obj is char c) return "\\"" + c + "\\"";
        if (IsNumeric(obj))
        {
            double d = Convert.ToDouble(obj);
            if (double.IsNaN(d)) return "\\"NaN\\"";
            if (double.IsPositiveInfinity(d)) return "\\"Infinity\\"";
            if (double.IsNegativeInfinity(d)) return "\\"-Infinity\\"";
            return obj.ToString();
        }
        if (obj is IEnumerable && !(obj is string))
        {
            var items = new List<string>();
            foreach (var item in (IEnumerable)obj)
                items.Add(Serialize(item));
            return "[" + string.Join(",", items) + "]";
        }
        if (obj is IDictionary dict)
        {
            var pairs = new List<string>();
            foreach (DictionaryEntry entry in dict)
                pairs.Add("\\"" + entry.Key.ToString() + "\\":" + Serialize(entry.Value));
            return "{" + string.Join(",", pairs) + "}";
        }
        // For tuples and other types, try to serialize as array
        var type = obj.GetType();
        if (type.IsGenericType && type.Name.StartsWith("ValueTuple"))
        {
            var fields = type.GetFields();
            var items = new List<string>();
            foreach (var field in fields)
                items.Add(Serialize(field.GetValue(obj)));
            return "[" + string.Join(",", items) + "]";
        }
        return "\\"" + obj.ToString() + "\\"";
    }

    static object ParseJson(string json)
    {
        json = json.Trim();
        if (json == "null") return null;
        if (json == "true") return true;
        if (json == "false") return false;
        if (json.StartsWith("\\"") && json.EndsWith("\\""))
            return json.Substring(1, json.Length - 2);
        if (json.StartsWith("[") && json.EndsWith("]"))
        {
            var list = new List<object>();
            var inner = json.Substring(1, json.Length - 2).Trim();
            if (string.IsNullOrEmpty(inner)) return list;
            foreach (var item in SplitJson(inner))
                list.Add(ParseJson(item));
            return list;
        }
        if (json.StartsWith("{") && json.EndsWith("}"))
        {
            var dict = new Dictionary<string, object>();
            var inner = json.Substring(1, json.Length - 2).Trim();
            if (string.IsNullOrEmpty(inner)) return dict;
            foreach (var pair in SplitJson(inner))
            {
                var colonIdx = pair.IndexOf(':');
                if (colonIdx > 0)
                {
                    var key = pair.Substring(0, colonIdx).Trim().Trim('"');
                    var val = pair.Substring(colonIdx + 1).Trim();
                    dict[key] = ParseJson(val);
                }
            }
            return dict;
        }
        if (double.TryParse(json, out double d)) return d;
        return json;
    }

    static List<string> SplitJson(string json)
    {
        var result = new List<string>();
        int depth = 0;
        int start = 0;
        bool inString = false;
        for (int i = 0; i < json.Length; i++)
        {
            char c = json[i];
            if (c == '"' && (i == 0 || json[i-1] != '\\\\')) inString = !inString;
            if (!inString)
            {
                if (c == '[' || c == '{') depth++;
                else if (c == ']' || c == '}') depth--;
                else if (c == ',' && depth == 0)
                {
                    result.Add(json.Substring(start, i - start).Trim());
                    start = i + 1;
                }
            }
        }
        if (start < json.Length)
            result.Add(json.Substring(start).Trim());
        return result;
    }

    static bool CompareWithExpected(object actual, string expectedJson)
    {
        var expected = ParseJson(expectedJson);
        return DeepEquals(actual, expected);
    }

    static bool DeepEquals(object a, object b)
    {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;

        // Handle numeric comparison
        if (IsNumeric(a) && IsNumeric(b))
        {
            double da = Convert.ToDouble(a);
            double db = Convert.ToDouble(b);
            if (double.IsNaN(da) && double.IsNaN(db)) return true;
            return Math.Abs(da - db) < 0.0000001;
        }

        // Handle tuples as arrays
        var typeA = a.GetType();
        if (typeA.IsGenericType && typeA.Name.StartsWith("ValueTuple"))
        {
            var fields = typeA.GetFields();
            var listA = fields.Select(f => f.GetValue(a)).ToList();
            return DeepEquals(listA, b);
        }

        // Handle arrays/lists
        if (a is IEnumerable && b is IEnumerable && !(a is string) && !(b is string))
        {
            var listA = ((IEnumerable)a).Cast<object>().ToList();
            var listB = ((IEnumerable)b).Cast<object>().ToList();
            if (listA.Count != listB.Count) return false;
            for (int i = 0; i < listA.Count; i++)
            {
                if (!DeepEquals(listA[i], listB[i])) return false;
            }
            return true;
        }

        // Handle dictionaries
        if (a is IDictionary && b is IDictionary)
        {
            var dictA = (IDictionary)a;
            var dictB = (IDictionary)b;
            if (dictA.Count != dictB.Count) return false;
            foreach (var key in dictA.Keys)
            {
                var keyStr = key.ToString();
                object valB = null;
                if (dictB.Contains(key)) valB = dictB[key];
                else if (dictB.Contains(keyStr)) valB = dictB[keyStr];
                else return false;
                if (!DeepEquals(dictA[key], valB)) return false;
            }
            return true;
        }

        // String comparison
        if (a is string || b is string)
            return a.ToString() == b.ToString();

        return a.Equals(b);
    }

    static bool IsNumeric(object o)
    {
        return o is sbyte || o is byte || o is short || o is ushort ||
               o is int || o is uint || o is long || o is ulong ||
               o is float || o is double || o is decimal;
    }

    static string FormatResult(int index, string actual, bool passed, string error)
    {
        var sb = new StringBuilder();
        sb.Append("{");
        sb.Append("\\"index\\":" + index);
        sb.Append(",\\"actual\\":" + actual);
        sb.Append(",\\"passed\\":" + (passed ? "true" : "false"));
        sb.Append(",\\"error\\":" + (error == null ? "null" : "\\"" + error.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"") + "\\""));
        sb.Append("}");
        return sb.ToString();
    }

    public static void Main(string[] args)
    {
        var results = new List<string>();

        ${testCalls}

        Console.WriteLine("[" + string.Join(",", results) + "]");
    }
}
`;

        return {
            files: [
                { name: '__TestRunner__.cs', content: runnerCode.trim() }
            ],
            entryPoint: '__TestRunner__.cs',
            stdin: ''
        };
    }
}

module.exports = CSharpGenerator;
