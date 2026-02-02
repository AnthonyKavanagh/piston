const express = require('express');
const router = express.Router();

const events = require('events');

const runtime = require('../runtime');
const { Job } = require('../job');
const package = require('../package');
const globals = require('../globals');
const config = require('../config');
const logger = require('logplease').create('api/v2');
const { generateTestRunner } = require('../generators');

function get_job(body) {
    let {
        language,
        version,
        args,
        stdin,
        files,
        compile_memory_limit,
        run_memory_limit,
        run_timeout,
        compile_timeout,
        run_cpu_time,
        compile_cpu_time,
    } = body;



    
    return new Promise((resolve, reject) => {
        if (!language || typeof language !== 'string') {
            return reject({
                message: 'language is required as a string',
            });
        }
        if (!version || typeof version !== 'string') {
            return reject({
                message: 'version is required as a string',
            });
        }
        if (!files || !Array.isArray(files)) {
            return reject({
                message: 'files is required as an array',
            });
        }
        for (const [i, file] of files.entries()) {
            if (typeof file.content !== 'string') {
                return reject({
                    message: `files[${i}].content is required as a string`,
                });
            }
        }

        const rt = runtime.get_latest_runtime_matching_language_version(
            language,
            version
        );
        if (rt === undefined) {
            return reject({
                message: `${language}-${version} runtime is unknown`,
            });
        }

        if (
            rt.language !== 'file' &&
            !files.some(file => !file.encoding || file.encoding === 'utf8')
        ) {
            return reject({
                message: 'files must include at least one utf8 encoded file',
            });
        }

        for (const constraint of ['memory_limit', 'timeout', 'cpu_time']) {
            for (const type of ['compile', 'run']) {
                const constraint_name = `${type}_${constraint}`;
                const constraint_value = body[constraint_name];
                const configured_limit = rt[`${constraint}s`][type];
                if (!constraint_value) {
                    continue;
                }
                if (typeof constraint_value !== 'number') {
                    return reject({
                        message: `If specified, ${constraint_name} must be a number`,
                    });
                }
                if (configured_limit <= 0) {
                    continue;
                }
                if (constraint_value > configured_limit) {
                    return reject({
                        message: `${constraint_name} cannot exceed the configured limit of ${configured_limit}`,
                    });
                }
                if (constraint_value < 0) {
                    return reject({
                        message: `${constraint_name} must be non-negative`,
                    });
                }
            }
        }

        resolve(
            new Job({
                runtime: rt,
                args: args ?? [],
                stdin: stdin ?? '',
                files,
                timeouts: {
                    run: run_timeout ?? rt.timeouts.run,
                    compile: compile_timeout ?? rt.timeouts.compile,
                },
                cpu_times: {
                    run: run_cpu_time ?? rt.cpu_times.run,
                    compile: compile_cpu_time ?? rt.cpu_times.compile,
                },
                memory_limits: {
                    run: run_memory_limit ?? rt.memory_limits.run,
                    compile: compile_memory_limit ?? rt.memory_limits.compile,
                },
            })
        );
    });
}

router.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    if (!req.headers['content-type']?.startsWith('application/json')) {
        return res.status(415).send({
            message: 'requests must be of type application/json',
        });
    }

    next();
});

