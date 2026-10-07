import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ProblemHeader from './components/ProblemHeader';
import TestcaseToolbar from './components/TestcaseToolbar';
import TaskStatusBar from './components/TaskStatusBar';
import JudgeActionBar from './components/JudgeActionBar';
import TestCaseCard from './TestCaseCard';
import { filterCounts, StatusFilter, Summary } from './selectors';

/*
 * Design preview only. This entry renders the real layout components against
 * fixture data so the panel can be reviewed in a browser without a host. It is
 * NOT part of the shipped webview: nothing here runs a compiler, a judge or a
 * submission, and every number below is made up.
 */

const FIXTURE_TRANSLATIONS: Record<string, string> = {
    timeSpent: 'Time spent on this problem',
    completionStatus: 'Completion status',
    partialAccepted: 'Partial AC',
    markAccepted: 'Mark AC',
    markPartialAccepted: 'Mark Partial AC',
    cancelAccepted: 'Cancel AC',
    cancelPartialAccepted: 'Cancel Partial AC',
    compiling: 'Compiling',
    emptyTestcases: 'No runnable testcase',
    passedRate: 'passed',
    pendingLabel: 'pending',
    problemSettings: 'Problem settings',
    auxMenu: 'Help and more',
    filterLabel: 'Show',
    filterAll: 'All',
    filterPassed: 'Passed',
    filterFailed: 'Not passed',
    filterPending: 'Not run',
    disabled: 'Disabled',
    hiddenCount: '{count} hidden',
    importTestcases: 'Import Testcases',
    newTestcase: 'Add Testcase',
    testcaseDropHint:
        'Hold Shift while dragging ZIP files, testcase files, or folders into this panel.',
    setOnlineJudge: 'Set ONLINE_JUDGE',
    runAll: 'Run Testcases',
    moreActions: 'More actions',
    stop: 'Stop',
    stressTesting: 'Stress test',
    expand: 'Expand',
    minimize: 'Minimize',
    Passed: 'Passed',
    Failed: 'Failed',
    notRun: 'not run',
    running: 'Running',
    checking: 'Checking',
    runAgain: 'Run again',
    testcaseActions: 'Testcase actions',
    dataSection: 'Data',
    resultSection: 'Result',
    diagnosticsSection: 'Diagnostics',
    inputLabel: 'Input',
    expectedOutputLabel: 'Expected output',
    receivedOutputLabel: 'Actual output',
    standardError: 'Standard error',
    previewTruncated: 'Preview truncated. Open the file for the full output.',
    checkerLog: 'Checker log',
    timedOut: 'Timed out',
};

(window as any).translations = FIXTURE_TRANSLATIONS;

const summary: Summary = { passed: 3, total: 5, pending: 2, failed: 0, empty: false };

const fixtureCase = (
    num: number,
    state: 'pending' | 'running' | 'checking' | 'passed' | 'failed' | 'disabled' | 'skipped',
    verdict: string | undefined,
    time: string | undefined,
    body: React.ReactNode,
    minimized: boolean,
) => (
    <TestCaseCard
        key={num}
        detailsId={`preview-details-${num}`}
        title={`TC ${num}`}
        state={state}
        verdict={verdict}
        time={time}
        failureText="Wrong answer on token 4"
        minimized={minimized}
        toggle={() => {}}
        run={() => {}}
        stop={() => {}}
        more={() => {}}
    >
        {body}
    </TestCaseCard>
);

const inlineBody = (
    <div className="case-details-inner">
        <section className="case-section">
            <h4 className="case-section-title">Data</h4>
            <div className="textarea-container">
                Input
                <textarea className="selectable input-textarea" readOnly value={'4 6'} />
            </div>
            <div className="textarea-container expected-output-container">
                Expected output
                <textarea className="selectable expected-textarea" readOnly value={'3\n12'} />
            </div>
        </section>
        <section className="case-section">
            <h4 className="case-section-title">Result</h4>
            <div className="textarea-container">
                Actual output
                <textarea className="selectable received-textarea" readOnly value={'3\n11'} />
            </div>
        </section>
        <section className="case-section case-section-diagnostics">
            <h4 className="case-section-title">Diagnostics</h4>
            <div className="textarea-container">
                Standard error
                <textarea className="selectable stderror-textarea" readOnly value={'note: fixture data'} />
            </div>
        </section>
    </div>
);

