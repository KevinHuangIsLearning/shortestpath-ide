/* eslint no-var: off */
import TelemetryReporter from '@vscode/extension-telemetry';
import * as vscode from 'vscode';

/** Valid name for a VS Code preference section for the extension */
export type prefSection =
    | 'general.saveLocation'
    | 'general.defaultLanguage'
    | 'general.defaultOnlineJudge'
    | 'general.timeOut'
    | 'general.hideStderrorWhenCompiledOK'
    | 'general.ignoreSTDERROR'
    | 'general.firstTime'
    | 'general.includeProblemIndex'
    | 'general.wordRegex'
    | 'general.useShortCodeForcesName'
    | 'general.useShortLuoguName'
    | 'general.useShortAtCoderName'
    | 'general.menuChoices'
    | 'language.c.Args'
    | 'language.c.SubmissionCompiler'
    | 'language.c.Command'
    | 'language.c.OutputArg'
    | 'language.cpp.Args'
    | 'language.cpp.SubmissionCompiler'
    | 'language.cpp.Command'
    | 'language.cpp.OutputArg'
    | 'language.csharp.Args'
    | 'language.csharp.SubmissionCompiler'
    | 'language.csharp.Command'
    | 'language.go.Args'
    | 'language.go.SubmissionCompiler'
    | 'language.go.Command'
    | 'language.rust.Args'
    | 'language.rust.SubmissionCompiler'
    | 'language.rust.Command'
    | 'language.java.Args'
    | 'language.java.SubmissionCompiler'
    | 'language.java.Command'
    | 'language.js.Args'
    | 'language.js.SubmissionCompiler'
    | 'language.js.Command'
    | 'language.python.Args'
    | 'language.python.SubmissionCompiler'
    | 'language.python.Command'
    | 'language.ruby.Args'
    | 'language.ruby.SubmissionCompiler'
    | 'language.ruby.Command'
    | 'language.haskell.Args'
    | 'language.haskell.SubmissionCompiler'
    | 'language.haskell.Command'
    | 'language.cangjie.Args'
    // | 'language.cangjie.SubmissionCompiler'  // Not support now
    | 'language.cangjie.Command'
    | 'general.retainWebviewContext'
    | 'general.autoShowJudge'
    | 'general.defaultLanguageTemplateFileLocation'
    | 'general.doTemplateFileVariableReplacement'
    | 'general.fileNameTemplate'
    | 'general.fileNameTemplateOverrides'
    | 'general.remoteServerAddress'
    | 'general.showLiveUserCount'
    | 'general.hideOutputDifference'
    | 'general.collectProblemsInRoot'
    | 'general.ojMapping'
    | 'general.defaultProblemSource'
    | 'general.vjudgeOjNames'
    | 'general.vjudgeOpenInBrowser'
    | 'general.vjudgeUrlSuffix'
    | 'general.vjudgeBrowserSplitRatio'
    | 'general.customSubmitScripts'
    | 'general.defaultSubmitMethod';

export type Language = {
    interpreter?: string;
    interpreterArgs?: string[];
    name: LangNames;
    compiler: string;
    args: string[];
    skipCompile: boolean;
};

export type LangNames =
    | 'python'
    | 'ruby'
    | 'c'
    | 'cpp'
    | 'cc'
    | 'cxx'
    | 'rust'
    | 'java'
    | 'js'
    | 'go'
    | 'hs'
    | 'csharp'
    | 'cangjie';

export type TestCase = {
    disabled?: boolean;
    inputPath?: string;
    outputPath?: string;
    input: string;
    output: string;
    id: number;
};

export type OjTimer = {
    mode: 'timed' | 'untimed';
    running: boolean;
    accepted: boolean;
    elapsedMs: number;
    capturedAtUnixMs: number;
};

export type Problem = {
    timeSpentMs?: number;
    storageRevision?: string;
    timeStartedAtUnixMs?: number;
    timeAcceptedAtUnixMs?: number;
    compilerCommand?: string;
    compilerArgs?: string[];
    interpreterCommand?: string;
    interpreterArgs?: string[];
    name: string;
    url: string;
    interactive: boolean;
    memoryLimit: number;
    timeLimit: number;
    group: string;
    tests: TestCase[];
    srcPath: string;
    local?: boolean;
    browserSubmissionAvailable?: boolean;
    browserSubmissionKind?: 'custom' | 'vjudge';
    customCheckerPath?: string;
    interactorPath?: string;
};

export type Case = {
    id: number;
    result: RunResult | null;
    testcase: TestCase;
};

export type Run = {
    stdoutPath?: string;
    stderrPath?: string;
    memoryBytes?: number;
    stdout: string;
    stderr: string;
    code: number | null;
    signal: string | null;
    time: number;
    timeOut: boolean;
    outputLimitExceeded?: boolean;
};