router.ws('/connect', async (ws, req) => {
    let job = null;
    let event_bus = new events.EventEmitter();

    event_bus.on('stdout', data =>
        ws.send(
            JSON.stringify({
                type: 'data',
                stream: 'stdout',
                data: data.toString(),
            })
        )
    );
    event_bus.on('stderr', data =>
        ws.send(
            JSON.stringify({
                type: 'data',
                stream: 'stderr',
                data: data.toString(),
            })
        )
    );
    event_bus.on('stage', stage =>
        ws.send(JSON.stringify({ type: 'stage', stage }))
    );
    event_bus.on('exit', (stage, status) =>
        ws.send(JSON.stringify({ type: 'exit', stage, ...status }))
    );

    ws.on('message', async data => {
        try {
            const msg = JSON.parse(data);

            switch (msg.type) {
                case 'init':
                    if (job === null) {
                        job = await get_job(msg);

                        try {
                            const box = await job.prime();

                            ws.send(
                                JSON.stringify({
                                    type: 'runtime',
                                    language: job.runtime.language,
                                    version: job.runtime.version.raw,
                                })
                            );

                            await job.execute(box, event_bus);
                        } catch (error) {
                            logger.error(
                                `Error cleaning up job: ${job.uuid}:\n${error}`
                            );
                            throw error;
                        } finally {
                            await job.cleanup();
                        }
                        ws.close(4999, 'Job Completed'); // Will not execute if an error is thrown above
                    } else {
                        ws.close(4000, 'Already Initialized');
                    }
                    break;
                case 'data':
                    if (job !== null) {
                        if (msg.stream === 'stdin') {
                            event_bus.emit('stdin', msg.data);
                        } else {
                            ws.close(4004, 'Can only write to stdin');
                        }
                    } else {
                        ws.close(4003, 'Not yet initialized');
                    }
                    break;
                case 'signal':
                    if (job !== null) {
                        if (
                            Object.values(globals.SIGNALS).includes(msg.signal)
                        ) {
                            event_bus.emit('signal', msg.signal);
                        } else {
                            ws.close(4005, 'Invalid signal');
                        }
                    } else {
                        ws.close(4003, 'Not yet initialized');
                    }
                    break;
            }
        } catch (error) {
            ws.send(JSON.stringify({ type: 'error', message: error.message }));
            ws.close(4002, 'Notified Error');
            // ws.close message is limited to 123 characters, so we notify over WS then close.
        }
    });

    setTimeout(() => {
        //Terminate the socket after 1 second, if not initialized.
        if (job === null) ws.close(4001, 'Initialization Timeout');
    }, 1000);
});

router.post('/execute', async (req, res) => {
    let job;
    try {
        job = await get_job(req.body);
    } catch (error) {
        return res.status(400).json(error);
    }
    try {
        const box = await job.prime();

        let result = await job.execute(box);
        // Backward compatibility when the run stage is not started
        if (result.run === undefined) {
            result.run = result.compile;
        }

        return res.status(200).send(result);
    } catch (error) {
        logger.error(`Error executing job: ${job.uuid}:\n${error}`);
        return res.status(500).send();
    } finally {
        try {
            await job.cleanup(); // This gets executed before the returns in try/catch
        } catch (error) {
            logger.error(`Error cleaning up job: ${job.uuid}:\n${error}`);
            return res.status(500).send(); // On error, this replaces the return in the outer try-catch
        }
    }
});

/**
 * Try to extract JSON array from output that may contain extra content
 * This handles cases where user code outputs content before/after the JSON results
 */
function extractJsonArray(output) {
    // First try direct parsing
    try {
        const parsed = JSON.parse(output);
        if (Array.isArray(parsed)) {
            return parsed;
        }
    } catch (e) {
        // Continue to extraction logic
    }

    // Try to find JSON array in the output
    // Look for the pattern [{ ... }]
    const jsonArrayMatch = output.match(/\[[\s\S]*\]/);
    if (jsonArrayMatch) {
        try {
            const parsed = JSON.parse(jsonArrayMatch[0]);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        } catch (e) {
            // Failed to parse extracted content
        }
    }

    // If nothing works, return null
    return null;
}

/**
 * Validate test cases for the testCompile endpoint
 * Note: call expressions are passed directly to the language runtime (pass-through mode)
 * This supports language-specific features like Python lambdas, list comprehensions, etc.
 */
