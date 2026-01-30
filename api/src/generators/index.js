const PythonGenerator = require('./python');
const JavaScriptGenerator = require('./javascript');
const JavaGenerator = require('./java');
const CGenerator = require('./c');
const CppGenerator = require('./cpp');
const CSharpGenerator = require('./csharp');
const GoGenerator = require('./go');
const RubyGenerator = require('./ruby');
const GenericGenerator = require('./generic');

/**
 * Registry of language-specific generators
 */
const generators = {
    // Python family
    python: new PythonGenerator(),
    python2: new PythonGenerator(),
    python3: new PythonGenerator(),
    'python3.10': new PythonGenerator(),
    'python3.11': new PythonGenerator(),
    'python3.12': new PythonGenerator(),

    // JavaScript/Node family
    javascript: new JavaScriptGenerator(),
    node: new JavaScriptGenerator(),
    nodejs: new JavaScriptGenerator(),
    'node-javascript': new JavaScriptGenerator(),

    // TypeScript (uses JS runner since it compiles to JS)
    typescript: new JavaScriptGenerator(),
    ts: new JavaScriptGenerator(),

    // Java family
    java: new JavaGenerator(),

    // C family
    c: new CGenerator(),

    // C++ family
    cpp: new CppGenerator(),
    'c++': new CppGenerator(),
    'cpp17': new CppGenerator(),
    'cpp20': new CppGenerator(),

    // C# family
    csharp: new CSharpGenerator(),
    'c#': new CSharpGenerator(),
    cs: new CSharpGenerator(),
    dotnet: new CSharpGenerator(),

    // Go family
    go: new GoGenerator(),
    golang: new GoGenerator(),

    // Ruby family
    ruby: new RubyGenerator(),

    // PHP (can use eval-based approach similar to Python)
    // php: new PhpGenerator(),

    // Perl (can use eval-based approach)
    // perl: new PerlGenerator(),

    // Lua (can use loadstring-based approach)
    // lua: new LuaGenerator(),
};

/**
 * Get a generator for the specified language
 * Falls back to GenericGenerator for unsupported languages
 */
function getGenerator(language) {
    const lang = language.toLowerCase().replace(/[^a-z0-9+#]/g, '');
    return generators[lang] || new GenericGenerator(language);
}

/**
 * Generate test runner files for the specified language
 *
 * PASS-THROUGH MODE: Call expressions are passed directly to the language runtime.
 * This allows language-specific syntax like Python lambdas, list comprehensions, f-strings, etc.
 *
 * @param {string} language - The programming language
 * @param {Array} userFiles - Array of {name, content} objects
 * @param {Array} testCases - Array of test cases with {call: string, expected: any}
 * @returns {Object} - { files, entryPoint, stdin, mode? }
 */
function generateTestRunner(language, userFiles, testCases) {
    // Pass-through mode: test cases go directly to the language runtime
    // Each test case has {call: string, expected: any}
    // The call string is evaluated natively by the target language
    const generator = getGenerator(language);
    return generator.generateRunner(userFiles, testCases);
}

/**
 * Check if a language has native (non-fallback) support
 */
function hasNativeSupport(language) {
    const lang = language.toLowerCase().replace(/[^a-z0-9+#]/g, '');
    return lang in generators;
}

/**
 * Get list of all supported languages
 */
function getSupportedLanguages() {
    return Object.keys(generators);
}

module.exports = {
    getGenerator,
    generateTestRunner,
    hasNativeSupport,
    getSupportedLanguages,
    // Export individual generators for testing
    PythonGenerator,
    JavaScriptGenerator,
    JavaGenerator,
    CGenerator,
    CppGenerator,
    CSharpGenerator,
    GoGenerator,
    RubyGenerator,
    GenericGenerator
};
