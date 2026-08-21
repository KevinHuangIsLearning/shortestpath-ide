import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
    Problem,
    WebviewToVSEvent,
    TestCase,
    Case,
    VSToWebViewMessage,
    ResultCommand,
    RunningCommand,
    CheckingCommand,
    StressFailureCommand,
    StressFinishedCommand,
    StressProgressCommand,
    StressStatusCommand,
    StressFileSelectedCommand,
    LargeSampleDirectorySelectedCommand,
    LargeSampleCheckerSelectedCommand,
    LargeSampleScanResultCommand,
    LargeSampleStatusCommand,
    LargeSampleFailureCommand,
    LargeSampleFinishedCommand,
    LargeSampleCaseResultCommand,
    LargeSampleComparisonOptions,
    LargeSampleRunMode,
    LargeSampleAnswerMode,
    WebViewpersistenceState,
} from '../../types';
import CaseView, { LargeSampleCaseState } from './CaseView';
import Page from './Page';
import { ImportCases } from './ImportCases';
import { CatCompanion } from './CatCompanion';

let storedLogs = '';
let notificationTimeout: NodeJS.Timeout | undefined = undefined;

const originalConsole = { ...window.console };
function customLogger(
    originalMethod: (...args: any[]) => void,
    ...args: any[]
) {
    originalMethod(...args);

    storedLogs += new Date().toISOString() + ' ';
    storedLogs +=
        args
            .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : arg))
            .join(' ') + '\n';
}

declare const vscodeApi: {
    postMessage: (message: WebviewToVSEvent) => void;
    getState: () => WebViewpersistenceState | undefined;
    setState: (state: WebViewpersistenceState) => void;
};

interface CustomWindow extends Window {
    generatedJsonUri: string;
    remoteMessage: string | null;
    remoteServerAddress: string;
    showLiveUserCount: boolean;
    console: Console;
    translations: Record<string, string>;
    locale: string;
    pythonCommand: string;
}
declare const window: CustomWindow;

const t = (key: string): string => {
    return window.translations[key] || key;
};

const truncateStressText = (text: string): string => {
    if (text.length <= 100000) {
        return text;
    }
    return `[Truncated]\n${text.slice(0, 100000)}`;
};

window.console.log = customLogger.bind(window.console, originalConsole.log);
window.console.error = customLogger.bind(window.console, originalConsole.error);
window.console.warn = customLogger.bind(window.console, originalConsole.warn);
window.console.info = customLogger.bind(window.console, originalConsole.info);
window.console.debug = customLogger.bind(window.console, originalConsole.debug);

const projectUrl =
    'https://github.com/KevinHuangIsLearning/competitive-programming-helper-plus';
const userGuidePath = (window.locale || 'en').toLowerCase().startsWith('zh')
    ? 'docs/user-guide_cn.md'
    : 'docs/user-guide.md';

function getLiveUserCount(): Promise<number> {
    console.log('Fetching live user count');
    return fetch(window.remoteServerAddress)
        .then((res) => res.text())
        .then((text) => {
            const userCount = Number(text);
            if (isNaN(userCount)) {
                console.error('Invalid live user count', text);
                return 0;
            } else {
                return userCount;
            }
        })
        .catch((err) => {
            console.error('Failed to fetch live users', err);
            return 0;
        });
}