function validate_test_cases(test_cases) {
    if (!test_cases || !Array.isArray(test_cases)) {
        throw { message: 'test_cases is required as an array' };
    }

    if (test_cases.length === 0) {
        throw { message: 'test_cases must be a non-empty array' };
    }

    if (config.max_test_cases > 0 && test_cases.length > config.max_test_cases) {
        throw {
            message: `test_cases cannot exceed ${config.max_test_cases} items`,
        };
    }

    for (const [i, tc] of test_cases.entries()) {
        if (typeof tc.call !== 'string') {
            throw { message: `test_cases[${i}].call must be a string` };
        }

        if (tc.call.trim() === '') {
            throw { message: `test_cases[${i}].call cannot be empty` };
        }

        if (!('expected' in tc)) {
            throw { message: `test_cases[${i}].expected is required` };
        }

        // No parsing here - call expressions are passed directly to the language runtime
        // This allows language-specific syntax like Python lambdas, f-strings, etc.
    }

    return test_cases;
}

/**
 * POST /api/v2/testCompile
 *
 * Run code against multiple test cases and return results
 *
 * Request body:
 * {
 *   language: string,
 *   version: string,
 *   files: [{name: string, content: string}],
 *   test_cases: [{call: string, expected: any}],
 *   run_timeout?: number,
 *   run_memory_limit?: number,
 *   compile_timeout?: number,
 *   compile_memory_limit?: number
 * }
 *
 * Response:
 * {
 *   language: string,
 *   version: string,
 *   compile: object | null,
 *   test_results: [{index, call, expected, actual, passed, error, execution}],
 *   summary: {total, passed, failed},
 *   full_output: {stdout, stderr}
 * }
 */
router.post('/testCompile', async (req, res) => {
    let job;
    let testCases;
    let runnerResult;

    try {
        // Validate test cases
        testCases = validate_test_cases(req.body.test_cases);

        // Generate test runner files for the language
        // Pass-through mode: call expressions are passed directly to the language runtime
        runnerResult = generateTestRunner(
            req.body.language,
            req.body.files,
            testCases
        );

        // Create job with runner files
        job = await get_job({
            ...req.body,
            files: runnerResult.files,
            stdin: runnerResult.stdin || ''
        });
    } catch (error) {
        return res.status(400).json(error);
    }

    try {
        const box = await job.prime();
        const execResult = await job.execute(box);

        // Handle compilation failure
        if (execResult.compile && execResult.compile.code !== 0) {
            return res.status(200).send({
                language: job.runtime.language,
                version: job.runtime.version.raw,
                compile: execResult.compile,
                test_results: [],
                summary: {
                    total: testCases.length,
                    passed: 0,
                    failed: 0,
                    error: 'compilation_failed',
                },
                full_output: {
                    stdout: execResult.compile.stdout || '',
                    stderr: execResult.compile.stderr || '',
                },
            });
        }

        // Parse test results from stdout
        let testResults = [];
        let parseError = null;

        // Check if this is a fallback mode (unsupported language)
        if (runnerResult.mode === 'fallback') {
            // For fallback mode, return a single result based on execution
            testResults = testCases.map((tc, i) => ({
                index: i,
                call: tc.call,
                expected: tc.expected,
                actual: null,
                passed: false,
                error: `Language '${req.body.language}' requires fallback mode. Please check the output manually.`,
                execution: {
                    stdout: execResult.run?.stdout || '',
                    stderr: execResult.run?.stderr || '',
                    code: execResult.run?.code,
                    signal: execResult.run?.signal,
                    memory: execResult.run?.memory,
                    cpu_time: execResult.run?.cpu_time,
                    wall_time: execResult.run?.wall_time,
                },
            }));
        } else {
            try {
                const stdout = execResult.run?.stdout || '';
                const trimmedOutput = stdout.trim();

                if (!trimmedOutput) {
                    throw new Error('Empty output from test runner');
                }

                // Try to extract JSON array from output (handles extra content from user code)
                const output = extractJsonArray(trimmedOutput);

                if (!output) {
                    throw new Error('Could not find valid JSON array in test runner output');
                }

                testResults = output.map((r, i) => ({
                    index: r.index ?? i,
                    call: testCases[i]?.call || '',
                    // Use parsed expected (expected_serialized) from runner, not raw input
                    // This shows what the backend actually compared against
                    expected: r.expected_serialized ?? testCases[i]?.expected,
                    actual: r.actual,
                    passed: r.passed === true,
                    error: r.error || null,
                    execution: {
                        code: execResult.run?.code,
                        signal: execResult.run?.signal,
                        memory: execResult.run?.memory,
                        cpu_time: execResult.run?.cpu_time,
                        wall_time: execResult.run?.wall_time,
                    },
                }));
            } catch (e) {
                parseError = `Output parse error: ${e.message}`;
                logger.warn(`Failed to parse test results: ${e.message}`);
                logger.debug(`Raw output: ${execResult.run?.stdout}`);

                // If parsing fails, all tests are considered failed
                testResults = testCases.map((tc, i) => ({
                    index: i,
                    call: tc.call,
                    expected: tc.expected,
                    actual: null,
                    passed: false,
                    error: parseError,
                    execution: {
                        stdout: execResult.run?.stdout || '',
                        stderr: execResult.run?.stderr || '',
                        code: execResult.run?.code,
                        signal: execResult.run?.signal,
                    },
                }));
            }
        }

        const passedCount = testResults.filter(r => r.passed).length;

        return res.status(200).send({
            language: job.runtime.language,
            version: job.runtime.version.raw,
            compile: execResult.compile || null,
            test_results: testResults,
            summary: {
                total: testCases.length,
                passed: passedCount,
                failed: testCases.length - passedCount,
            },
            full_output: {
                stdout: execResult.run?.stdout || '',
                stderr: execResult.run?.stderr || '',
            },
        });
    } catch (error) {
        logger.error(`Error executing test job: ${job?.uuid}:\n${error}`);
        return res.status(500).send({
            message: 'Internal server error during test execution',
        });
    } finally {
        try {
            if (job) {
                await job.cleanup();
            }
        } catch (error) {
            logger.error(`Error cleaning up test job: ${job?.uuid}:\n${error}`);
        }
    }
});

