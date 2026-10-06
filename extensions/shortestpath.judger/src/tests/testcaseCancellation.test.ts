const mockChild = { kill: jest.fn(), exitCode: null, signalCode: null, once: jest.fn() };
jest.mock('../executions', () => ({ runningBinaries: [mockChild] }));
jest.mock('../compiler', () => ({ runningCompilers: [] }));
import { beginTestcase, stopTestcase } from '../testcaseCancellation';
test('targeted stop rejects other sources and IDs and leaves the next testcase uncancelled', () => {
    const first = beginTestcase('/one.cpp', 1);
    stopTestcase('/two.cpp', 1); stopTestcase('/one.cpp', 2);
    expect(mockChild.kill).not.toHaveBeenCalled();
    stopTestcase('/one.cpp', 1);
    expect(mockChild.kill).toHaveBeenCalledTimes(1);
    expect(first.stopped()).toBe(true);
    first.dispose();
    const second = beginTestcase('/one.cpp', 2);
    expect(second.stopped()).toBe(false);
    second.dispose();
    stopTestcase('/one.cpp', 2);
    expect(mockChild.kill).toHaveBeenCalledTimes(1);
});