export type ExecutionFailureSummary = Pick<
    Run,
    'code' | 'signal' | 'timeOut' | 'outputLimitExceeded'
>;

export type CustomCheckerRun = {
    command: string;
    verdict?: 'AC' | 'WA' | 'PE' | 'FAIL' | 'PARTIAL' | 'TLE' | 'RE' | 'CE';
} & Run;

export type DiffLine = {
    lineNumber: number;
    expected: string | null;
    received: string | null;
    type: 'match' | 'changed' | 'missing' | 'extra';
};

export type TokenDiff = {
    token: string;
    status: 'match' | 'extra' | 'missing';
};

export type DiffResult = {
    preview?: boolean;
    isMatch: boolean;
    lines: DiffLine[];
    summary: string;
    tokenDiff: TokenDiff[];
};

export type RunResult = {
    verdict?: 'AC' | 'WA' | 'PE' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'OLE' | 'STOP' | 'FAIL' | 'PARTIAL';
    pass: boolean | null;
    id: number;
    diff?: DiffResult;
    checkerRun?: CustomCheckerRun;
} & Run;

export type WebviewMessageCommon = {
    problem: Problem;
};

export type RunSingleCommand = {
    command: 'run-single-and-save';
    id: number;
} & WebviewMessageCommon;

export type RunAllCommand = {
    command: 'run-all-and-save';
} & WebviewMessageCommon;

export type StressProgramRole = 'generator' | 'std';

export type StressStartCommand = {
    command: 'stress-start';
    runId: number;
    generatorPath?: string;
    stdPath?: string;
    iterations: number;
} & WebviewMessageCommon;

export type StressStopCommand = {
    command: 'stress-stop';
    runId?: number;
};

export type OpenStressExampleCommand = {
    command: 'open-stress-example';
    language: 'cpp';
    content: string;
};

export type PickStressFileCommand = {
    command: 'pick-stress-file';
    role: StressProgramRole;
};

export type CopyTextCommand = {
    command: 'copy-text';
    text: string;
};

export type StressFileSelectedCommand = {
    command: 'stress-file-selected';
    role: StressProgramRole;
    path: string;
};

export type OnlineJudgeEnv = {
    command: 'online-judge-env';
    value: string;
};

export type KillRunningCommand = {
    testcaseId?: number;
    command: 'kill-running';
} & WebviewMessageCommon;

export type SaveCommand = {
    command: 'save';
} & WebviewMessageCommon;

export type DeleteTcsCommand = {
    command: 'delete-tcs';
} & WebviewMessageCommon;

export type SubmitCf = {
    command: 'submitCf';
} & WebviewMessageCommon;

export type SubmitCSES = {
    command: 'submitCSES';
} & WebviewMessageCommon;

export type SubmitKattis = {
    command: 'submitKattis';
} & WebviewMessageCommon;

export type SubmitBrowser = {
    command: 'submitBrowser';
    problem: Problem;
};

export type SubmitWithChoice = {
    command: 'submitWithChoice';
    problem: Problem;
};

export type SubmitShortestPath = {
    command: 'submitShortestPath';
} & WebviewMessageCommon;

export type GetInitialProblem = {
    command: 'get-initial-problem';
};

export type CreateLocalProblem = {
    command: 'create-local-problem';
};

export type OpenUrl = {
    command: 'url';
    url: string;
};

export type GetExtLogs = {
    command: 'get-ext-logs';
};

export type SetHideOutputDiff = {
    command: 'set-hide-output-diff';
    value: boolean;
};

export type OpenSettings = {
    command: 'open-settings';
};

export type OpenFile = {
    command: 'open-file';
    path: string;
};

/**
 * One entry of a testcase card's "⋯" menu. The menu is drawn by the webview —
 * the host only executes the action it is handed, so the two menus in the panel
 * behave the same way.
 */
export type CaseAction =
    | 'disable'
    | 'clear'
    | 'up'
    | 'down'
    | 'input'
    | 'output'
    | 'compare'
    | 'answer'
    | 'delete';

/** How a file-backed input/output field should be edited, when the action needs it. */
export type CaseMode = 'choose' | 'toggle' | 'open' | 'empty';

export type WebviewToVSEvent =
    | { command: 'problem-actions'; problem: Problem }
    | { command: 'problem-patch'; srcPath: string; patch: Partial<Problem> }
    | { command: 'testcase-action'; problem: Problem; id: number; action: CaseAction; mode?: CaseMode; result?: RunResult | null }
    | { command: 'drop-testcases'; srcPath: string; paths?: string[]; files?: { name: string; base64: string }[]; folder?: boolean }
    | { command: 'mark-accepted'; srcPath: string }
    | { command: 'get-oj-timer'; srcPath: string; url: string; requestId: string }
    | { command: 'import-testcases' | 'import-testcase-zip' | 'import-testcase-files' | 'import-testcase-folder'; srcPath: string; pathOrUri?: string }
    | RunAllCommand
    | StressStartCommand
    | StressStopCommand
    | OpenStressExampleCommand
    | PickStressFileCommand
    | CopyTextCommand
    | GetInitialProblem
    | CreateLocalProblem
    | RunSingleCommand
    | KillRunningCommand
    | SaveCommand
    | DeleteTcsCommand
    | SubmitCf
    | SubmitCSES
    | OnlineJudgeEnv
    | SubmitKattis
    | SubmitShortestPath
    | SubmitBrowser
    | SubmitWithChoice
    | OpenUrl
    | GetExtLogs
    | SetHideOutputDiff
    | OpenSettings
    | OpenFile;

