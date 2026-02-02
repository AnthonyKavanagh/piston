const acorn = require('acorn');

/**
 * PASS-THROUGH MODE: Call expressions are passed unchanged to the language runtime.
 * NO conversion of Python tuples to arrays - that would corrupt type information.
 * The generators handle language-specific syntax natively using eval().
 */

/**
 * Parse a JavaScript-like call expression into structured data
 * e.g., "compute({a: 1, b: 2}, 5)" -> { function: "compute", args: [{a: 1, b: 2}, 5] }
 *
 * NOTE: This parser is primarily used for extracting function names and arguments
 * for languages that don't support direct eval (like C++, Java).
 * For Python/JavaScript, the call string is passed directly to eval().
 *
 * IMPORTANT: Python tuples are NOT converted to arrays. The raw call string
 * is preserved and passed to the language runtime for native evaluation.
 */
function parseCallExpression(callStr) {
    if (!callStr || typeof callStr !== 'string') {
        throw new Error('Call expression must be a non-empty string');
    }

    const trimmed = callStr.trim();

    // For pass-through mode, we also store the raw call string
    // This allows generators to use eval() directly with the original syntax
    let ast;
    try {
        // Try to parse as JavaScript (works for most C-style function calls)
        ast = acorn.parseExpressionAt(trimmed, 0, { ecmaVersion: 2020 });
    } catch (e) {
        // If parsing fails (e.g., Python-specific syntax), return a minimal result
        // The generator should use the raw call string instead
        return {
            raw: trimmed,
            function: null,
            args: [],
            parseError: `Failed to parse call expression: ${e.message}. Use raw call string for eval-based execution.`
        };
    }

    if (ast.type !== 'CallExpression') {
        return {
            raw: trimmed,
            function: null,
            args: [],
            parseError: `Expected a function call, got: ${ast.type}`
        };
    }

    // Handle both simple identifiers and member expressions (e.g., obj.method())
    let functionName;
    if (ast.callee.type === 'Identifier') {
        functionName = ast.callee.name;
    } else if (ast.callee.type === 'MemberExpression') {
        // For method calls like obj.method(), we need the full path
        functionName = extractMemberExpression(ast.callee);
    } else {
        return {
            raw: trimmed,
            function: null,
            args: [],
            parseError: `Unsupported callee type: ${ast.callee.type}`
        };
    }

    const args = [];
    for (const [index, arg] of ast.arguments.entries()) {
        try {
            args.push(evalASTNode(arg));
        } catch (e) {
            // If argument evaluation fails, return partial result with raw string
            return {
                raw: trimmed,
                function: functionName,
                args: args,
                parseError: `Failed to evaluate argument ${index}: ${e.message}`
            };
        }
    }

    return {
        raw: trimmed,
        function: functionName,
        args: args
    };
}

/**
 * Extract the full path of a member expression (e.g., "obj.method" or "a.b.c")
 */
function extractMemberExpression(node) {
    if (node.type === 'Identifier') {
        return node.name;
    }
    if (node.type === 'MemberExpression') {
        const object = extractMemberExpression(node.object);
        const property = node.computed
            ? `[${evalASTNode(node.property)}]`
            : `.${node.property.name}`;
        return object + property;
    }
    throw new Error(`Cannot extract member expression from: ${node.type}`);
}

/**
 * Evaluate an AST node to get its JavaScript value
 */
function evalASTNode(node) {
    if (!node) {
        return undefined;
    }

    switch (node.type) {
        case 'Literal':
            return node.value;

        case 'ArrayExpression':
            return node.elements.map(el => evalASTNode(el));

        case 'ObjectExpression':
            const obj = {};
            for (const prop of node.properties) {
                if (prop.type === 'SpreadElement') {
                    throw new Error('Spread elements are not supported');
                }

                let key;
                if (prop.key.type === 'Identifier') {
                    key = prop.key.name;
                } else if (prop.key.type === 'Literal') {
                    key = prop.key.value;
                } else {
                    throw new Error(`Unsupported property key type: ${prop.key.type}`);
                }

                obj[key] = evalASTNode(prop.value);
            }
            return obj;

        case 'UnaryExpression':
            const argument = evalASTNode(node.argument);
            switch (node.operator) {
                case '-':
                    return -argument;
                case '+':
                    return +argument;
                case '!':
                    return !argument;
                case '~':
                    return ~argument;
                default:
                    throw new Error(`Unsupported unary operator: ${node.operator}`);
            }

        case 'BinaryExpression':
            const left = evalASTNode(node.left);
            const right = evalASTNode(node.right);
            switch (node.operator) {
                case '+':
                    return left + right;
                case '-':
                    return left - right;
                case '*':
                    return left * right;
                case '/':
                    return left / right;
                case '%':
                    return left % right;
                case '**':
                    return left ** right;
                default:
                    throw new Error(`Unsupported binary operator: ${node.operator}`);
            }

        case 'Identifier':
            // Handle special identifiers
            switch (node.name) {
                case 'null':
                    return null;
                case 'undefined':
                    return undefined;
                case 'true':
                    return true;
                case 'false':
                    return false;
                case 'Infinity':
                    return Infinity;
                case 'NaN':
                    return NaN;
                default:
                    // For other identifiers, return them as a special marker
                    // This allows for variable references in some languages
                    throw new Error(`Unknown identifier: ${node.name}. Only literals are supported in test case arguments.`);
            }

        case 'TemplateLiteral':
            // Simple template literal support (no expressions)
            if (node.expressions.length > 0) {
                throw new Error('Template literals with expressions are not supported');
            }
            return node.quasis.map(q => q.value.cooked).join('');

        case 'ConditionalExpression':
            throw new Error('Conditional expressions (ternary) are not supported');

        case 'CallExpression':
            throw new Error('Nested function calls are not supported in arguments');

        default:
            throw new Error(`Unsupported AST node type: ${node.type}`);
    }
}

module.exports = {
    parseCallExpression,
    evalASTNode
};