router.get('/runtimes', (req, res) => {
    const runtimes = runtime.map(rt => {
        return {
            language: rt.language,
            version: rt.version.raw,
            aliases: rt.aliases,
            runtime: rt.runtime,
        };
    });

    return res.status(200).send(runtimes);
});

router.get('/packages', async (req, res) => {
    logger.debug('Request to list packages');
    let packages = await package.get_package_list();

    packages = packages.map(pkg => {
        return {
            language: pkg.language,
            language_version: pkg.version.raw,
            installed: pkg.installed,
        };
    });

    return res.status(200).send(packages);
});

router.post('/packages', async (req, res) => {
    logger.debug('Request to install package');

    const { language, version } = req.body;

    const pkg = await package.get_package(language, version);

    if (pkg == null) {
        return res.status(404).send({
            message: `Requested package ${language}-${version} does not exist`,
        });
    }

    try {
        const response = await pkg.install();

        return res.status(200).send(response);
    } catch (e) {
        logger.error(
            `Error while installing package ${pkg.language}-${pkg.version}:`,
            e.message
        );

        return res.status(500).send({
            message: e.message,
        });
    }
});

router.delete('/packages', async (req, res) => {
    logger.debug('Request to uninstall package');

    const { language, version } = req.body;

    const pkg = await package.get_package(language, version);

    if (pkg == null) {
        return res.status(404).send({
            message: `Requested package ${language}-${version} does not exist`,
        });
    }

    try {
        const response = await pkg.uninstall();

        return res.status(200).send(response);
    } catch (e) {
        logger.error(
            `Error while uninstalling package ${pkg.language}-${pkg.version}:`,
            e.message
        );

        return res.status(500).send({
            message: e.message,
        });
    }
});

module.exports = router;
