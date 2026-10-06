import { initializeProblemTimer, elapsedProblemTime } from '../problemTimer';
import { Problem } from '../types';

test('legacy duration migrates once, then elapsed time is timestamp subtraction across reloads', () => {
	const started = initializeProblemTimer({ timeSpentMs: 5000 } as Problem, 10000);
	expect([started.timeStartedAtUnixMs, elapsedProblemTime(started, 13000), initializeProblemTimer(started, 20000)]).toEqual([5000, 8000, started]);
});

test('AC freezes time at its saved timestamp', () => {
	const accepted = { timeStartedAtUnixMs: 10000, timeAcceptedAtUnixMs: 12345 } as Problem;
	expect([elapsedProblemTime(accepted, 14000), elapsedProblemTime(accepted, 999999), elapsedProblemTime({ timeStartedAtUnixMs: 20000 } as Problem, 10000)]).toEqual([2345, 2345, 0]);
});

import { elapsedOjTime, isShortestPathProblem } from '../problemTimer';
test('OJ clocks extrapolate only while timed and running, preserving server pause and AC', () => {
    const timer = { mode: 'timed' as const, running: true, accepted: false, elapsedMs: 5000, capturedAtUnixMs: 10000 };
    expect(elapsedOjTime(timer, 13000)).toBe(8000);
    expect(elapsedOjTime({ ...timer, running: false }, 13000)).toBe(5000);
    expect(elapsedOjTime({ ...timer, accepted: true }, 13000)).toBe(5000);
    expect(elapsedOjTime({ ...timer, mode: 'untimed' }, 13000)).toBe(5000);
    expect(elapsedOjTime(undefined, 13000)).toBeUndefined();
    expect(isShortestPathProblem('https://shortestpath.cn/problem/a/b/c')).toBe(true);
    expect(isShortestPathProblem('https://shortestpath.cn.example.org/problem/a/b/c')).toBe(false);
});

import { createOjTimerRequests } from '../problemTimer';
test('OJ responses cannot regress AC or apply an old source binding or previous effect', () => {
    const receive = jest.fn();
    const requests = createOjTimerRequests('/main.cpp', 'https://shortestpath.cn/problem/a/b/c', receive, 'current');
    const oldRequest = requests.next(), acceptedRequest = requests.next();
    const timer = { mode: 'timed' as const, running: false, accepted: true, elapsedMs: 5000, capturedAtUnixMs: 10000 };
    const response = { srcPath: '/main.cpp', url: 'https://shortestpath.cn/problem/a/b/c', requestId: acceptedRequest, timer };
    requests.apply(response);
    requests.apply({ ...response, requestId: oldRequest, timer: { ...timer, accepted: false, running: true } });
    const nextRequest = requests.next();
    requests.apply({ ...response, requestId: nextRequest, url: 'https://shortestpath.cn/problem/old/b/c' });
    requests.apply({ ...response, requestId: 'previous:99' });
    expect(receive.mock.calls).toEqual([[timer]]);
});


import { setProblemCompletion } from '../problemTimer';
test('partial AC freezes and switching to AC or cancelling excludes paused time', () => {
    const initial = { timeStartedAtUnixMs: 1000 } as Problem;
    const partial = setProblemCompletion(initial, 'partial', 3000);
    const accepted = setProblemCompletion(partial, 'accepted', 5000);
    const resumed = setProblemCompletion(accepted, 'none', 9000);
    expect([elapsedProblemTime(partial, 4000), elapsedProblemTime(accepted, 8000), elapsedProblemTime(resumed, 10000), resumed.timeAcceptedAtUnixMs, resumed.timePartialAcceptedAtUnixMs]).toEqual([2000, 2000, 3000, undefined, undefined]);
});


test('partial AC survives reload, is idempotent, and cancels at the frozen duration', () => {
	const partial = setProblemCompletion({ timeStartedAtUnixMs: 1000 } as Problem, 'partial', 3000);
	const reloaded = JSON.parse(JSON.stringify(partial)) as Problem;
	const resumed = setProblemCompletion(reloaded, 'none', 9000);
	expect([elapsedProblemTime(reloaded, 8000), setProblemCompletion(reloaded, 'partial', 7000), elapsedProblemTime(resumed, 10000)]).toEqual([2000, reloaded, 3000]);
});
