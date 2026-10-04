import { connectJudgeMessages } from '../../webviewBootstrap';
import { createOjTimerRequests, elapsedOjTime, elapsedProblemTime, isShortestPathProblem } from '../../problemTimer';
import { expandAfterRun, sameTestcase } from '../../testcasePresentation';
import { droppedPaths, droppedContents, claimTestcaseDrag } from './testcaseDrop';
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
    Problem,
    WebviewToVSEvent,
    TestCase,
    Case,
    VSToWebViewMessage,
    ResultCommand,
    RunResult,
    RunningCommand,
    CheckingCommand,
    StressFailureCommand,
    StressFinishedCommand,
    StressStatusCommand,
    StressFileSelectedCommand,
    WebViewpersistenceState,
} from '../../types';
import CaseView from './CaseView';
import { CaseDrag } from './TestCaseCard';
import { ImportCases } from './ImportCases';
import { CatCompanion } from './CatCompanion';
import ProblemHeader from './components/ProblemHeader';
import TestcaseToolbar from './components/TestcaseToolbar';
import TaskStatusBar from './components/TaskStatusBar';
import JudgeActionBar from './components/JudgeActionBar';
import AuxMenu from './components/AuxMenu';
import CaseActionsMenu, { MenuAnchor } from './components/CaseActionsMenu';
import StressDialog from './components/StressDialog';
import ProblemSettings from './components/ProblemSettings';
import JudgeInfoPage from './components/JudgeInfoPage';
import {
    activeTask,
    filterCounts,
    initialFilter,
    matchesFilter,
    StatusFilter,
    Summary,
    summarize,
    TaskKind,
} from './selectors';

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
    judgePreferences: { expandBehavior: string; hiddenStatuses: string[]; clearBeforeLoad: boolean };
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


window.console.log = customLogger.bind(window.console, originalConsole.log);
window.console.error = customLogger.bind(window.console, originalConsole.error);
window.console.warn = customLogger.bind(window.console, originalConsole.warn);
window.console.info = customLogger.bind(window.console, originalConsole.info);
window.console.debug = customLogger.bind(window.console, originalConsole.debug);

