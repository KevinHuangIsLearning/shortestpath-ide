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
    | 'general.vjudgeBrowserSplitRatio';

export type Language = {
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
    input: string;
    output: string;
    id: number;
};

export type Problem = {
    name: string;
    url: string;
    interactive: boolean;
    memoryLimit: number;
    timeLimit: number;
    group: string;
    tests: TestCase[];
    srcPath: string;
    local?: boolean;
    customCheckerPath?: string;
    largeSampleDirectory?: string;
    largeSampleComparison?: LargeSampleComparisonOptions;
    largeSampleRunMode?: LargeSampleRunMode;
    largeSampleAnswerMode?: LargeSampleAnswerMode;
    largeSampleCheckerEnabled?: boolean;
    largeSampleCheckerPath?: string;
    largeSampleEnabled?: boolean;
    largeSampleSkippedCases?: string[];
};

export type LargeSampleRunMode = 'stop-on-failure' | 'run-all';
export type LargeSampleAnswerMode = 'auto' | 'out' | 'ans';
export type LargeSampleComparisonOptions = {
    ignoreTrailingWhitespace: boolean;
    ignoreBlankLines: boolean;
    ignoreOuterWhitespace: boolean;
    tokenCompare: boolean;
};
export type LargeSampleCase = {
    name: string;
    number: string;
    inputPath: string;
    answerPath: string;
    answerExtension: 'out' | 'ans';
};
export type LargeSampleDiagnostic = { file?: string; message: string };

export type Case = {
    id: number;
    result: RunResult | null;
    testcase: TestCase;
};

export type Run = {
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
    isMatch: boolean;
    lines: DiffLine[];
    summary: string;
    tokenDiff: TokenDiff[];
};

export type RunResult = {
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
    largeSampleRunId?: number;
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

export type PickLargeSampleDirectoryCommand = {
    command: 'pick-large-sample-directory';
};
export type ImportLargeSampleDirectoryCommand = {
    command: 'import-large-sample-directory';
    pathOrUri: string;
};
export type PickLargeSampleCheckerCommand = {
    command: 'pick-large-sample-checker';
};
export type ScanLargeSampleCommand = {
    command: 'scan-large-sample';
    directory: string;
    answerMode?: LargeSampleAnswerMode;
};
export type LargeSampleStartCommand = {
    command: 'large-sample-start';
    runId: number;
    problem: Problem;
    directory: string;
    comparison: LargeSampleComparisonOptions;
    runMode: LargeSampleRunMode;
    answerMode: LargeSampleAnswerMode;
    checkerEnabled: boolean;
    checkerPath?: string;
};
export type LargeSampleStopCommand = {
    command: 'large-sample-stop';
    runId?: number;
};
export type LargeSampleRunSingleCommand = {
    command: 'large-sample-run-single';
    runId: number;
    problem: Problem;
    directory: string;
    testcaseName: string;
    comparison: LargeSampleComparisonOptions;
    answerMode: LargeSampleAnswerMode;
    checkerEnabled: boolean;
    checkerPath?: string;
};
export type OpenLargeSampleFileCommand = {
    command: 'open-large-sample-file';
    path: string;
};

export type StressFileSelectedCommand = {
    command: 'stress-file-selected';
    role: StressProgramRole;
    path: string;
};

export type LargeSampleDirectorySelectedCommand = {
    command: 'large-sample-directory-selected';
    path: string;
};
export type LargeSampleCheckerSelectedCommand = {
    command: 'large-sample-checker-selected';
    path: string;
};

export type OnlineJudgeEnv = {
    command: 'online-judge-env';
    value: string;
};

export type KillRunningCommand = {
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

export type WebviewToVSEvent =
    | RunAllCommand
    | StressStartCommand
    | StressStopCommand
    | OpenStressExampleCommand
    | PickStressFileCommand
    | CopyTextCommand
    | PickLargeSampleDirectoryCommand
    | ImportLargeSampleDirectoryCommand
    | PickLargeSampleCheckerCommand
    | ScanLargeSampleCommand
    | LargeSampleStartCommand
    | LargeSampleRunSingleCommand
    | LargeSampleStopCommand
    | OpenLargeSampleFileCommand
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

export type NewProblemCommand = {
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

export type LargeSampleScanResultCommand = {
    command: 'large-sample-scan-result';
    directory: string;
    cases: LargeSampleCase[];
    diagnostics: LargeSampleDiagnostic[];
};
export type LargeSampleStatusCommand = {
    command: 'large-sample-status';
    runId: number;
    phase: 'scanning' | 'compiling' | 'running' | 'checking' | 'finished';
    index: number;
    total: number;
    name?: string;
    message?: string;
};
export type LargeSampleRunStartedCommand = {
    command: 'large-sample-run-started';
    runId: number;
};
export type LargeSampleCaseResultCommand = {
    command: 'large-sample-case-result';
    runId: number;
    index: number;
    total: number;
    testcase: LargeSampleCase;
    state: 'passed' | 'failed';
    outputPath: string;
    reason?: string;
    time?: number;
    execution?: ExecutionFailureSummary;
};
export type LargeSampleFailureCommand = {
    command: 'large-sample-failure';
    runId: number;
    index: number;
    total: number;
    testcase: LargeSampleCase;
    outputPath: string;
    stdout: string;
    stderr: string;
    answer: string;
    passed: false;
    reason: string;
    diff?: DiffResult;
    checkerRun?: CustomCheckerRun;
};
export type LargeSampleFinishedCommand = {
    command: 'large-sample-finished';
    runId: number;
    state: 'passed' | 'failed' | 'stopped' | 'error';
    passed: number;
    failed: number;
    skipped: number;
    message?: string;
};

export type VSToWebViewMessage =
    | ResultCommand
    | RunningCommand
    | CheckingCommand
    | StressProgressCommand
    | StressStatusCommand
    | StressFailureCommand
    | StressFinishedCommand
    | LargeSampleRunStartedCommand
    | StressFileSelectedCommand
    | LargeSampleDirectorySelectedCommand
    | LargeSampleCheckerSelectedCommand
    | LargeSampleScanResultCommand
    | LargeSampleStatusCommand
    | LargeSampleCaseResultCommand
    | LargeSampleFailureCommand
    | LargeSampleFinishedCommand
    | RunAllInWebViewCommand
    | CompilingStartCommand
    | CompilingStopCommand
    | WaitingForSubmitCommand
    | SubmitFinishedCommand
    | NotRunningCommand
    | RemoteMessageCommand
    | NewProblemCommand
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