function Judge(props: {
    problem: Problem;
    updateProblem: (problem: Problem) => void;
    cases: Case[];
    updateCases: React.Dispatch<React.SetStateAction<Case[]>>;
    onlineJudgeEnv: boolean;
    setOnlineJudgeEnv: (value: boolean) => void;
}) {
    const problem = props.problem;
    const cases = props.cases;
    const updateProblem = props.updateProblem;
    const updateCases = props.updateCases;
    const onlineJudgeEnv = props.onlineJudgeEnv;
    const setOnlineJudgeEnv = props.setOnlineJudgeEnv;

    const casesRef = React.useRef(cases);
    useEffect(() => {
        casesRef.current = cases;
    }, [cases]);

    const problemUrlRef = React.useRef(problem.url);
    useEffect(() => {
        problemUrlRef.current = problem.url;
    }, [problem.url]);

    const [focusLast, setFocusLast] = useState<boolean>(false);
    const [forceRunning, setForceRunning] = useState<number | false>(false);
    const [forceChecking, setForceChecking] = useState<number | false>(false);
    const [compiling, setCompiling] = useState<boolean>(false);
    const [notification, setNotification] = useState<string | null>(null);
    const [waitingForSubmit, setWaitingForSubmit] = useState<boolean>(false);
    const [showCfBrowserHint, setShowCfBrowserHint] = useState<boolean>(false);
    const submitBrowserHintTimeout = React.useRef<ReturnType<
        typeof setTimeout
    > | null>(null);
    const [infoPageVisible, setInfoPageVisible] = useState<boolean>(false);
    const [generatedJson, setGeneratedJson] = useState<any | null>(null);
    const [liveUserCount, setLiveUserCount] = useState<number>(0);
    const [extLogs, setExtLogs] = useState<string>('');
    const [stressGeneratorPath, setStressGeneratorPath] = useState('');
    const [stressStdPath, setStressStdPath] = useState('');
    const [stressIterations, setStressIterations] = useState(1000);
    const [stressRunning, setStressRunning] = useState(false);
    const [stressProgress, setStressProgress] = useState({
        iteration: 0,
        total: 1000,
    });
    const [stressMessage, setStressMessage] = useState<string | null>(null);
    const [pendingStressFailure, setPendingStressFailure] =
        useState<StressFailureCommand | null>(null);
    const [stressDialogVisible, setStressDialogVisible] = useState(false);
    const stressRunIdRef = React.useRef<number | null>(null);
    const [largeSampleDirectory, setLargeSampleDirectory] = useState(
        problem.largeSampleDirectory || '',
    );
    const [largeSampleCheckerPath, setLargeSampleCheckerPath] = useState(
        problem.largeSampleCheckerPath || '',
    );
    const [largeSampleCheckerEnabled, setLargeSampleCheckerEnabled] = useState(
        problem.largeSampleCheckerEnabled ?? false,
    );
    const [largeSampleEnabled, setLargeSampleEnabled] = useState(
        problem.largeSampleEnabled !== false,
    );
    const [largeSampleAnswerMode, setLargeSampleAnswerMode] =
        useState<LargeSampleAnswerMode>(
            problem.largeSampleAnswerMode || 'auto',
        );
    const [largeSampleRunMode, setLargeSampleRunMode] =
        useState<LargeSampleRunMode>(
            problem.largeSampleRunMode || 'stop-on-failure',
        );
    const [largeSampleComparison, setLargeSampleComparison] =
        useState<LargeSampleComparisonOptions>(
            problem.largeSampleComparison || {
                ignoreTrailingWhitespace: true,
                ignoreBlankLines: false,
                ignoreOuterWhitespace: true,
                tokenCompare: false,
            },
        );
    const [largeSampleCases, setLargeSampleCases] = useState<
        LargeSampleScanResultCommand['cases']
    >([]);
    const [largeSampleDiagnostics, setLargeSampleDiagnostics] = useState<
        LargeSampleScanResultCommand['diagnostics']
    >([]);
    const [largeSampleRunning, setLargeSampleRunning] = useState(false);
    const [largeSampleRunId, setLargeSampleRunId] = useState<number | null>(
        null,
    );
    const largeSampleRunIdRef = React.useRef<number | null>(null);
    const [largeSampleStatus, setLargeSampleStatus] = useState('');
    const [largeSampleProgress, setLargeSampleProgress] = useState({
        index: 0,
        total: 0,
    });
    const [largeSampleCaseResults, setLargeSampleCaseResults] = useState<
        Record<
            string,
            {
                state: LargeSampleCaseState;
                outputPath?: string;
                reason?: string;
                time?: number;
                execution?: LargeSampleCaseResultCommand['execution'];
            }
        >
    >({});
    const largeSampleCasesRef = React.useRef<
        LargeSampleScanResultCommand['cases']
    >([]);
    const largeSampleSkippedCases = problem.largeSampleSkippedCases || [];

    const [checkerVisible, setCheckerVisible] = useState<boolean>(
        !!problem.customCheckerPath,
    );
    const [moreToolsVisible, setMoreToolsVisible] = useState<boolean>(false);
    const [deleteProblemArmed, setDeleteProblemArmed] =
        useState<boolean>(false);
    const deleteProblemArmedTimer = React.useRef<ReturnType<
        typeof setTimeout
    > | null>(null);
    const [submitShortestPathArmed, setSubmitShortestPathArmed] =
        useState<boolean>(false);
    const submitShortestPathArmedTimer = React.useRef<ReturnType<
        typeof setTimeout
    > | null>(null);
    const checkerInputRef = React.useRef<HTMLInputElement>(null);

    const ordinaryPassed = cases.filter(
        (testCase) => testCase.result?.pass === true,
    ).length;
    const evaluatedLargeSampleCases = largeSampleEnabled
        ? largeSampleCases.filter(
              (testCase) =>
                  !largeSampleSkippedCases.includes(testCase.name),
          )
        : [];
    const largeSamplePassed = evaluatedLargeSampleCases.filter(
        (testCase) =>
            largeSampleCaseResults[testCase.name]?.state === 'passed',
    ).length;
    const numPassed = ordinaryPassed + largeSamplePassed;
    const total = cases.length + evaluatedLargeSampleCases.length;

    useEffect(() => {
        if (infoPageVisible || stressDialogVisible) {
            document.body.classList.add('no-scroll');
        } else {
            document.body.classList.remove('no-scroll');
        }
    }, [infoPageVisible, stressDialogVisible]);

    useEffect(() => {
        if (stressRunIdRef.current !== null) {
            sendMessageToVSCode({
                command: 'stress-stop',
                runId: stressRunIdRef.current,
            });
            stressRunIdRef.current = null;
        }
        if (largeSampleRunIdRef.current !== null) {
            sendMessageToVSCode({
                command: 'large-sample-stop',
                runId: largeSampleRunIdRef.current,
            });
        }
        setDeleteProblemArmed(false);
        if (deleteProblemArmedTimer.current) {
            clearTimeout(deleteProblemArmedTimer.current);
            deleteProblemArmedTimer.current = null;
        }
        setSubmitShortestPathArmed(false);
        setStressGeneratorPath('');
        setStressStdPath('');
        setStressRunning(false);
        setStressMessage(null);
        setPendingStressFailure(null);
        setStressDialogVisible(false);
        setLargeSampleRunning(false);
        setLargeSampleRunId(null);
        largeSampleRunIdRef.current = null;
        if (submitShortestPathArmedTimer.current) {
            clearTimeout(submitShortestPathArmedTimer.current);
            submitShortestPathArmedTimer.current = null;
        }
    }, [problem.srcPath]);

    useEffect(() => {
        return () => {
            if (submitBrowserHintTimeout.current) {
                clearTimeout(submitBrowserHintTimeout.current);
            }
            if (submitShortestPathArmedTimer.current) {
                clearTimeout(submitShortestPathArmedTimer.current);
            }
            if (deleteProblemArmedTimer.current) {
                clearTimeout(deleteProblemArmedTimer.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!showCfBrowserHint) {
            return;
        }

        const timeout = window.setTimeout(
            () => setShowCfBrowserHint(false),
            10000,
        );
        return () => window.clearTimeout(timeout);
    }, [showCfBrowserHint]);

    useEffect(() => {
        const updateLiveUserCount = (): void => {
            getLiveUserCount().then((count) => setLiveUserCount(count));
        };
        updateLiveUserCount();
        const interval = setInterval(updateLiveUserCount, 30000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        fetch(window.generatedJsonUri)
            .then((res) => res.json())
            .then((data) => setGeneratedJson(data))
            .catch((err) =>
                console.error('Failed to fetch generated JSON', err),
            );
    }, []);

    const [webviewState, setWebviewState] = useState<WebViewpersistenceState>(
        () => {
            const vscodeState = vscodeApi.getState();
            const currentLoads = (vscodeState?.totalLoads || 0) + 1;
            const ret = {
                dialogCloseDate: vscodeState?.dialogCloseDate || Date.now(),
                feedbackDialogCloseDate:
                    vscodeState?.feedbackDialogCloseDate || Date.now(),
                hasSeenFeedbackTooltip:
                    vscodeState?.hasSeenFeedbackTooltip || false,
                catCompanionEnabled: vscodeState?.catCompanionEnabled || false,
                totalLoads: currentLoads,
                hasSeenCompanionTooltip:
                    vscodeState?.hasSeenCompanionTooltip || false,
                rateDialogCloseDate:
                    vscodeState?.rateDialogCloseDate || Date.now(),
            };
            vscodeApi.setState(ret);
            console.log('Restored to state:', ret);
            return ret;
        },
    );

    const [importPageVisible, setImportPageVisible] = useState(false);
    const [editableStateText, setEditableStateText] = useState(
        JSON.stringify(webviewState, null, 2),
    );
    const [showCompanionTooltip, setShowCompanionTooltip] = useState(
        (webviewState.totalLoads || 0) >= 10 &&
            !webviewState.hasSeenCompanionTooltip &&
            !webviewState.catCompanionEnabled,
    );

    const updateWebviewState = (newState: WebViewpersistenceState) => {
        setWebviewState(newState);
        vscodeApi.setState(newState);
    };

    // Update problem if cases change. The only place where `updateProblem` is
    // allowed to ensure sync.
    useEffect(() => {
        const testCases: TestCase[] = cases.map((c) => c.testcase);
        updateProblem({
            ...problem,
            tests: testCases,
        });
    }, [cases]);

    const sendMessageToVSCode = (message: WebviewToVSEvent) => {
        vscodeApi.postMessage(message);
    };

    useEffect(() => {
        sendMessageToVSCode({ command: 'get-initial-problem' });
    }, []);

    useEffect(() => {
        const handleContextMenu = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target) {
                const tagName = target.tagName;
                if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
                    return;
                }
                if (
                    typeof target.closest === 'function' &&
                    target.closest('.chevron-btn')
                ) {
                    return;
                }
            }
            e.preventDefault();
        };

        document.addEventListener('contextmenu', handleContextMenu);
        return () => {
            document.removeEventListener('contextmenu', handleContextMenu);
        };
    }, []);

    useEffect(() => {
        const fn = (event: any) => {
            const data: VSToWebViewMessage = event.data;
            switch (data.command) {
                case 'remote-message': {
                    window.remoteMessage = data.message;
                    break;
                }

                case 'running': {
                    handleRunning(data);
                    break;
                }
                case 'checking': {
                    handleChecking(data);
                    break;
                }
                case 'stress-file-selected': {
                    const selected = data as StressFileSelectedCommand;
                    if (selected.role === 'std') {
                        setStressStdPath(selected.path);
                    } else {
                        setStressGeneratorPath(selected.path);
                    }
                    break;
                }
                case 'stress-status': {
                    const status = data as StressStatusCommand;
                    if (status.runId !== stressRunIdRef.current) {
                        break;
                    }
                    if (status.phase === 'compiling') {
                        const role =
                            status.role === 'generator'
                                ? t('stressGenerator')
                                : status.role === 'std'
                                  ? t('stressStd')
                                  : t('stressTarget');
                        setStressMessage(`${t('stressCompiling')} ${role}...`);
                    } else {
                        const role =
                            status.role === 'generator'
                                ? t('stressGenerator')
                                : status.role === 'std'
                                  ? t('stressStd')
                                  : t('stressTarget');
                        setStressMessage(
                            `${t('stressRunning')} ${role} ${status.iteration || 0} / ${status.total || stressProgress.total}`,
                        );
                    }
                    break;
                }
                case 'large-sample-directory-selected': {
                    const selected = data as LargeSampleDirectorySelectedCommand;
                    setLargeSampleDirectory(selected.path);
                    updateLargeSampleConfig({
                        largeSampleDirectory: selected.path,
                    });
                    scanLargeSamples(selected.path);
                    break;
                }
                case 'large-sample-checker-selected': {
                    const selected = data as LargeSampleCheckerSelectedCommand;
                    setLargeSampleCheckerPath(selected.path);
                    updateLargeSampleConfig({
                        largeSampleCheckerPath: selected.path,
                    });
                    break;
                }
                case 'large-sample-scan-result': {
                    const result = data as LargeSampleScanResultCommand;
                    largeSampleCasesRef.current = result.cases;
                    setLargeSampleCases(result.cases);
                    setLargeSampleDiagnostics(result.diagnostics);
                    setLargeSampleCaseResults({});
                    setLargeSampleStatus(
                        `${result.cases.length} ${t('largeSampleCasesFound')}`,
                    );
                    break;
                }
                case 'large-sample-case-result': {
                    const result = data as LargeSampleCaseResultCommand;
                    if (result.runId !== largeSampleRunIdRef.current) break;
                    setLargeSampleCaseResults((previous) => ({
                        ...previous,
                        [result.testcase.name]: {
                            state: result.state,
                            outputPath: result.outputPath,
                            reason: result.reason,
                            time: result.time,
                            execution: result.execution,
                        },
                    }));
                    break;
                }
                case 'large-sample-run-started': {
                    const started = data as { runId: number };
                    largeSampleRunIdRef.current = started.runId;
                    setLargeSampleRunId(started.runId);
                    setLargeSampleRunning(true);
                    setLargeSampleCaseResults(
                        Object.fromEntries(
                            largeSampleCasesRef.current.map((testcase) => [
                                testcase.name,
                                { state: 'pending' as const },
                            ]),
                        ),
                    );
                    setLargeSampleProgress({
                        index: 0,
                        total: largeSampleCasesRef.current.length,
                    });
                    setLargeSampleStatus(t('largeSamplePreparing'));
                    break;
                }
                case 'large-sample-status': {
                    const status = data as LargeSampleStatusCommand;
                    if (status.runId !== largeSampleRunIdRef.current) break;
                    setLargeSampleProgress({
                        index: status.index,
                        total: status.total,
                    });
                    if (status.phase === 'running' && status.name) {
                        setLargeSampleCaseResults((previous) => ({
                            ...previous,
                            [status.name!]: { state: 'running' },
                        }));
                    }
                    setLargeSampleStatus(
                        status.phase === 'compiling'
                            ? t('largeSampleCompiling')
                            : status.phase === 'checking'
                              ? `${t('largeSampleChecking')} ${status.name || ''}`
                              : `${t('largeSampleRunning')} ${status.index} / ${status.total} ${status.name || ''}`,
                    );
                    break;
                }
                case 'large-sample-failure': {
                    const failure = data as LargeSampleFailureCommand;
                    if (failure.runId !== largeSampleRunIdRef.current) break;
                    setLargeSampleStatus(
                        `${t('largeSampleFailed')} ${failure.testcase.name}`,
                    );
                    break;
                }
                case 'large-sample-finished': {
                    const finished = data as LargeSampleFinishedCommand;
                    if (finished.runId !== largeSampleRunIdRef.current) break;
                    setLargeSampleRunning(false);
                    setLargeSampleStatus(
                        finished.message ||
                            `${t(`largeSampleState_${finished.state}`)}: ${finished.passed}/${finished.passed + finished.failed + finished.skipped}`,
                    );
                    setLargeSampleRunId(null);
                    largeSampleRunIdRef.current = null;
                    break;
                }
                case 'stress-progress': {
                    const progress = data as StressProgressCommand;
                    if (progress.runId !== stressRunIdRef.current) {
                        break;
                    }
                    setStressRunning(true);
                    setStressProgress({
                        iteration: progress.iteration,
                        total: progress.total,
                    });
                    setStressMessage(
                        `${t('stressRunning')} ${progress.iteration} / ${progress.total}`,
                    );
                    break;
                }
                case 'stress-failure': {
                    const failure = data as StressFailureCommand;
                    if (failure.runId !== stressRunIdRef.current) {
                        break;
                    }
                    setStressRunning(false);
                    setPendingStressFailure(failure);
                    setStressMessage(t('stressFound'));
                    break;
                }
                case 'stress-finished': {
                    const finished = data as StressFinishedCommand;
                    if (finished.runId !== stressRunIdRef.current) {
                        break;
                    }
                    setStressRunning(false);
                    stressRunIdRef.current = null;
                    setStressMessage(
                        finished.message ||
                            (finished.state === 'passed'
                                ? `${t('stressPassed')} ${finished.iteration}`
                                : finished.state === 'found'
                                  ? t('stressFound')
                                  : finished.state === 'stopped'
                                    ? t('stressStopped')
                                    : t('stressFailed')),
                    );
                    break;
                }
                case 'compiling-start': {
                    setCompiling(true);
                    break;
                }
                case 'compiling-stop': {
                    setCompiling(false);
                    break;
                }
                case 'submit-finished': {
                    setWaitingForSubmit(false);
                    if (problemUrlRef.current.includes('codeforces.com')) {
                        if (submitBrowserHintTimeout.current) {
                            clearTimeout(submitBrowserHintTimeout.current);
                        }
                        setShowCfBrowserHint(true);
                        submitBrowserHintTimeout.current = setTimeout(() => {
                            setShowCfBrowserHint(false);
                            submitBrowserHintTimeout.current = null;
                        }, 10000);
                    }
                    break;
                }
                case 'waiting-for-submit': {
                    setWaitingForSubmit(true);
                    if (submitBrowserHintTimeout.current) {
                        clearTimeout(submitBrowserHintTimeout.current);
                        submitBrowserHintTimeout.current = null;
                    }
                    setShowCfBrowserHint(false);
                    break;
                }
                case 'ext-logs': {
                    setExtLogs(data.logs);
                    break;
                }
            }
        };
        window.addEventListener('message', fn);
        return () => {
            window.removeEventListener('message', fn);
        };
    }, []);

    const handleRunning = (data: RunningCommand) => {
        setForceRunning(data.id);
        updateCases((prevCases) => {
            const idx = prevCases.findIndex((c) => c.id === data.id);
            if (idx === -1) return prevCases;
            const newCases = prevCases.slice();
            newCases[idx] = {
                ...newCases[idx],
                result: null,
            };
            return newCases;
        });
    };

    const handleChecking = (data: CheckingCommand) => {
        setForceChecking(data.id);
        updateCases((prevCases) => {
            const idx = prevCases.findIndex((c) => c.id === data.id);
            if (idx === -1) return prevCases;
            const newCases = prevCases.slice();
            newCases[idx] = {
                ...newCases[idx],
                result: null,
            };
            return newCases;
        });
    };

    const refreshOnlineJudge = () => {
        let sendEnv = 'false';
        if (onlineJudgeEnv) sendEnv = 'true';
        sendMessageToVSCode({
            command: 'online-judge-env',
            value: sendEnv,
        });
    };

    const rerun = (id: number, input: string, output: string) => {
        refreshOnlineJudge();
        const idx = problem.tests.findIndex((testCase) => testCase.id === id);

        if (idx === -1) {
            console.log('No id in problem tests', problem, id);
            return;
        }

        problem.tests[idx].input = input;
        problem.tests[idx].output = output;

        sendMessageToVSCode({
            command: 'run-single-and-save',
            problem,
            id,
        });
    };

    // Remove a case.
    const remove = (id: number) => {
        const newCases = cases.filter((value) => value.id !== id);
        updateCases(newCases);
    };

    // Create a new Case
    const newCase = () => {
        const id = Date.now();
        const testCase: TestCase = {
            id,
            input: '',
            output: '',
        };
        updateCases([
            ...cases,
            {
                id,
                result: null,
                testcase: testCase,
            },
        ]);
        setFocusLast(true);
    };

    // Stop running executions.
    const stop = () => {
        notify(t('stoppedProcesses'));
        sendMessageToVSCode({
            command: 'kill-running',
            problem,
        });
    };

    // Deletes the .prob file and closes webview
    const deleteTcs = () => {
        if (!deleteProblemArmed) {
            setDeleteProblemArmed(true);
            if (deleteProblemArmedTimer.current) {
                clearTimeout(deleteProblemArmedTimer.current);
            }
            deleteProblemArmedTimer.current = setTimeout(() => {
                setDeleteProblemArmed(false);
                deleteProblemArmedTimer.current = null;
            }, 3000);
            return;
        }
        if (deleteProblemArmedTimer.current) {
            clearTimeout(deleteProblemArmedTimer.current);
            deleteProblemArmedTimer.current = null;
        }
        sendMessageToVSCode({
            command: 'delete-tcs',
            problem,
        });
    };

    const runAll = () => {
        refreshOnlineJudge();
        const largeSampleRunId =
            largeSampleEnabled && largeSampleDirectory ? Date.now() : undefined;
        if (largeSampleRunId) {
            setLargeSampleRunId(largeSampleRunId);
            largeSampleRunIdRef.current = largeSampleRunId;
        }
        sendMessageToVSCode({
            command: 'run-all-and-save',
            problem: {
                ...problem,
                largeSampleDirectory,
                largeSampleComparison,
                largeSampleRunMode,
                largeSampleAnswerMode,
                largeSampleCheckerEnabled,
                largeSampleCheckerPath,
                largeSampleEnabled,
            },
            largeSampleRunId,
        });
    };

    const pickStressFile = (role: 'generator' | 'std') => {
        sendMessageToVSCode({
            command: 'pick-stress-file',
            role,
        });
    };

    const scanLargeSamples = (
        directory: string,
        answerMode: LargeSampleAnswerMode = largeSampleAnswerMode,
    ) => {
        if (!directory.trim()) return;
        sendMessageToVSCode({
            command: 'scan-large-sample',
            directory: directory.trim(),
            answerMode,
        });
    };

    const updateLargeSampleConfig = (
        values: Partial<Problem>,
    ) => {
        updateProblem({ ...problem, ...values });
    };

    const pickLargeSampleDirectory = () => {
        sendMessageToVSCode({ command: 'pick-large-sample-directory' });
    };

    const pickLargeSampleChecker = () => {
        sendMessageToVSCode({ command: 'pick-large-sample-checker' });
    };

    const handleLargeSampleDrop = (
        event: React.DragEvent<HTMLDivElement>,
    ) => {
        event.preventDefault();
        const uriList = event.dataTransfer.getData('text/uri-list');
        const text = event.dataTransfer.getData('text/plain');
        const droppedPath = (
            event.dataTransfer.files[0] as (File & { path?: string }) | undefined
        )?.path;
        const droppedUri = uriList
            .split(/\r?\n/)
            .map((value) => value.trim())
            .find((value) => value && !value.startsWith('#'));
        const pathOrUri = droppedPath || droppedUri || text.trim();
        if (pathOrUri) {
            sendMessageToVSCode({
                command: 'import-large-sample-directory',
                pathOrUri,
            });
        } else {
            notify(t('largeSampleDropDirectory'));
        }
    };

    const openLargeSampleFile = (filePath: string) => {
        sendMessageToVSCode({ command: 'open-large-sample-file', path: filePath });
    };

    const runLargeSample = (testcaseName: string) => {
        if (!largeSampleDirectory || largeSampleRunning) return;
        const runId = Date.now();
        setLargeSampleRunId(runId);
        largeSampleRunIdRef.current = runId;
        setLargeSampleRunning(true);
        setLargeSampleCaseResults((previous) => ({
            ...previous,
            [testcaseName]: { state: 'running' },
        }));
        setLargeSampleProgress({ index: 0, total: 1 });
        setLargeSampleStatus(t('largeSamplePreparing'));
        sendMessageToVSCode({
            command: 'large-sample-run-single',
            runId,
            problem: {
                ...problem,
                largeSampleSkippedCases: largeSampleSkippedCases.filter(
                    (name) => name !== testcaseName,
                ),
                largeSampleDirectory,
                largeSampleComparison,
                largeSampleAnswerMode,
                largeSampleCheckerEnabled,
                largeSampleCheckerPath,
            },
            directory: largeSampleDirectory,
            testcaseName,
            comparison: largeSampleComparison,
            answerMode: largeSampleAnswerMode,
            checkerEnabled: largeSampleCheckerEnabled,
            checkerPath: largeSampleCheckerPath || undefined,
        });
    };

    const toggleLargeSampleSkip = (testcaseName: string) => {
        updateLargeSampleConfig({
            largeSampleSkippedCases: largeSampleSkippedCases.includes(
                testcaseName,
            )
                ? largeSampleSkippedCases.filter(
                      (name) => name !== testcaseName,
                  )
                : [...largeSampleSkippedCases, testcaseName],
        });
    };

    useEffect(() => {
        if (largeSampleDirectory) {
            scanLargeSamples(largeSampleDirectory, largeSampleAnswerMode);
        }
    }, [problem.srcPath, largeSampleDirectory, largeSampleAnswerMode]);

    const copyStressInstructions = () => {
        const instructions = [
            t('generatorInputFormat'),
            t('generatorOutputFormat'),
            t('stdInputFormat'),
            t('stdOutputFormat'),
            t('targetInputFormat'),
            t('generatorExampleTitle'),
            t('generatorExample'),
        ].join('\n');
        sendMessageToVSCode({ command: 'copy-text', text: instructions });
        notify(t('copiedToClipboard'));
    };

    const viewGeneratorExample = () => {
        sendMessageToVSCode({
            command: 'open-stress-example',
            language: 'cpp',
            content: t('generatorExample'),
        });
    };

    const addStressCounterexample = () => {
        if (!pendingStressFailure) {
            return;
        }
        const counterexample = {
            id: pendingStressFailure.testcase.id,
            result: pendingStressFailure.result,
            testcase: pendingStressFailure.testcase,
        };
        const nextCases = [...cases, counterexample];
        updateCases(nextCases);
        sendMessageToVSCode({
            command: 'save',
            problem: {
                ...problem,
                tests: nextCases.map((testCase) => testCase.testcase),
            },
        });
        setPendingStressFailure(null);
        setStressMessage(t('counterexampleAdded'));
        setFocusLast(true);
    };

    const startStress = () => {
        refreshOnlineJudge();
        const runId = Date.now();
        stressRunIdRef.current = runId;
        setStressRunning(true);
        setPendingStressFailure(null);
        setStressMessage(t('stressStarting'));
        setStressProgress({ iteration: 0, total: stressIterations });
        sendMessageToVSCode({
            command: 'stress-start',
            runId,
            problem,
            generatorPath: stressGeneratorPath,
            stdPath: stressStdPath,
            iterations: stressIterations,
        });
    };

    const stopStress = () => {
        sendMessageToVSCode({
            command: 'stress-stop',
            runId: stressRunIdRef.current || undefined,
        });
        setStressMessage(t('stoppedProcesses'));
    };

    const closeStressDialog = () => {
        if (stressRunning) {
            stopStress();
        }
        setStressDialogVisible(false);
    };

    const renderStressDialog = () => {
        if (!stressDialogVisible) {
            return null;
        }

        return (
            <div
                className="stress-dialog-backdrop"
                role="presentation"
                onMouseDown={closeStressDialog}
            >
                <div
                    className="stress-dialog"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="stress-dialog-title"
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <div className="stress-dialog-header">
                        <h3 id="stress-dialog-title">
                            <i className="codicon codicon-git-compare"></i>{' '}
                            {t('stressTesting')}
                        </h3>
                        <button
                            type="button"
                            className="stress-dialog-close"
                            title={t('close')}
                            onClick={closeStressDialog}
                        >
                            <i className="codicon codicon-close"></i>
                        </button>
                    </div>
                    <p className="stress-hint">{t('stressDescription')}</p>
                    <details className="stress-instructions selectable">
                        <summary>{t('stressInstructions')}</summary>
                        <div className="stress-example-actions">
                            <button
                                type="button"
                                className="btn btn-black stress-copy-button"
                                onClick={copyStressInstructions}
                            >
                                {t('copy')}
                            </button>
                            <button
                                type="button"
                                className="btn btn-black stress-copy-button"
                                onClick={viewGeneratorExample}
                            >
                                {t('viewGeneratorExample')}
                            </button>
                        </div>
                        <ul>
                            <li>{t('generatorInputFormat')}</li>
                            <li>{t('generatorOutputFormat')}</li>
                            <li>{t('stdInputFormat')}</li>
                            <li>{t('stdOutputFormat')}</li>
                            <li>{t('targetInputFormat')}</li>
                        </ul>
                        <p className="stress-example-title">
                            {t('generatorExampleTitle')}
                        </p>
                        <pre className="stress-example selectable">
                            {t('generatorExample')}
                        </pre>
                    </details>
                    <div className="stress-file-picker">
                        <input
                            readOnly
                            value={stressGeneratorPath}
                            placeholder={t('generatorPath')}
                        />
                        <button
                            className="btn btn-black"
                            onClick={() => pickStressFile('generator')}
                        >
                            {t('choose')}
                        </button>
                    </div>
                    <div className="stress-file-picker">
                        <input
                            readOnly
                            value={stressStdPath}
                            placeholder={t('stdPath')}
                        />
                        <button
                            className="btn btn-black"
                            onClick={() => pickStressFile('std')}
                        >
                            {t('choose')}
                        </button>
                    </div>
                    <div className="stress-actions">
                        <label>
                            {t('iterations')}{' '}
                            <input
                                type="number"
                                min={1}
                                max={100000}
                                value={stressIterations}
                                onChange={(event) =>
                                    setStressIterations(
                                        Number(event.target.value),
                                    )
                                }
                                style={{
                                    width: '90px',
                                    marginLeft: '6px',
                                }}
                            />
                        </label>
                        <button
                            className="btn btn-green"
                            disabled={stressRunning}
                            onClick={startStress}
                        >
                            {t('startStress')}
                        </button>
                        <button
                            className="btn btn-red"
                            disabled={!stressRunning}
                            onClick={stopStress}
                        >
                            {t('stopStress')}
                        </button>
                    </div>
                    {stressMessage && (
                        <div className="stress-status" role="status" aria-live="polite">
                            {stressRunning && (
                                <span
                                    className="stress-spinner"
                                    aria-label={t('stressRunning')}
                                >
                                    <i className="codicon codicon-loading" />
                                </span>
                            )}
                            <span>{stressMessage}</span>
                        </div>
                    )}
                    {stressRunning && (
                        <div
                            className="stress-progress-track"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={stressProgress.total}
                            aria-valuenow={stressProgress.iteration}
                        >
                            <div
                                className="stress-progress-bar"
                                style={{
                                    width: `${Math.min(
                                        100,
                                        (stressProgress.iteration /
                                            Math.max(1, stressProgress.total)) *
                                            100,
                                    )}%`,
                                }}
                            />
                        </div>
                    )}
                    {pendingStressFailure && (
                        <div className="stress-counterexample">
                            <p className="stress-status">
                                {t('stressFound')} ({t('iterations')}{' '}
                                {pendingStressFailure.iteration})
                            </p>
                            <div className="stress-counterexample-field">
                                <label>{t('inputLabel')}</label>
                                <textarea
                                    className="selectable"
                                    readOnly
                                    value={truncateStressText(
                                        pendingStressFailure.testcase.input,
                                    )}
                                />
                            </div>
                            <div className="stress-counterexample-field">
                                <label>{t('expectedOutputLabel')}</label>
                                <textarea
                                    className="selectable"
                                    readOnly
                                    value={truncateStressText(
                                        pendingStressFailure.testcase.output,
                                    )}
                                />
                            </div>
                            <div className="stress-counterexample-field">
                                <label>{t('receivedOutputLabel')}</label>
                                <textarea
                                    className="selectable"
                                    readOnly
                                    value={truncateStressText(
                                        pendingStressFailure.result.stdout,
                                    )}
                                />
                            </div>
                            {pendingStressFailure.result.stderr && (
                                <div className="stress-counterexample-field">
                                    <label>{t('standardError')}</label>
                                    <textarea
                                        className="selectable"
                                        readOnly
                                        value={truncateStressText(
                                            pendingStressFailure.result.stderr,
                                        )}
                                    />
                                </div>
                            )}
                            {pendingStressFailure.result.diff && (
                                <p className="stress-hint">
                                    {t('outputDifference')}{' '}
                                    {pendingStressFailure.result.diff.summary}
                                </p>
                            )}
                            <button
                                className="btn btn-green"
                                onClick={addStressCounterexample}
                            >
                                {t('addCounterexample')}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const submitKattis = () => {
        sendMessageToVSCode({
            command: 'submitKattis',
            problem,
        });

        setWaitingForSubmit(true);
    };

    const submitCf = () => {
        if (submitBrowserHintTimeout.current) {
            clearTimeout(submitBrowserHintTimeout.current);
            submitBrowserHintTimeout.current = null;
        }
        setShowCfBrowserHint(false);
        sendMessageToVSCode({
            command: 'submitCf',
            problem,
        });

        setWaitingForSubmit(true);
    };
    const submitCSES = () => {
        sendMessageToVSCode({
            command: 'submitCSES',
            problem,
        });

        setWaitingForSubmit(true);
    };

    const submitShortestPath = () => {
        if (!submitShortestPathArmed) {
            setSubmitShortestPathArmed(true);
            if (submitShortestPathArmedTimer.current) {
                clearTimeout(submitShortestPathArmedTimer.current);
            }
            submitShortestPathArmedTimer.current = setTimeout(() => {
                setSubmitShortestPathArmed(false);
                submitShortestPathArmedTimer.current = null;
            }, 3000);
            return;
        }
        if (submitShortestPathArmedTimer.current) {
            clearTimeout(submitShortestPathArmedTimer.current);
            submitShortestPathArmedTimer.current = null;
        }
        setSubmitShortestPathArmed(false);
        sendMessageToVSCode({
            command: 'submitShortestPath',
            problem,
        });
    };
    const debounceFocusLast = () => {
        setTimeout(() => {
            setFocusLast(false);
        }, 100);
    };

    const debounceForceRunning = () => {
        setTimeout(() => {
            setForceRunning(false);
        }, 100);
    };

    const getRunningProp = (value: Case) => {
        if (forceRunning === value.id) {
            debounceForceRunning();
            return forceRunning === value.id;
        }
        return false;
    };

    const getCheckingProp = (value: Case) => {
        if (forceChecking === value.id) {
            setTimeout(() => {
                setForceChecking(false);
            }, 100);
            return true;
        }
        return false;
    };

    const toggleOnlineJudgeEnv = () => {
        const newEnv = !onlineJudgeEnv;
        setOnlineJudgeEnv(newEnv);
        let sendEnv = 'false';
        if (newEnv) sendEnv = 'true';
        sendMessageToVSCode({
            command: 'online-judge-env',
            value: sendEnv,
        });
    };

    const updateCase = (id: number, input: string, output: string) => {
        const newCases: Case[] = cases.map((testCase) => {
            if (testCase.id === id) {
                return {
                    id,
                    result: testCase.result,
                    testcase: {
                        id,
                        input,
                        output,
                    },
                };
            } else {
                return testCase;
            }
        });
        updateCases(newCases);
    };

    const updateCheckerPath = (path: string) => {
        updateProblem({
            ...problem,
            customCheckerPath: path,
        });
    };

    const notify = (text: string, duration = 1000) => {
        clearTimeout(notificationTimeout!);
        setNotification(text);
        notificationTimeout = setTimeout(() => {
            setNotification(null);
            notificationTimeout = undefined;
        }, duration);
    };

    const toggleChecker = () => {
        const nextVisible = !checkerVisible;
        setCheckerVisible(nextVisible);
        if (nextVisible) {
            setTimeout(() => {
                checkerInputRef.current?.focus();
            }, 100);
        }
    };

    const openCheckerFile = () => {
        const checkerPath = problem.customCheckerPath?.trim();
        if (checkerPath) {
            sendMessageToVSCode({
                command: 'open-file',
                path: checkerPath,
            });
        }
    };

    const views: JSX.Element[] = [];
    cases.forEach((value, index) => {
        if (focusLast && index === cases.length - 1) {
            views.push(
                <CaseView
                    notify={notify}
                    num={index + 1}
                    case={value}
                    rerun={rerun}
                    key={value.id.toString()}
                    remove={remove}
                    doFocus={true}
                    forceRunning={getRunningProp(value)}
                    forceChecking={getCheckingProp(value)}
                    updateCase={updateCase}
                    customCheckerPath={problem.customCheckerPath}
                    stop={stop}
                ></CaseView>,
            );
            debounceFocusLast();
        } else {
            views.push(
                <CaseView
                    notify={notify}
                    num={index + 1}
                    case={value}
                    rerun={rerun}
                    key={value.id.toString()}
                    remove={remove}
                    forceRunning={getRunningProp(value)}
                    forceChecking={getCheckingProp(value)}
                    updateCase={updateCase}
                    customCheckerPath={problem.customCheckerPath}
                    stop={stop}
                ></CaseView>,
            );
        }
    });

    const renderSubmitButton = (className = '') => {
        if (!problem.url.startsWith('http')) {
            return null;
        }

        let url: URL;
        try {
            url = new URL(problem.url);
        } catch (err) {
            console.error(err, problem);
            return null;
        }
        const isShortestPathHost =
            url.hostname === 'shortestpath.cn' ||
            url.hostname.endsWith('.shortestpath.cn');
        if (
            !url.hostname.endsWith('codeforces.com') &&
            url.hostname !== 'open.kattis.com' &&
            !url.hostname.endsWith('cses.fi') &&
            !isShortestPathHost
        ) {
            return null;
        }

        if (isShortestPathHost) {
            return (
                <button
                    className={`btn ${className} ${
                        submitShortestPathArmed ? 'btn-yellow' : ''
                    }`}
                    onClick={submitShortestPath}
                    title={
                        submitShortestPathArmed
                            ? t('confirmSubmit')
                            : t('submit')
                    }
                >
                    {submitShortestPathArmed ? (
                        t('confirmSubmit')
                    ) : (
                        <>
                            <span className="icon">
                                <i className="codicon codicon-cloud-upload"></i>
                            </span>{' '}
                            {t('submit')}
                        </>
                    )}
                </button>
            );
        }

        if (url.hostname.endsWith('codeforces.com')) {
            return (
                <>
                    <button
                        className={`btn ${className} ${
                            waitingForSubmit ? 'is-waiting' : ''
                        }`}
                        onClick={submitCf}
                        disabled={waitingForSubmit}
                        aria-live="polite"
                    >
                        {waitingForSubmit ? (
                            <span className="submit-waiting-copy">
                                <span>{t('waitingForExtension')}</span>
                                <small>{t('checkBrowserForSubmit')}</small>
                            </span>
                        ) : (
                            <>
                                {showCfBrowserHint ? (
                                    t('checkBrowser')
                                ) : (
                                    <>
                                        <span className="icon">
                                            <i className="codicon codicon-cloud-upload"></i>
                                        </span>{' '}
                                        {t('submit')}
                                    </>
                                )}
                            </>
                        )}
                        {waitingForSubmit && (
                            <span
                                className="submit-progress"
                                aria-hidden="true"
                            />
                        )}
                    </button>
                </>
            );
        } else if (url.hostname == 'open.kattis.com') {
            return (
                <button
                    className={`btn ${className} ${
                        waitingForSubmit ? 'is-waiting' : ''
                    }`}
                    onClick={submitKattis}
                    disabled={waitingForSubmit}
                    aria-live="polite"
                >
                    <span className="icon">
                        <i className="codicon codicon-cloud-upload"></i>
                    </span>{' '}
                    {waitingForSubmit ? t('submitting') : t('submitOnKattis')}
                    {waitingForSubmit && (
                        <span className="submit-progress" aria-hidden="true" />
                    )}
                </button>
            );
        } else if (
            url.hostname == 'cses.fi' ||
            url.hostname.endsWith('cses.fi')
        ) {
            return (
                <button
                    className={`btn ${className} ${
                        waitingForSubmit ? 'is-waiting' : ''
                    }`}
                    onClick={submitCSES}
                    disabled={waitingForSubmit}
                    aria-live="polite"
                >
                    <span className="icon">
                        <i className="codicon codicon-cloud-upload"></i>
                    </span>{' '}
                    {waitingForSubmit ? t('submitting') : t('submit')}
                    {waitingForSubmit && (
                        <span className="submit-progress" aria-hidden="true" />
                    )}
                </button>
            );
        }
    };

    const getHref = () => {
        if (problem.local === undefined || problem.local === false) {
            return problem.url;
        } else {
            return undefined;
        }
    };

    const showInfoPage = () => {
        sendMessageToVSCode({
            command: 'get-ext-logs',
        });
        setEditableStateText(JSON.stringify(webviewState, null, 2));
        setInfoPageVisible(true);
    };

    const saveDebugState = () => {
        try {
            const newState = JSON.parse(editableStateText);
            updateWebviewState(newState);
            setNotification('State saved');
        } catch (e) {
            setNotification('Invalid JSON');
        }
    };

    const clearState = () => {
        const defaultState = {
            dialogCloseDate: Date.now(),
            feedbackDialogCloseDate: Date.now(),
            hasSeenFeedbackTooltip: false,
            catCompanionEnabled: false,
            totalLoads: 0,
            hasSeenCompanionTooltip: false,
            rateDialogCloseDate: Date.now(),
        };
        updateWebviewState(defaultState);
        setEditableStateText(JSON.stringify(defaultState, null, 2));
        setNotification('State cleared');
    };

    const renderInfoPage = () => {
        if (infoPageVisible === false) {
            return null;
        }

        if (generatedJson === null) {
            return (
                <Page
                    content={t('loading')}
                    title={t('aboutCPH')}
                    closePage={() => setInfoPageVisible(false)}
                />
            );
        }
        const logs = storedLogs;
        const contents = (
            <div>
                {t('cphDescription')}
                <hr />
                <h3>{t('getHelp')}</h3>
                <a
                    className="btn"
                    href={`${projectUrl}/blob/main/${userGuidePath}`}
                >
                    {t('userGuide')}
                </a>
                <hr />
                <h3>{t('commit')}</h3>
                <pre className="selectable">{generatedJson.gitCommitHash}</pre>
                <hr />
                <h3>{t('buildTime')}</h3>
                {generatedJson.dateTime}
                <hr />
                <h3>{t('liveUserCount')}</h3>
                {liveUserCount} {liveUserCount === 1 ? t('user') : t('users')}{' '}
                {t('online')}.
                <hr />
                <h3>{t('uiLogs')}</h3>
                <pre className="selectable">{logs}</pre>
                <hr />
                <h3>{t('extensionLogs')}</h3>
                <pre className="selectable">{extLogs}</pre>
                <hr />
                <h3>Debug</h3>
                <textarea
                    className="selectable"
                    value={editableStateText}
                    onChange={(e) => setEditableStateText(e.target.value)}
                    rows={10}
                    style={{ height: '200px', fontSize: '12px' }}
                />
                <button className="btn btn-green" onClick={saveDebugState}>
                    Save Changes
                </button>
                <button className="btn btn-red" onClick={clearState}>
                    Clear State
                </button>
                <hr />
                <details>
                    <summary>
                        <b>{t('license')}</b>
                    </summary>
                    <pre className="selectable">
                        {generatedJson.licenseString}
                    </pre>
                </details>
            </div>
        );

        return (
            <Page
                content={contents}
                title={t('aboutCPH')}
                closePage={() => setInfoPageVisible(false)}
            />
        );
    };

    const renderTimeoutAVSuggestion = () => {
        if (
            cases.some((testCase) => {
                return (
                    testCase.result?.timeOut ||
                    testCase.result?.signal == 'SIGTERM'
                );
            })
        ) {
            return (
                <div className="timeout-av-suggestion">
                    <h5>
                        <i className="codicon codicon-bug"></i>{' '}
                        {t('antivirusTitle')}
                    </h5>
                    <p>{t('antivirusDescription')}</p>
                </div>
            );
        } else {
            return <></>;
        }
    };

    const importCases = (newTestcases: { input: string; output: string }[]) => {
        const generatedCases = newTestcases.map((tc, index) => {
            const id = Date.now() + index;
            const testCase: TestCase = {
                id,
                input: tc.input,
                output: tc.output,
            };
            return {
                id,
                result: null,
                testcase: testCase,
            };
        });

        updateCases((prevCases) => [...prevCases, ...generatedCases]);
        setFocusLast(true);
    };

    return (
        <div
            className={`ui ${
                webviewState.catCompanionEnabled ? 'cat-companion-active' : ''
            }`}
        >
            {notification && <div className="notification">{notification}</div>}
            {renderInfoPage()}
            {renderStressDialog()}
            <ImportCases
                t={t}
                notify={notify}
                importPageVisible={importPageVisible}
                setImportPageVisible={setImportPageVisible}
                importCases={importCases}
            />
            <div className="meta judge-header">
                <span className="problem-name">
                    <a href={getHref()}>{problem.name}</a>{' '}
                    <b
                        className="compiling"
                        title={compiling ? t('compiling') : undefined}
                        style={{
                            opacity: compiling ? 1 : 0,
                            pointerEvents: compiling ? 'auto' : 'none',
                        }}
                    >
                        <span className="loader"></span>
                    </b>
                </span>
                <span
                    className={`pass-rate ${
                        numPassed === total
                            ? 'pass-all'
                            : numPassed === 0
                              ? 'fail-all'
                              : ''
                    }`}
                >
                    <span>
                        {numPassed} / {total}
                    </span>
                    <span className="pass-rate-label"> {t('passedRate')}</span>
                </span>
            </div>
            <div
                className="results"
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleLargeSampleDrop}
            >
                {views}
                {largeSampleCases.map((testcase, index) => {
                    const result = largeSampleCaseResults[testcase.name];
                    const skipped = largeSampleSkippedCases.includes(
                        testcase.name,
                    );
                    return (
                        <CaseView
                            key={testcase.name}
                            num={index + 1}
                            case={{
                                id: -(index + 1),
                                result: null,
                                testcase: {
                                    id: -(index + 1),
                                    input: '',
                                    output: '',
                                },
                            }}
                            rerun={() => {}}
                            updateCase={() => {}}
                            remove={() => {}}
                            notify={notify}
                            forceRunning={false}
                            forceChecking={false}
                            stop={stop}
                            fileCase={{
                                testcase,
                                state:
                                    skipped
                                        ? 'skipped'
                                        : result?.state || 'pending',
                                outputPath: result?.outputPath,
                                reason: result?.reason,
                                time: result?.time,
                                execution: result?.execution,
                                openFile: openLargeSampleFile,
                                rerun: () => runLargeSample(testcase.name),
                                toggleSkip: () =>
                                    toggleLargeSampleSkip(testcase.name),
                            }}
                        />
                    );
                })}
            </div>
            {(largeSampleDirectory || largeSampleStatus) && (
                <div className="large-sample-inline-status">
                    <span>
                        {largeSampleStatus ||
                            `${largeSampleCases.length} ${t('largeSampleCasesFound')}`}
                    </span>
                </div>
            )}
            {largeSampleRunning && (
                <div className="stress-progress-track">
                    <div
                        className="stress-progress-bar"
                        style={{
                            width: `${Math.min(
                                100,
                                (largeSampleProgress.index /
                                    Math.max(1, largeSampleProgress.total)) *
                                    100,
                            )}%`,
                        }}
                    />
                </div>
            )}
            {largeSampleDiagnostics.length > 0 && (
                <div className="large-sample-diagnostics">
                    {largeSampleDiagnostics.map((diagnostic, index) => (
                        <div key={`${diagnostic.file}-${index}`}>
                            {diagnostic.file && `${diagnostic.file}: `}
                            {diagnostic.message}
                        </div>
                    ))}
                </div>
            )}
            <div className="more-tools-shell">
                <div className="test-tools-row">
                    <button
                        className="btn btn-black stress-open-button"
                        type="button"
                        onClick={() => setStressDialogVisible(true)}
                    >
                        <i className="codicon codicon-git-compare"></i>{' '}
                        {t('stressTesting')}
                    </button>
                    <button
                        className="btn btn-black stress-open-button"
                        type="button"
                        onClick={pickLargeSampleDirectory}
                    >
                        <i className="codicon codicon-folder-opened"></i>{' '}
                        {t('largeSampleChooseDirectory')}
                    </button>
                </div>
                <button
                    className="more-tools-toggle"
                    type="button"
                    aria-expanded={moreToolsVisible}
                    onClick={() => setMoreToolsVisible(!moreToolsVisible)}
                >
                    <i
                        className={`codicon codicon-chevron-${
                            moreToolsVisible ? 'up' : 'down'
                        }`}
                    ></i>{' '}
                    {t('moreActions')}
                </button>
                <div
                    className={`more-tools-panel ${
                        moreToolsVisible ? 'is-open' : ''
                    }`}
                    aria-hidden={!moreToolsVisible}
                >
                    <div className="margin-10">
                        <div className="action-container">
                            <div className="button-grid">
                                <button
                                    className={`btn btn-block ${
                                        deleteProblemArmed
                                            ? 'btn-red'
                                            : 'btn-black'
                                    }`}
                                    onClick={deleteTcs}
                                    title={
                                        deleteProblemArmed
                                            ? t('confirm')
                                            : t('delete')
                                    }
                                >
                                    {deleteProblemArmed ? (
                                        t('confirm')
                                    ) : (
                                        <>
                                            <i className="codicon codicon-trash"></i>{' '}
                                            {t('delete')}
                                        </>
                                    )}
                                </button>
                                <button
                                    className="btn btn-black btn-block"
                                    title={t('settings')}
                                    onClick={() =>
                                        sendMessageToVSCode({
                                            command: 'open-settings',
                                        })
                                    }
                                >
                                    <i className="codicon codicon-settings"></i>{' '}
                                    {t('settings')}
                                </button>
                            </div>
                            <button
                                className={`btn btn-block ${
                                    problem.customCheckerPath?.trim()
                                        ? 'btn-orange'
                                        : ''
                                }`}
                                onClick={toggleChecker}
                            >
                                <span className="icon">
                                    <i
                                        className={`codicon codicon-chevron-${
                                            checkerVisible ? 'up' : 'down'
                                        }`}
                                    ></i>
                                </span>{' '}
                                {problem.customCheckerPath?.trim()
                                    ? t('customCheckerEnabled')
                                    : t('customChecker')}
                            </button>
                        </div>
                        {checkerVisible && (
                            <div className="pad-10 custom-checker-area">
                                <div
                                    style={{
                                        display: 'flex',
                                        gap: '5px',
                                        alignItems: 'center',
                                    }}
                                >
                                    <input
                                        type="text"
                                        className="selectable"
                                        placeholder={t(
                                            'customCheckerPathPlaceholder',
                                        )}
                                        value={problem.customCheckerPath || ''}
                                        onChange={(e) =>
                                            updateCheckerPath(e.target.value)
                                        }
                                        ref={checkerInputRef}
                                        style={{
                                            flexGrow: 1,
                                            width: '0',
                                            padding: '4px 6px',
                                        }}
                                    />
                                    <button
                                        className="btn-chromeless"
                                        title="Open the checker script"
                                        onClick={openCheckerFile}
                                        disabled={
                                            !problem.customCheckerPath?.trim()
                                        }
                                    >
                                        <span
                                            className="icon"
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}
                                        >
                                            <i className="codicon codicon-link-external"></i>
                                        </span>
                                    </button>
                                </div>
                                <details style={{ marginTop: '10px' }}>
                                    <summary
                                        style={{
                                            cursor: 'pointer',
                                            fontSize: '0.9em',
                                            opacity: 0.8,
                                        }}
                                    >
                                        {t('usageInstructions')}
                                    </summary>
                                    <div style={{ marginTop: '10px' }}>
                                        <small>
                                            {t('customCheckerDescription')}
                                            <br />
                                            <br />
                                            {t('exitCodes')}
                                            <br />
                                            <br />
                                            {t('invocationFormat')}:
                                            <br />
                                            <code>
                                                {window.pythonCommand}{' '}
                                                &lt;script-path&gt;
                                                &lt;input-file&gt;
                                                &lt;output-file&gt;
                                            </code>
                                            <ul
                                                style={{
                                                    margin: '10px 0',
                                                    paddingLeft: '20px',
                                                }}
                                            >
                                                <li>
                                                    <b>&lt;script-path&gt;</b>:{' '}
                                                    {t('argScriptPath')}
                                                </li>
                                                <li>
                                                    <b>&lt;input-file&gt;</b>:{' '}
                                                    {t('argInputFile')}
                                                </li>
                                                <li>
                                                    <b>&lt;output-file&gt;</b>:{' '}
                                                    {t('argOutputFile')}
                                                </li>
                                            </ul>
                                            {t('expectedBehavior')}
                                            <br />
                                            <textarea
                                                className="selectable"
                                                readOnly
                                                value={`with open(sys.argv[1], "r") as f:
    test_input = f.read()
with open(sys.argv[2], "r") as f:
    code_output = f.read()`}
                                                style={{
                                                    fontSize: '0.9em',
                                                    height: '95px',
                                                    width: '100%',
                                                    display: 'block',
                                                }}
                                            />
                                            <br />
                                            <a
                                                href={`${projectUrl}/blob/main/docs/user-guide.md#custom-checker`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="btn btn-black"
                                                style={{
                                                    fontSize: '0.9em',
                                                    display: 'inline-block',
                                                }}
                                            >
                                                <i className="codicon codicon-book"></i>{' '}
                                                {t('documentation')}
                                            </a>
                                        </small>
                                    </div>
                                </details>
                            </div>
                        )}
                        <details className="large-sample-config">
                            <summary>{t('largeSampleConfiguration')}</summary>
                            <div className="large-sample-config-body">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={!largeSampleEnabled}
                                        onChange={(event) => {
                                            const enabled = !event.target.checked;
                                            setLargeSampleEnabled(enabled);
                                            updateLargeSampleConfig({
                                                largeSampleEnabled: enabled,
                                            });
                                        }}
                                    />{' '}
                                    {t('largeSampleSkip')}
                                </label>
                                {largeSampleSkippedCases.length > 0 && (
                                    <div className="large-sample-skipped-cases">
                                        {largeSampleSkippedCases.map((name) => (
                                            <button
                                                key={name}
                                                className="btn btn-black"
                                                onClick={() =>
                                                    updateLargeSampleConfig({
                                                        largeSampleSkippedCases:
                                                            largeSampleSkippedCases.filter(
                                                                (value) =>
                                                                    value !== name,
                                                            ),
                                                    })
                                                }
                                            >
                                                {t('largeSampleRestore')} {name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <label>
                                    {t('largeSampleAnswerMode')}{' '}
                                    <select
                                        value={largeSampleAnswerMode}
                                        onChange={(event) => {
                                            const value = event.target.value as LargeSampleAnswerMode;
                                            setLargeSampleAnswerMode(value);
                                            updateLargeSampleConfig({ largeSampleAnswerMode: value });
                                            scanLargeSamples(largeSampleDirectory, value);
                                        }}
                                    >
                                        <option value="auto">{t('largeSampleAuto')}</option>
                                        <option value="out">.out</option>
                                        <option value="ans">.ans</option>
                                    </select>
                                </label>
                                <label>
                                    {t('largeSampleRunMode')}{' '}
                                    <select
                                        value={largeSampleRunMode}
                                        onChange={(event) => {
                                            const value = event.target.value as LargeSampleRunMode;
                                            setLargeSampleRunMode(value);
                                            updateLargeSampleConfig({ largeSampleRunMode: value });
                                        }}
                                    >
                                        <option value="stop-on-failure">{t('largeSampleStopOnFailure')}</option>
                                        <option value="run-all">{t('largeSampleRunAll')}</option>
                                    </select>
                                </label>
                                <div className="large-sample-config-checks">
                                    {(
                                        [
                                            ['ignoreTrailingWhitespace', 'largeSampleIgnoreTrailing'],
                                            ['ignoreBlankLines', 'largeSampleIgnoreBlank'],
                                            ['ignoreOuterWhitespace', 'largeSampleIgnoreOuter'],
                                            ['tokenCompare', 'largeSampleTokenCompare'],
                                        ] as Array<[keyof LargeSampleComparisonOptions, string]>
                                    ).map(([key, label]) => (
                                        <label key={key}>
                                            <input
                                                type="checkbox"
                                                checked={largeSampleComparison[key]}
                                                onChange={(event) => {
                                                    const comparison = {
                                                        ...largeSampleComparison,
                                                        [key]: event.target.checked,
                                                    };
                                                    setLargeSampleComparison(comparison);
                                                    updateLargeSampleConfig({ largeSampleComparison: comparison });
                                                }}
                                            />{' '}
                                            {t(label)}
                                        </label>
                                    ))}
                                </div>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={largeSampleCheckerEnabled}
                                        onChange={(event) => {
                                            setLargeSampleCheckerEnabled(event.target.checked);
                                            updateLargeSampleConfig({ largeSampleCheckerEnabled: event.target.checked });
                                        }}
                                    />{' '}
                                    {t('largeSampleUseChecker')}
                                </label>
                                {largeSampleCheckerEnabled && (
                                    <div className="large-sample-picker">
                                        <input
                                            type="text"
                                            readOnly
                                            value={largeSampleCheckerPath}
                                            placeholder={
                                                problem.customCheckerPath ||
                                                t('largeSampleCheckerPlaceholder')
                                            }
                                        />
                                        <button
                                            className="btn btn-black"
                                            onClick={pickLargeSampleChecker}
                                        >
                                            {t('choose')}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </details>
                        <small className="footer-button-grid">
                            <a
                                role="button"
                                className="btn btn-black footer-btn-row-2"
                                title={t('importTooltip')}
                                onClick={() => setImportPageVisible(true)}
                            >
                                <i className="codicon codicon-cloud-upload"></i>{' '}
                                {t('import')}
                            </a>
                            <span
                                className="footer-btn-row-2"
                                style={{ position: 'relative' }}
                            >
                                {showCompanionTooltip &&
                                    !webviewState.catCompanionEnabled && (
                                        <div
                                            className="feedback-tooltip"
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                            }}
                                        >
                                            <span>{t('companionTooltip')}</span>
                                            <a
                                                role="button"
                                                style={{
                                                    cursor: 'pointer',
                                                    color: 'white',
                                                    opacity: 0.8,
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    setShowCompanionTooltip(
                                                        false,
                                                    );
                                                    updateWebviewState({
                                                        ...webviewState,
                                                        hasSeenCompanionTooltip:
                                                            true,
                                                    });
                                                }}
                                                title="Close"
                                            >
                                                <i
                                                    className="codicon codicon-close"
                                                    style={{
                                                        fontSize: '10px',
                                                    }}
                                                ></i>
                                            </a>
                                        </div>
                                    )}
                                <a
                                    role="button"
                                    className="btn btn-black"
                                    title={
                                        webviewState.catCompanionEnabled
                                            ? t('disableCatCompanion')
                                            : t('enableCatCompanion')
                                    }
                                    onClick={() => {
                                        updateWebviewState({
                                            ...webviewState,
                                            catCompanionEnabled:
                                                !webviewState.catCompanionEnabled,
                                            hasSeenCompanionTooltip: true,
                                        });
                                    }}
                                >
                                    <i className="codicon codicon-octoface"></i>{' '}
                                    {t('cat')}
                                </a>
                            </span>
                            <a
                                href={`${projectUrl}/issues`}
                                className="btn btn-black footer-btn-row-2"
                            >
                                <i className="codicon codicon-github"></i>{' '}
                                {t('bugs')}
                            </a>
                            <a
                                role="button"
                                className="btn btn-black footer-btn-row-2"
                                title={t('aboutCPH')}
                                onClick={() => showInfoPage()}
                            >
                                <i className="codicon codicon-info"></i>{' '}
                                {t('about')}
                            </a>
                        </small>
                        <div>
                            <span
                                onClick={toggleOnlineJudgeEnv}
                                className={`oj-box ${
                                    onlineJudgeEnv ? 'oj-enabled' : ''
                                }`}
                            >
                                {onlineJudgeEnv ? '☑' : '☐'}{' '}
                                <span className="oj-code">
                                    {t('setOnlineJudge')}
                                </span>
                            </span>
                            {renderTimeoutAVSuggestion()}
                        </div>
                        <div className="remote-message">
                            <p
                                dangerouslySetInnerHTML={{
                                    __html: window.remoteMessage || '',
                                }}
                            />
                        </div>
                        {window.showLiveUserCount && liveUserCount > 0 && (
                            <div className="liveUserCount">
                                <i className="codicon codicon-circle-filled color-green"></i>{' '}
                                {liveUserCount}{' '}
                                {liveUserCount === 1 ? t('user') : t('users')}{' '}
                                {t('online')}.
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <div className="actions">
                {webviewState.catCompanionEnabled && (
                    <CatCompanion
                        enabled={webviewState.catCompanionEnabled}
                        total={total}
                        numPassed={numPassed}
                    />
                )}
                {renderSubmitButton('submit-action')}
                <div className="actions-main-row">
                    <div className="split-btn">
                        <button
                            className="btn main-btn"
                            onClick={runAll}
                            title={t('runAll')}
                        >
                            <span className="icon">
                                <i className="codicon codicon-run-above"></i>
                            </span>{' '}
                            <span className="action-text">{t('runAll')}</span>
                        </button>
                        <button
                            className="btn chevron-btn"
                            title={t('moreActions')}
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const event = new MouseEvent('contextmenu', {
                                    bubbles: true,
                                    clientX: e.clientX,
                                    clientY: e.clientY,
                                });
                                e.currentTarget.dispatchEvent(event);
                            }}
                            data-vscode-context='{"preventDefaultContextMenuItems": true, "webviewSection": "compile-button"}'
                        >
                            <span className="icon">
                                <i className="codicon codicon-chevron-down"></i>
                            </span>
                        </button>
                    </div>
                    <button
                        className="btn btn-new primary-action"
                        onClick={newCase}
                        title={t('newTestcase')}
                    >
                        <span className="icon">
                            <i className="codicon codicon-add"></i>
                        </span>
                        <span className="action-text">{t('new')}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

const getCasesFromProblem = (problem: Problem | undefined): Case[] => {
    if (problem === undefined) {
        return [];
    }

    return problem.tests.map((testCase) => ({
        id: testCase.id,
        result: null,
        testcase: testCase,
    }));
};

/**
 * A wrapper over the main component Judge.
 * Shows UI to create problem when no problem exists.
 * Otherwise, shows the Judge view.
 */
function App() {
    const [problem, setProblem] = useState<Problem | undefined>(undefined);
    const [cases, setCases] = useState<Case[]>([]);
    const [deferSaveTimer, setDeferSaveTimer] = useState<number | null>(null);
    const [, setSaving] = useState<boolean>(false);
    const [showFallback, setShowFallback] = useState<boolean>(false);
    const [onlineJudgeEnv, setOnlineJudgeEnv] = useState<boolean>(false);

    // Save the problem
    const save = () => {
        setSaving(true);
        if (problem !== undefined) {
            vscodeApi.postMessage({
                command: 'save',
                problem,
            });
        }
        setTimeout(() => {
            setSaving(false);
        }, 500);
    };

    const handleRunSingleResult = (data: ResultCommand) => {
        setCases((previousCases) => {
            const idx = previousCases.findIndex(
                (testCase) => testCase.id === data.result.id,
            );
            if (idx === -1) {
                console.error(
                    'Invalid single result',
                    previousCases,
                    previousCases.length,
                    data,
                );
                return previousCases;
            }
            const newCases = previousCases.slice();
            newCases[idx] = {
                ...newCases[idx],
                result: data.result,
            };
            return newCases;
        });
    };

    // Save problem if it changes.
    useEffect(() => {
        if (deferSaveTimer !== null) {
            clearTimeout(deferSaveTimer);
        }
        const timeOutId = window.setTimeout(() => {
            setDeferSaveTimer(null);
            save();
        }, 500);
        setDeferSaveTimer(timeOutId);
    }, [problem]);

    useEffect(() => {
        const fn = (event: any) => {
            const data: VSToWebViewMessage = event.data;
            switch (data.command) {
                case 'new-problem': {
                    if (data.problem === undefined) {
                        setShowFallback(true);
                    }

                    setProblem(data.problem);
                    setCases(getCasesFromProblem(data.problem));
                    setOnlineJudgeEnv(data.onlineJudgeEnv ?? false);
                    break;
                }
                case 'run-single-result': {
                    handleRunSingleResult(data);
                    break;
                }
                case 'update-online-judge-env': {
                    setOnlineJudgeEnv(data.value);
                    break;
                }
            }
        };
        window.addEventListener('message', fn);
        return () => {
            window.removeEventListener('message', fn);
        };
    }, []);

    const createProblem = () => {
        vscodeApi.postMessage({
            command: 'create-local-problem',
        });
    };

    if (problem === undefined && showFallback) {
        return (
            <>
                <div className={`ui p10 fallback`}>
                    <div className="text-center">
                        <p>{t('noProblemAssociated')}</p>
                        <br />
                        <div className="btn btn-block" onClick={createProblem}>
                            <span className="icon">
                                <i className="codicon codicon-add"></i>
                            </span>{' '}
                            {t('createProblem')}
                        </div>
                        <a
                            className="btn btn-block btn-green"
                            href={`${projectUrl}/blob/main/docs/user-guide.md`}
                        >
                            <span className="icon">
                                <i className="codicon codicon-question"></i>
                            </span>{' '}
                            {t('howToUse')}
                        </a>
                    </div>
                </div>
            </>
        );
    } else if (problem !== undefined) {
        return (
            <Judge
                key={problem.srcPath}
                problem={problem}
                updateProblem={setProblem}
                cases={cases}
                updateCases={setCases}
                onlineJudgeEnv={onlineJudgeEnv}
                setOnlineJudgeEnv={setOnlineJudgeEnv}
            />
        );
    } else {
        return (
            <>
                <div className="text-center">{t('loading')}</div>
            </>
        );
    }
}

const root = createRoot(document.getElementById('app')!);
root.render(<App />);