export type RunningCommand = {
    command: 'running';
    id: number;
} & WebviewMessageCommon;

export type CheckingCommand = {
    command: 'checking';
    id: number;
} & WebviewMessageCommon;

export type NotRunningCommand = {
    command: 'not-running';
};

export type ResultCommand = {
    command: 'run-single-result';
    result: RunResult;
} & WebviewMessageCommon;

export type CompilingStartCommand = {
    command: 'compiling-start';
};

export type CompilingStopCommand = {
    command: 'compiling-stop';
};

export type RunAllInWebViewCommand = {
    command: 'run-all';
};

export type WaitingForSubmitCommand = {
    command: 'waiting-for-submit';
};

export type SubmitFinishedCommand = {
    command: 'submit-finished';
};

export type BrowserSubmissionAvailabilityCommand = {
    command: 'browser-submission-availability';
    srcPath: string;
    available: boolean;
    kind?: 'custom' | 'vjudge';
};

export type NewProblemCommand = {
    onlyIfActive?: boolean;
    command: 'new-problem';
    problem: Problem | undefined;
    onlineJudgeEnv?: boolean;
};

export type RemoteMessageCommand = {
    command: 'remote-message';
    message: string;
};

export type ExtLogsCommand = {
    command: 'ext-logs';
    logs: string;
};

export type UpdateOnlineJudgeEnvCommand = {
    command: 'update-online-judge-env';
    value: boolean;
};

export type StressProgressCommand = {
    command: 'stress-progress';
    runId: number;
    iteration: number;
    total: number;
};

export type StressStatusCommand = {
    command: 'stress-status';
    runId: number;
    phase: 'compiling' | 'running';
    role?: StressProgramRole | 'target';
    iteration?: number;
    total?: number;
};

export type StressFailureCommand = {
    command: 'stress-failure';
    runId: number;
    iteration: number;
    testcase: TestCase;
    result: RunResult;
};

export type StressFinishedCommand = {
    command: 'stress-finished';
    runId: number;
    state: 'passed' | 'found' | 'stopped' | 'error';
    iteration: number;
    message?: string;
};

export type VSToWebViewMessage =
    | { command: 'oj-timer'; srcPath: string; url: string; requestId: string; timer?: OjTimer }
    | { command: 'problem-options'; srcPath: string; patch?: Partial<Problem>; clear?: boolean }
    | { command: 'testcase-changed'; srcPath: string; action: CaseAction; testcase: TestCase }
    | { command: 'show-json-import'; srcPath: string }
    | { command: 'testcases-imported'; srcPath: string; tests: TestCase[]; replace?: boolean }
    | ResultCommand
    | RunningCommand
    | CheckingCommand
    | StressProgressCommand
    | StressStatusCommand
    | StressFailureCommand
    | StressFinishedCommand
    | StressFileSelectedCommand
    | RunAllInWebViewCommand
    | CompilingStartCommand
    | CompilingStopCommand
    | WaitingForSubmitCommand
    | SubmitFinishedCommand
    | NotRunningCommand
    | RemoteMessageCommand
    | NewProblemCommand
    | BrowserSubmissionAvailabilityCommand
    | ExtLogsCommand
    | UpdateOnlineJudgeEnvCommand;

export type OjMappingEntry = {
    oj: string;
    ojName: string;
    contestIdRegex?: string;
    problemIdRegex?: string;
    problemSource?: import('./problemDisplay').ProblemSource;
};

export type CphEmptyResponse = {
    empty: true;
};

export type CphSubmitResponse = {
    url: string;
    empty: false;
    problemName: string;
    sourceCode: string;
    languageId: number;
};

export type WebViewpersistenceState = {
    testcaseDropHintDismissed?: boolean;
    dialogCloseDate: number;
    feedbackDialogCloseDate?: number;
    hasSeenFeedbackTooltip?: boolean;
    catCompanionEnabled?: boolean;
    totalLoads?: number;
    hasSeenCompanionTooltip?: boolean;
    rateDialogCloseDate?: number;
};

declare global {
    var reporter: TelemetryReporter;
    var extensionContext: vscode.ExtensionContext;
    var remoteMessage: string | undefined;
    var storedLogs: string;
    var logger: any;
}