const fileBody = (
    <div className="case-details-inner">
        <div className="file-reference">
            <span className="file-reference-label">Input</span>
            <span className="file-reference-name">sample-01.in</span>
            <span className="file-reference-path">…/tests/sample-01.in</span>
            <button type="button" className="btn btn-black">
                Open file
            </button>
            <button type="button" className="btn btn-black" title="Copy file path">
                <i className="codicon codicon-copy" aria-hidden="true"></i>
            </button>
        </div>
        <div className="file-reference">
            <span className="file-reference-label">Expected output</span>
            <span className="file-reference-name">sample-01.out</span>
            <span className="file-reference-path">…/tests/sample-01.out</span>
            <button type="button" className="btn btn-black">
                Open file
            </button>
            <button type="button" className="btn btn-black" title="Copy file path">
                <i className="codicon codicon-copy" aria-hidden="true"></i>
            </button>
        </div>
    </div>
);

function Panel(props: { width: number; label: string }) {
    const [filter, setFilter] = useState<StatusFilter>('all');
    const counts = filterCounts([]);
    const [task, setTask] = useState<'idle' | 'running' | 'compiling'>('running');

    return (
        <div className="preview-panel" style={{ width: props.width }}>
            <p className="preview-caption">{props.label}</p>
            <div className="ui preview-surface">
                <div className="judger-shell">
                    <ProblemHeader
                        name="A Very Long Fixture Problem Title That Wraps"
                        href="#"
                        accepted={false}
                        onMarkAccepted={() => {}}
                        timeSpentMs={754000}
                        compiling={task === 'compiling'}
                        summary={summary}
                        settingsOpen={false}
                        auxOpen={false}
                        onOpenSettings={() => {}}
                        onToggleAux={() => {}}
                    />
                    <div className="judger-body">
                        <TestcaseToolbar
                            filter={filter}
                            counts={{ ...counts, all: 5, passed: 3, failed: 1, pending: 1, disabled: 0 }}
                            total={5}
                            onFilterChange={setFilter}
                            onImport={() => {}}
                            onAdd={() => {}}
                        />
                        <div className="results">
                            {fixtureCase(1, 'passed', 'AC', '18 ms · 1.2 MiB', inlineBody, true)}
                            {fixtureCase(2, 'failed', 'WA', '21 ms · 1.4 MiB', inlineBody, false)}
                            {fixtureCase(3, 'running', undefined, undefined, inlineBody, true)}
                            {fixtureCase(4, 'pending', undefined, undefined, inlineBody, true)}
                            {fixtureCase(5, 'disabled', undefined, undefined, inlineBody, true)}
                            {fixtureCase(6, 'skipped', undefined, undefined, fileBody, false)}
                        </div>
                    </div>
                    <TaskStatusBar
                        task={task}
                        label={task === 'compiling' ? 'Compiling' : 'Running'}
                        progress={null}
                        onlineJudgeEnv={true}
                        onToggleOnlineJudge={() => setTask(task === 'idle' ? 'running' : 'idle')}
                    />
                    <JudgeActionBar
                        running={task !== 'idle'}
                        submitButton={
                            <button type="button" className="btn btn-black submit-action">
                                Submit
                            </button>
                        }
                        onRunAll={() => {}}
                        onStop={() => setTask('idle')}
                        onStress={() => {}}
                    />
                </div>
            </div>
        </div>
    );
}

function Preview() {
    return (
        <div className="preview-root">
            <h1>ShortestPath Judger — layout fixture</h1>
            <p className="preview-note">
                Fixture data only. No compiler, judge or submission is involved;
                the numbers and verdicts below are made up.
            </p>
            <div className="preview-row">
                <Panel width={720} label="Wide panel (editor area)" />
                <Panel width={320} label="Narrow panel (side bar)" />
            </div>
        </div>
    );
}

createRoot(document.getElementById('app')!).render(<Preview />);