const projectUrl =
    'https://github.com/KevinHuangIsLearning/shortestpath-ide';
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
    const [timerNow, setTimerNow] = useState(Date.now());
    const [ojTimer, setOjTimer] = useState<import('../../types').OjTimer>();
    const usesOjTimer = isShortestPathProblem(problem.url);
    useEffect(() => {
        setOjTimer(undefined);
        if (!usesOjTimer) { return; }
        let disposed = false;
        const requests = createOjTimerRequests(problem.srcPath, problem.url, setOjTimer);
        const receive = (event: MessageEvent<VSToWebViewMessage>) => {
            if (!disposed && event.data.command === 'oj-timer') { requests.apply(event.data); }
        };
        window.addEventListener('message', receive);
        const request = () => vscodeApi.postMessage({ command: 'get-oj-timer', srcPath: problem.srcPath, url: problem.url, requestId: requests.next() });
        request();
        const interval = setInterval(request, 2000);
        return () => { disposed = true; clearInterval(interval); window.removeEventListener('message', receive); };
    }, [problem.srcPath, problem.url, usesOjTimer]);
    useEffect(() => {
        setTimerNow(Date.now());
        if (usesOjTimer ? ojTimer?.accepted || ojTimer && !ojTimer.running : problem.timeAcceptedAtUnixMs !== undefined) { return; }
        const timer = setInterval(() => {
            setTimerNow(Date.now());
        }, 1000);
        return () => clearInterval(timer);
    }, [problem.srcPath, problem.timeAcceptedAtUnixMs, usesOjTimer, ojTimer?.accepted, ojTimer?.running]);
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
    // Case ids the host reported as running/checking. Cleared by `not-running`,
    // and a case stops counting once its result arrives.
    const [runningIds, setRunningIds] = useState<number[]>([]);
    const [checkingIds, setCheckingIds] = useState<number[]>([]);
    const [compiling, setCompiling] = useState<boolean>(false);
    const [notification, setNotification] = useState<string | null>(null);
    const [waitingForSubmit, setWaitingForSubmit] = useState<boolean>(false);
    const [showCfBrowserHint, setShowCfBrowserHint] = useState<boolean>(false);
    const submitBrowserHintTimeout = React.useRef<ReturnType<
        typeof setTimeout
    > | null>(null);
    const [infoPageVisible, setInfoPageVisible] = useState<boolean>(false);
    const [settingsPageVisible, setSettingsPageVisible] =
        useState<boolean>(false);
    const [auxOpen, setAuxOpen] = useState<boolean>(false);
    // Which card's "⋯" menu is open, and where its button sits. The menu is drawn
    // at the panel root, in viewport coordinates, so the scrolling testcase list
    // cannot clip it.
    const [caseMenu, setCaseMenu] = useState<{
        id: number;
        anchor: MenuAnchor;
    } | null>(null);
    // Reordering. `dragId` is the row under the pointer, `dropSlot` the gap it
    // would land in, and `dragGeometry` the slots the pointer is measured
    // against — captured once, at dragstart, because the rows move under it.
    const [dragId, setDragId] = useState<number | null>(null);
    const [dropSlot, setDropSlot] = useState<number | null>(null);
    const resultsRef = useRef<HTMLDivElement>(null);
    const dragGeometry = useRef<
        { id: number; top: number; bottom: number }[] | null
    >(null);
    // Where each row was on screen just before the last reorder step. Captured
    // then rather than measured afterwards, because afterwards the rows have
    // already moved and the old animation has already been replaced.
    const dragVisualTops = useRef<Map<number, number>>(new Map());

    /*
     * Reordering slides rather than snaps. Flex `order` is an integer, so the
     * browser cannot tween the rows itself and they would jump between slots;
     * this is the usual FLIP — note where each row was, note where it landed,
     * push it back and let it travel.
     *
     * Runs on the steps that can move a row and nothing else, so typing in a
     * textarea never pays for it.
     */
    useLayoutEffect(() => {
        const container = resultsRef.current;
        if (!container || dragId === null) {
            return;
        }
        const style = getComputedStyle(container);
        const motion = parseFloat(style.getPropertyValue('--judger-motion'));
        // 0ms is meaningful — that is how the panel honours reduced motion — so
        // it is a missing token, not a zero, that falls back.
        const duration = Number.isNaN(motion) ? 120 : motion;
        const easing = style.getPropertyValue('--judger-ease').trim() || 'ease';
        const rows = Array.from(
            container.querySelectorAll<HTMLElement>('[data-case-id]'),
        );
        for (const row of rows) {
            // The previous step may still be in flight; its transform would be
            // read as part of the new position.
            for (const animation of row.getAnimations()) {
                animation.cancel();
            }
            const before = dragVisualTops.current.get(Number(row.dataset.caseId));
            const top = row.getBoundingClientRect().top;
            if (before === undefined || before === top) {
                continue;
            }
            row.animate(
                [
                    { transform: `translateY(${before - top}px)` },
                    { transform: 'none' },
                ],
                { duration, easing },
            );
        }
    }, [dragId, dropSlot]);

    // Session-only view filter. It starts from the global `hiddenStatuses`
    // preference but never writes back to it.
    const [filter, setFilter] = useState<StatusFilter>(() =>
        initialFilter(window.judgePreferences?.hiddenStatuses),
    );
    const [generatedJson, setGeneratedJson] = useState<any | null>(null);
    const [liveUserCount, setLiveUserCount] = useState<number>(0);
    const [extLogs, setExtLogs] = useState<string>('');
    const [stressGeneratorPath, setStressGeneratorPath] = useState('');
    const [stressStdPath, setStressStdPath] = useState('');
    const [stressIterations, setStressIterations] = useState(0);
    const [stressRunning, setStressRunning] = useState(false);
    const [stressProgress, setStressProgress] = useState({
        iteration: 0,
        total: 1000,
    });
    const [stressMessage, setStressMessage] = useState<string | null>(null);
    // The antivirus hint appears on its own once anything times out. It has to
    // be dismissable, or a single TLE leaves it on screen for the rest of the
    // session; it comes back for the next problem.
    const [avHintDismissed, setAvHintDismissed] = useState(false);
    const [pendingStressFailure, setPendingStressFailure] =
        useState<StressFailureCommand | null>(null);
    const [stressDialogVisible, setStressDialogVisible] = useState(false);
    const stressRunIdRef = React.useRef<number | null>(null);
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
        (testCase) => !testCase.testcase.disabled && testCase.result?.pass === true,
    ).length;
    useEffect(() => {
        if (infoPageVisible || stressDialogVisible || settingsPageVisible) {
            document.body.classList.add('no-scroll');
        } else {
            document.body.classList.remove('no-scroll');
        }
    }, [infoPageVisible, stressDialogVisible, settingsPageVisible]);

    useEffect(() => {
        if (stressRunIdRef.current !== null) {
            sendMessageToVSCode({
                command: 'stress-stop',
                runId: stressRunIdRef.current,
            });
            stressRunIdRef.current = null;
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
        // Auxiliary surfaces must not survive a problem switch: the settings
        // draft would otherwise apply to the wrong problem.
        setSettingsPageVisible(false);
        setAuxOpen(false);
        setCaseMenu(null);
        setDragId(null);
        setDropSlot(null);
        dragGeometry.current = null;
        setAvHintDismissed(false);
        setRunningIds([]);
        setCheckingIds([]);
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
        if (!window.showLiveUserCount) { return; }
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
                testcaseDropHintDismissed: vscodeState?.testcaseDropHintDismissed ?? false,
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
    useEffect(() => {
        const onImportMessage = (event: MessageEvent<VSToWebViewMessage>) => {
            const data = event.data;
            if (data.command === 'show-json-import' && data.srcPath === problem.srcPath) {
                setImportPageVisible(true);
            }
        };
        window.addEventListener('message', onImportMessage);
        return () => window.removeEventListener('message', onImportMessage);
    }, [problem.srcPath]);
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
                    setRunningIds((previous) =>
                        previous.includes(data.id) ? previous : [...previous, data.id],
                    );
                    break;
                }
                case 'checking': {
                    handleChecking(data);
                    setCheckingIds((previous) =>
                        previous.includes(data.id) ? previous : [...previous, data.id],
                    );
                    break;
                }
                case 'not-running': {
                    setRunningIds([]);
                    setCheckingIds([]);
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
                            `${t('stressRunning')} ${role} ${status.iteration || 0}${status.total ? ` / ${status.total}` : ''}`,
                        );
                    }
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
        // A filter must never make the new testcase invisible.
        setFilter('all');
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
        sendMessageToVSCode({ command: 'run-all-and-save', problem });
    };

    const pickStressFile = (role: 'generator' | 'std') => {
        sendMessageToVSCode({
            command: 'pick-stress-file',
            role,
        });
    };

    const handleTestcaseDrop = async (event: React.DragEvent<HTMLDivElement>) => {
        // Leave text dragged into editors alone; imports must contain files or resource paths.
        const paths = droppedPaths(event.dataTransfer);
        if (!paths.length && !event.dataTransfer.files.length) { return; }
        event.preventDefault();
        event.stopPropagation();
        const srcPath = problem.srcPath;
        try {
            if (paths.length) { sendMessageToVSCode({ command: 'drop-testcases', srcPath, paths }); }
            else {
                const payload = await droppedContents(event.dataTransfer);
                if (payload.files.length) { sendMessageToVSCode({ command: 'drop-testcases', srcPath, ...payload }); }
                else { notify(t('dropReadFailed')); }
            }
        } catch (error) { notify(t(error instanceof Error && error.message === 'dropTooLarge' ? 'dropTooLarge' : 'dropReadFailed')); }
    };

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

    /** The bottom bar has one stop button, so it routes to the active task. */
    const stopActiveTask = () => {
        if (stressRunning) {
            stopStress();
            return;
        }
        stop();
    };

    const renderStressDialog = () => {
        if (!stressDialogVisible) {
            return null;
        }

        return (
            <StressDialog
                generatorPath={stressGeneratorPath}
                stdPath={stressStdPath}
                iterations={stressIterations}
                running={stressRunning}
                message={stressMessage}
                progress={stressProgress}
                failure={pendingStressFailure}
                onPickGenerator={() => pickStressFile('generator')}
                onPickStd={() => pickStressFile('std')}
                onIterationsChange={setStressIterations}
                onStart={startStress}
                onStop={stopStress}
                onClose={closeStressDialog}
                onCopyInstructions={copyStressInstructions}
                onViewGeneratorExample={viewGeneratorExample}
            />
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
                        ...testCase.testcase,
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

    const openCheckerFile = () => {
        const checkerPath = problem.customCheckerPath?.trim();
        if (checkerPath) {
            sendMessageToVSCode({
                command: 'open-file',
                path: checkerPath,
            });
        }
    };

    /** Settings drafts are merged by the host so they cannot clobber testcases. */
    const applySettings = (patch: Partial<Problem>) => {
        setSettingsPageVisible(false);
        sendMessageToVSCode({
            command: 'problem-patch',
            srcPath: problem.srcPath,
            patch,
        });
    };

    // Low-frequency configuration moved off the main panel into the settings page.
    const advancedSettings = (
        <>
            <div className="settings-subgroup">
                <h4>{t('customChecker')}</h4>
                <label className="settings-field">
                    <span>{t('interactorPath')}</span>
                    <input
                        type="text"
                        className="selectable"
                        value={problem.interactorPath || ''}
                        onChange={(event) =>
                            updateProblem({
                                ...problem,
                                interactorPath: event.target.value,
                            })
                        }
                    />
                </label>
                <div className="settings-inline">
                    <input
                        type="text"
                        className="selectable"
                        placeholder={t('customCheckerPathPlaceholder')}
                        value={problem.customCheckerPath || ''}
                        onChange={(event) =>
                            updateCheckerPath(event.target.value)
                        }
                        ref={checkerInputRef}
                    />
                    <button
                        type="button"
                        className="btn btn-black"
                        title={t('openFile')}
                        aria-label={t('openFile')}
                        onClick={openCheckerFile}
                        disabled={!problem.customCheckerPath?.trim()}
                    >
                        <i
                            className="codicon codicon-link-external"
                            aria-hidden="true"
                        ></i>
                    </button>
                </div>
                <details className="usage-instructions">
                    <summary>{t('usageInstructions')}</summary>
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
                            {window.pythonCommand} &lt;script-path&gt;
                            &lt;input-file&gt; &lt;output-file&gt;
                        </code>
                        <ul>
                            <li>
                                <b>&lt;script-path&gt;</b>: {t('argScriptPath')}
                            </li>
                            <li>
                                <b>&lt;input-file&gt;</b>: {t('argInputFile')}
                            </li>
                            <li>
                                <b>&lt;output-file&gt;</b>: {t('argOutputFile')}
                            </li>
                        </ul>
                        {t('expectedBehavior')}
                        <br />
                        <textarea
                            className="selectable usage-example"
                            readOnly
                            value={`with open(sys.argv[1], "r") as f:
    test_input = f.read()
with open(sys.argv[2], "r") as f:
    code_output = f.read()`}
                        />
                        <br />
                        <a
                            href={`${projectUrl}/blob/main/docs/user-guide.md#custom-checker`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-black"
                        >
                            <i className="codicon codicon-book" aria-hidden="true"></i>{' '}
                            {t('documentation')}
                        </a>
                    </small>
                </details>
            </div>
        </>
    );

    /*
     * Reordering is local. `cases` is the order — the effect above mirrors it
     * into `problem.tests`, which the debounced save then writes out — so a
     * drop only has to splice the array. Nothing crosses the host boundary.
     */
    const moveCase = (fromId: number, toId: number, after: boolean) => {
        updateCases((previous) => {
            const from = previous.findIndex((value) => value.id === fromId);
            if (from < 0 || fromId === toId) {
                return previous;
            }
            const next = [...previous];
            const [moved] = next.splice(from, 1);
            const target = next.findIndex((value) => value.id === toId);
            if (target < 0) {
                return previous;
            }
            const at = after ? target + 1 : target;
            if (at === from) {
                return previous;
            }
            next.splice(at, 0, moved);
            return next;
        });
    };

    /*
     * Where the dragged row would land, as the row it goes next to and which
     * side of it. Measured against the slots captured at dragstart rather than
     * against the live layout: the rows are already moving under the pointer,
     * so re-measuring them would chase its own tail.
     */
    const dragLanding = (): { toId: number; after: boolean } | null => {
        const geometry = dragGeometry.current;
        if (dragId === null || dropSlot === null || !geometry) {
            return null;
        }
        const ids = geometry.map((slot) => slot.id);
        const from = ids.indexOf(dragId);
        if (from < 0) {
            return null;
        }
        const rest = ids.filter((id) => id !== dragId);
        if (!rest.length) {
            return null;
        }
        // Past its own slot the dragged row is no longer one of the rows it is
        // being inserted between, hence the shift.
        const insert = dropSlot - (dropSlot > from ? 1 : 0);
        // Back where it started is not a landing at all: committing it would
        // shuffle whichever rows the filter is hiding, for no visible gain.
        if (insert === from) {
            return null;
        }
        return insert >= rest.length
            ? { toId: rest[rest.length - 1], after: true }
            : { toId: rest[insert], after: false };
    };

    /*
     * Live preview. Flexbox `order` moves the rows without moving a single DOM
     * node, and that is the point: detaching the row under the pointer would end
     * the drag before the user ever let go.
     */
    const previewOrder = (() => {
        const landing = dragLanding();
        const geometry = dragGeometry.current;
        if (!landing || !geometry || dragId === null) {
            return null;
        }
        const rest = geometry
            .map((slot) => slot.id)
            .filter((id) => id !== dragId);
        const at = rest.indexOf(landing.toId) + (landing.after ? 1 : 0);
        const ordered = [...rest.slice(0, at), dragId, ...rest.slice(at)];
        return new Map(ordered.map((id, index) => [id, index]));
    })();

    /*
     * The drop side is positional, not per-row, so one pair of handlers serves
     * every row and the gaps between them alike — and the list container itself
     * carries them, so letting go in a gap still lands instead of falling
     * through to the panel's own file-drop target. Both stand down for a drag
     * that is not a reorder, leaving those to the import path.
     */
    const onCaseDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        const container = resultsRef.current;
        const geometry = dragGeometry.current;
        if (dragId === null || !container || !geometry) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        const y =
            event.clientY -
            container.getBoundingClientRect().top +
            container.scrollTop;
        // Past a row's midpoint the gap opens after it; past the last row it
        // opens at the end.
        let slot = geometry.length;
        for (let i = 0; i < geometry.length; i++) {
            if (y < (geometry[i].top + geometry[i].bottom) / 2) {
                slot = i;
                break;
            }
        }
        if (slot === dropSlot) {
            return;
        }
        // Note where the rows are on screen right now, mid-slide included, so
        // the step about to happen travels from what the user is looking at
        // rather than snapping back to the last slot it finished on.
        const tops = new Map<number, number>();
        for (const row of Array.from(
            container.querySelectorAll<HTMLElement>('[data-case-id]'),
        )) {
            tops.set(Number(row.dataset.caseId), row.getBoundingClientRect().top);
        }
        dragVisualTops.current = tops;
        setDropSlot(slot);
    };

    const onCaseDrop = (event: React.DragEvent<HTMLDivElement>) => {
        if (dragId === null) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const landing = dragLanding();
        if (landing) {
            moveCase(dragId, landing.toId, landing.after);
        }
        setDragId(null);
        setDropSlot(null);
        dragGeometry.current = null;
    };

    const caseDrag = (id: number, position: number): CaseDrag => ({
        id,
        dragging: dragId === id,
        // Negative, so the list's non-reorderable siblings — the filter notice
        // stay after every reorderable row.
        order: previewOrder?.get(id) ?? position - cases.length,
        onStart: (event) => {
            // Claim the gesture before the panel's own drop target sees it: this
            // is a reorder, not an import of files dragged in from the
            // workbench.
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(id));
            setCaseMenu(null);
            setAuxOpen(false);
            // Anything the previous drag left behind would be read as this
            // drag's starting position.
            dragVisualTops.current = new Map();
            const container = resultsRef.current;
            const rows = container
                ? Array.from(
                      container.querySelectorAll<HTMLElement>('[data-case-id]'),
                  )
                : [];
            // Measured in the list's own coordinates, so scrolling mid-drag
            // does not invalidate the slots.
            const base = container
                ? container.getBoundingClientRect().top - container.scrollTop
                : 0;
            dragGeometry.current = rows.map((row) => {
                const rect = row.getBoundingClientRect();
                return {
                    id: Number(row.dataset.caseId),
                    top: rect.top - base,
                    bottom: rect.bottom - base,
                };
            });
            setDragId(id);
            setDropSlot(dragGeometry.current.findIndex((slot) => slot.id === id));
        },
        onEnd: () => {
            setDragId(null);
            setDropSlot(null);
            dragGeometry.current = null;
        },
    });

    // One render path for every ordinary testcase. The filter only hides rows; it
    // never changes which testcases a run covers.
    const visibleCases = cases
        .map((value, index) => ({ value, num: index + 1 }))
        .filter(({ value }) => matchesFilter(value, filter));

    const views: JSX.Element[] = visibleCases.map(({ value, num }, position) => (
        <CaseView
            notify={notify}
            num={num}
            case={value}
            rerun={rerun}
            key={value.id.toString()}
            doFocus={focusLast && num === cases.length}
            forceRunning={getRunningProp(value)}
            forceChecking={getCheckingProp(value)}
            updateCase={updateCase}
            expandOnResult={expandAfterRun(window.judgePreferences?.expandBehavior ?? 'failed', cases, value.id)}
            more={(anchor) => {
                // The two "⋯" menus are alternatives, never open together, and
                // pressing the same button again closes this one.
                setAuxOpen(false);
                setCaseMenu((current) =>
                    current?.id === value.id ? null : { id: value.id, anchor },
                );
            }}
            openFile={filePath => sendMessageToVSCode({ command: 'open-file', path: filePath })}
            customCheckerPath={problem.customCheckerPath}
            drag={caseDrag(value.id, position)}
            stop={() => sendMessageToVSCode({ command: 'kill-running', problem, testcaseId: value.id })}
        />
    ));
    if (focusLast) { debounceFocusLast(); }

    const renderSubmitButton = (className = '') => {
        if (problem.browserSubmissionAvailable) {
            let nativeSubmissionAvailable = false;
            try {
                const hostname = new URL(problem.url).hostname;
                nativeSubmissionAvailable =
                    hostname.endsWith('codeforces.com') ||
                    hostname === 'open.kattis.com' ||
                    hostname.endsWith('cses.fi');
            } catch {
                // The browser submission resolver already validated the URL.
            }
            return (
                <button
                    className={`btn ${className} ${
                        waitingForSubmit ? 'is-waiting' : ''
                    }`}
                    disabled={waitingForSubmit}
                    aria-live="polite"
                    onClick={() => {
                        setWaitingForSubmit(true);
                        sendMessageToVSCode({
                            command:
                                problem.browserSubmissionKind === 'custom' ||
                                !nativeSubmissionAvailable
                                    ? 'submitBrowser'
                                    : 'submitWithChoice',
                            problem,
                        });
                    }}
                >
                    {waitingForSubmit ? (
                        <span className="submit-waiting-copy">
                            <span>{t('preparingSubmissionForm')}</span>
                        </span>
                    ) : (
                        <>
                            <span className="icon">
                                <i className="codicon codicon-cloud-upload"></i>
                            </span>{' '}
                            <span className="action-text">{t('submit')}</span>
                        </>
                    )}
                </button>
            );
        }
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
                        <span className="action-text">{t('confirm')}</span>
                    ) : (
                        <>
                            <span className="icon">
                                <i className="codicon codicon-cloud-upload"></i>
                            </span>{' '}
                            <span className="action-text">{t('submit')}</span>
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
                                        <span className="action-text">{t('submit')}</span>
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

        return (
            <JudgeInfoPage
                generatedJson={generatedJson}
                logs={storedLogs}
                extLogs={extLogs}
                liveUserCount={liveUserCount}
                projectUrl={projectUrl}
                userGuideHref={`${projectUrl}/blob/main/extensions/shortestpath.judger/${userGuidePath}`}
                editableStateText={editableStateText}
                onEditableStateTextChange={setEditableStateText}
                onSaveState={saveDebugState}
                onClearState={clearState}
                onClose={() => setInfoPageVisible(false)}
            />
        );
    };

    const renderTimeoutAVSuggestion = () => {
        const hinted =
            !avHintDismissed &&
            cases.some((testCase) => {
                return (
                    testCase.result?.timeOut ||
                    testCase.result?.signal == 'SIGTERM'
                );
            });
        if (!hinted) {
            return <></>;
        }
        return (
            <div className="timeout-av-suggestion">
                <div className="timeout-av-head">
                    <h5>
                        <i className="codicon codicon-bug"></i>{' '}
                        {t('antivirusTitle')}
                    </h5>
                    <button
                        type="button"
                        className="icon-btn"
                        title={t('close')}
                        aria-label={t('close')}
                        onClick={() => setAvHintDismissed(true)}
                    >
                        <i className="codicon codicon-close" aria-hidden="true" />
                    </button>
                </div>
                <p>{t('antivirusDescription')}</p>
            </div>
        );
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

        updateCases((prevCases) => [...(window.judgePreferences?.clearBeforeLoad ? [] : prevCases), ...generatedCases]);
        setFilter('all');
        setFocusLast(true);
    };

    const ordinarySummary = summarize(cases);
    const counts = filterCounts(cases);
    const summary: Summary = {
        passed: ordinaryPassed,
        total: ordinarySummary.total,
        pending: ordinarySummary.pending,
        failed: ordinarySummary.failed,
        empty: ordinarySummary.empty,
    };
    const runningNow = cases.some(
        (value) => runningIds.includes(value.id) && value.result === null,
    );
    const checkingNow = !runningNow && checkingIds.length > 0;
    const task: TaskKind = activeTask({
        compiling,
        running: runningNow,
        checking: checkingNow,
        stress: stressRunning,
    });
    const taskLabel =
        task === 'compiling'
            ? t('compiling')
            : task === 'stress'
              ? stressMessage || t('stressTesting')
                : task === 'running'
                  ? t('running')
                  : task === 'checking'
                    ? t('checking')
                    : t('taskIdle');
    // Only report a percentage when a real total exists.
    const taskProgress =
        task === 'stress'
              ? { value: stressProgress.iteration, total: stressProgress.total }
              : null;

    const userGuideHref = `${projectUrl}/blob/main/extensions/shortestpath.judger/${userGuidePath}`;

    // The menu holds an id rather than a snapshot, so it always shows the row as
    // it stands now — and disappears with it if the testcase is deleted.
    const menuCase = caseMenu
        ? cases.find((value) => value.id === caseMenu.id)
        : undefined;

    return (
        <div
            // Reordering claims its own dragenter/dragover/drop on the row, so
            // the panel only ever sees the file drags it is meant to import.
            onDragEnter={claimTestcaseDrag}
            onDragOver={claimTestcaseDrag}
            onDrop={handleTestcaseDrop}
            className={`ui ${
                webviewState.catCompanionEnabled ? 'cat-companion-active' : ''
            }`}
        >
            {notification && (
                <div className="notification" role="status">
                    {notification}
                </div>
            )}
            {infoPageVisible && renderInfoPage()}
            {settingsPageVisible && (
                <ProblemSettings
                    problem={problem}
                    running={runningNow}
                    onApply={applySettings}
                    onClose={() => setSettingsPageVisible(false)}
                    onOpenAdvancedActions={() =>
                        sendMessageToVSCode({ command: 'problem-actions', problem })
                    }
                    onOpenGlobalSettings={() =>
                        sendMessageToVSCode({ command: 'open-settings' })
                    }
                    advanced={advancedSettings}
                />
            )}
            {stressDialogVisible && renderStressDialog()}
            <ImportCases
                t={t}
                notify={notify}
                importPageVisible={importPageVisible}
                setImportPageVisible={setImportPageVisible}
                importCases={importCases}
            />
            <div className="judger-shell">
                <ProblemHeader
                    name={problem.name}
                    href={getHref()}
                    timeSpentMs={usesOjTimer ? elapsedOjTime(ojTimer, timerNow) : elapsedProblemTime(problem, timerNow)}
                    accepted={usesOjTimer ? ojTimer?.accepted === true : problem.timeAcceptedAtUnixMs !== undefined}
                    canMarkAccepted={!usesOjTimer}
                    onMarkAccepted={() => sendMessageToVSCode({ command: 'mark-accepted', srcPath: problem.srcPath })}
                    compiling={compiling}
                    summary={summary}
                    settingsOpen={settingsPageVisible}
                    auxOpen={auxOpen}
                    onOpenSettings={() => {
                        setAuxOpen(false);
                        setCaseMenu(null);
                        setSettingsPageVisible(true);
                    }}
                    onToggleAux={() => {
                        setCaseMenu(null);
                        setAuxOpen((value) => !value);
                    }}
                >
                    {auxOpen && (
                        <AuxMenu
                            projectUrl={projectUrl}
                            userGuideHref={userGuideHref}
                            catCompanionEnabled={!!webviewState.catCompanionEnabled}
                            deleteArmed={deleteProblemArmed}
                            onClose={() => setAuxOpen(false)}
                            tooltip={
                                showCompanionTooltip &&
                                !webviewState.catCompanionEnabled ? (
                                    <div className="feedback-tooltip">
                                        <span>{t('companionTooltip')}</span>
                                        <button
                                            type="button"
                                            className="feedback-tooltip-close"
                                            title={t('close')}
                                            aria-label={t('close')}
                                            onClick={() => {
                                                setShowCompanionTooltip(false);
                                                updateWebviewState({
                                                    ...webviewState,
                                                    hasSeenCompanionTooltip: true,
                                                });
                                            }}
                                        >
                                            <i
                                                className="codicon codicon-close"
                                                aria-hidden="true"
                                            ></i>
                                        </button>
                                    </div>
                                ) : undefined
                            }
                            onToggleCat={() =>
                                updateWebviewState({
                                    ...webviewState,
                                    catCompanionEnabled:
                                        !webviewState.catCompanionEnabled,
                                    hasSeenCompanionTooltip: true,
                                })
                            }
                            onOpenInfo={showInfoPage}
                            onDeleteProblem={deleteTcs}
                            onOpenGlobalSettings={() =>
                                sendMessageToVSCode({ command: 'open-settings' })
                            }
                        />
                    )}
                </ProblemHeader>
                {window.remoteMessage && window.remoteMessage.trim() !== '' && (
                    <div className="remote-message-banner">
                        <p
                            dangerouslySetInnerHTML={{
                                __html: window.remoteMessage,
                            }}
                        />
                    </div>
                )}
                <div className="judger-body">
                    <TestcaseToolbar
                        filter={filter}
                        counts={counts}
                        total={cases.length}
                        onFilterChange={setFilter}
                        onImport={(source) => {
                            if (source === 'json') { setImportPageVisible(true); return; }
                            sendMessageToVSCode({ command: ({ zip: 'import-testcase-zip', files: 'import-testcase-files', folder: 'import-testcase-folder' } as const)[source], srcPath: problem.srcPath });
                        }}
                        onAdd={newCase}
                        dropHintDismissed={webviewState.testcaseDropHintDismissed}
                        onDismissDropHint={() => updateWebviewState({ ...webviewState, testcaseDropHintDismissed: true })}
                    />
                    <div
                        className="results"
                        ref={resultsRef}
                        onDragOver={onCaseDragOver}
                        onDrop={onCaseDrop}
                    >
                        {views.length === 0 && cases.length > 0 && (
                            <div className="results-empty">
                                <span>{t('noCasesMatchFilter')}</span>
                                <button
                                    type="button"
                                    className="btn btn-black"
                                    onClick={() => setFilter('all')}
                                >
                                    {t('resetFilter')}
                                </button>
                            </div>
                        )}
                        {views}
                    </div>
                </div>
                <TaskStatusBar
                    task={task}
                    label={taskLabel}
                    progress={taskProgress}
                    onlineJudgeEnv={onlineJudgeEnv}
                    onToggleOnlineJudge={toggleOnlineJudgeEnv}
                    warning={renderTimeoutAVSuggestion()}
                />
                <JudgeActionBar
                    running={task === 'running' || task === 'checking' || task === 'stress'}
                    submitButton={renderSubmitButton('submit-action')}
                    onRunAll={runAll}
                    onStop={stopActiveTask}
                    onStress={() => {
                        setAuxOpen(false);
                        setStressDialogVisible(true);
                    }}
                />
                {webviewState.catCompanionEnabled && (
                    <div className="judger-companion">
                        <CatCompanion
                            enabled={webviewState.catCompanionEnabled}
                            total={ordinarySummary.total}
                            numPassed={ordinaryPassed}
                        />
                    </div>
                )}
                {caseMenu && menuCase && (
                    <CaseActionsMenu
                        key={caseMenu.id}
                        anchor={caseMenu.anchor}
                        state={{
                            disabled: menuCase.testcase.disabled === true,
                            hasResult: menuCase.result !== null,
                            inputIsFile: !!menuCase.testcase.inputPath,
                            outputIsFile: !!menuCase.testcase.outputPath,
                        }}
                        onAction={(action, mode) =>
                            sendMessageToVSCode({
                                command: 'testcase-action',
                                problem,
                                id: menuCase.id,
                                action,
                                mode,
                                result: menuCase.result,
                            })
                        }
                        onClose={() => setCaseMenu(null)}
                    />
                )}
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
    const sourceRef = useRef(problem?.srcPath);
    const resultsBySource = useRef(new Map<string, Map<number, { testcase: TestCase; result: RunResult }>>());
    sourceRef.current = problem?.srcPath;
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
            const executed = data.problem.tests.find(test => test.id === data.result.id);
            if (!sameTestcase(executed, previousCases[idx].testcase)) { return previousCases; }
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
                case 'problem-options': {
                    if (sourceRef.current !== data.srcPath) { break; }
                    if (data.clear) { resultsBySource.current.delete(data.srcPath); setCases(previous => previous.map(value => ({ ...value, result: null }))); }
                    else { setProblem(previous => previous ? { ...previous, ...data.patch } : previous); }
                    break;
                }
                case 'testcase-changed': {
                    resultsBySource.current.get(data.srcPath)?.delete(data.testcase.id);
                    if (sourceRef.current !== data.srcPath) { break; }
                    setCases(previous => {
                        // The host already confirmed the deletion; drop by id only,
                        // never by rewriting a stale problem snapshot.
                        if (data.action === 'delete') {
                            return previous.filter(value => value.id !== data.testcase.id);
                        }
                        const index = previous.findIndex(value => value.id === data.testcase.id);
                        if (index < 0) { return previous; }
                        const next = [...previous];
                        if (data.action === 'up' || data.action === 'down') {
                            const destination = index + (data.action === 'up' ? -1 : 1);
                            if (destination >= 0 && destination < next.length) { [next[index], next[destination]] = [next[destination], next[index]]; }
                        } else {
                            const testcase = { ...next[index].testcase };
                            if (data.action === 'disable') { testcase.disabled = data.testcase.disabled; }
                            else if (data.action === 'input') { testcase.input = data.testcase.input; testcase.inputPath = data.testcase.inputPath; }
                            else if (data.action === 'output' || data.action === 'answer') { testcase.output = data.testcase.output; testcase.outputPath = data.testcase.outputPath; }
                            next[index] = { ...next[index], testcase, result: null };
                        }
                        return next;
                    });
                    break;
                }
                case 'testcases-imported': {
                    if (data.replace) { resultsBySource.current.delete(data.srcPath); }
                    if (sourceRef.current !== data.srcPath) { break; }
                    setCases(previous => {
                        let id = previous.reduce((max, value) => Math.max(max, value.id), 0);
                        return [...(data.replace ? [] : previous), ...data.tests.filter(test => data.replace || !previous.some(value => (test.inputPath || test.outputPath) && value.testcase.inputPath === test.inputPath && value.testcase.outputPath === test.outputPath)).map(test => { const testcase = { ...test, id: previous.some(value => value.id === test.id) || test.id <= id ? ++id : (id = test.id) }; return { id: testcase.id, testcase, result: null }; })];
                    });
                    break;
                }
                case 'browser-submission-availability': {
                    setProblem(current => current?.srcPath === data.srcPath ? { ...current, browserSubmissionAvailable: data.available, browserSubmissionKind: data.kind } : current);
                    break;
                }
                case 'new-problem': {
                    if (data.onlyIfActive && data.problem?.srcPath !== sourceRef.current) { break; }
                    if (data.problem === undefined) {
                        setShowFallback(true);
                    }

                    setProblem(data.problem);
                    setCases(getCasesFromProblem(data.problem).map(value => {
                        const cached = data.problem && resultsBySource.current.get(data.problem.srcPath)?.get(value.id);
                        return cached && sameTestcase(cached.testcase, value.testcase) ? { ...value, result: cached.result } : value;
                    }));
                    setOnlineJudgeEnv(data.onlineJudgeEnv ?? false);
                    break;
                }
                case 'run-single-result': {
                    const cache = resultsBySource.current.get(data.problem.srcPath) ?? new Map();
                    const testcase = data.problem.tests.find(test => test.id === data.result.id);
                    if (testcase) { cache.set(data.result.id, { testcase, result: data.result }); resultsBySource.current.set(data.problem.srcPath, cache); }
                    if (data.problem.srcPath !== sourceRef.current) { break; }
                    handleRunSingleResult(data);
                    break;
                }
                case 'update-online-judge-env': {
                    setOnlineJudgeEnv(data.value);
                    break;
                }
            }
        };
        return connectJudgeMessages(window, fn, vscodeApi);
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
                        <button
                            type="button"
                            className="btn btn-block"
                            onClick={createProblem}
                        >
                            <span className="icon">
                                <i className="codicon codicon-add"></i>
                            </span>{' '}
                            {t('createProblem')}
                        </button>
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
