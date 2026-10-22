/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

#import <AppKit/AppKit.h>
#include <node_api.h>
#include <map>
#include <memory>
#include <algorithm>
#include <cmath>

struct Gesture {
	const char* phase;
	NSInteger window;
	double x;
	double y;
	uint32_t gesture;
	double amount;
};

enum class State {
	Idle,
	AwaitingApproval,
	Tracking,
};

// The page can permit a backward swipe to navigate its history or, when there
// is no previous page, to close the containing tab. Keeping that decision as a
// single value prevents the native monitor from combining incompatible flags.
enum class BackAction : int32_t {
	None,
	Navigate,
	Close,
};

struct Monitor {
	__strong id observer;
	__strong NSEvent* event;
	napi_threadsafe_function callback;
	uint32_t gesture = 0;
	bool disposed = false;
	State state = State::Idle;
	bool physicalEnded = false;
	BackAction backAction = BackAction::None;
	bool canGoForward = false;
	double horizontal = 0;
	double vertical = 0;
	NSInteger window = -1;
	NSPoint point;
};

static std::map<uint32_t, std::shared_ptr<Monitor>> monitors;
static uint32_t nextId = 1;
static constexpr CGFloat kSwipeCommitAmount = 0.3;

static void Deliver(napi_env env, napi_value callback, void*, void* data) {
	std::unique_ptr<Gesture> gesture(static_cast<Gesture*>(data));
	if (!env || !callback) { return; }
	napi_value args[6], receiver, result;
	napi_create_string_utf8(env, gesture->phase, NAPI_AUTO_LENGTH, &args[0]);
	napi_create_int32(env, static_cast<int32_t>(gesture->window), &args[1]);
	napi_create_double(env, gesture->x, &args[2]);
	napi_create_double(env, gesture->y, &args[3]);
	napi_create_uint32(env, gesture->gesture, &args[4]);
	napi_create_double(env, gesture->amount, &args[5]);
	napi_get_undefined(env, &receiver);
	napi_call_function(env, receiver, callback, 6, args, &result);
}

static void Send(const std::shared_ptr<Monitor>& monitor, const char* phase, double amount = 0) {
	if (monitor->disposed) { return; }
	auto gesture = new Gesture{phase, monitor->window, monitor->point.x, monitor->point.y, monitor->gesture, amount};
	if (napi_call_threadsafe_function(monitor->callback, gesture, napi_tsfn_nonblocking) != napi_ok) {
		delete gesture;
	}
}

// Leave the gesture id and its origin intact until after Send. A terminal
// callback may dispose the BrowserView synchronously once it reaches JS.
static void Finish(const std::shared_ptr<Monitor>& monitor) {
	monitor->state = State::Idle;
	monitor->physicalEnded = false;
	monitor->backAction = BackAction::None;
	monitor->canGoForward = false;
	monitor->event = nil;
}

static void Cancel(const std::shared_ptr<Monitor>& monitor) {
	Finish(monitor);
	Send(monitor, "cancel");
}

static void TryStart(const std::shared_ptr<Monitor>& monitor) {
	if (monitor->state != State::AwaitingApproval || !monitor->event
		|| std::max(monitor->horizontal, monitor->vertical) < 4) { return; }
	if (monitor->horizontal <= monitor->vertical) {
		Cancel(monitor);
		return;
	}
	NSEvent* event = monitor->event;
	// AppKit uses positive progress for back, matching scrollingDeltaX.
	const bool back = event.scrollingDeltaX > 0;
	if (event.scrollingDeltaX == 0 || !(back ? monitor->backAction != BackAction::None : monitor->canGoForward)) {
		Cancel(monitor);
		return;
	}
	monitor->state = State::Tracking;
	const uint32_t gesture = monitor->gesture;
	const BackAction backAction = monitor->backAction;
	const bool endOnBackRelease = back && backAction != BackAction::None;
	const bool canGoBack = backAction != BackAction::None;
	const bool canGoForward = monitor->canGoForward;
	[event trackSwipeEventWithOptions:NSEventSwipeTrackingLockDirection | NSEventSwipeTrackingClampGestureAmount
		dampenAmountThresholdMin:canGoForward ? -1 : 0
		max:canGoBack ? 1 : 0
		usingHandler:^(CGFloat amount, NSEventPhase phase, BOOL complete, BOOL* stop) {
			if (monitor->disposed || monitor->gesture != gesture || monitor->state != State::Tracking) {
				*stop = YES;
				return;
			}
			if ((phase & NSEventPhaseCancelled) || (phase & NSEventPhaseMayBegin)) {
				*stop = YES;
				Cancel(monitor);
				return;
			}
			if (phase & NSEventPhaseEnded) {
				// AppKit continues the tracking handler through its settle animation.
				// A backward swipe commits on the physical release for both history
				// navigation and closing a no-history tab. Stop before delivering the
				// terminal JS callback so AppKit cannot settle after the action starts.
				if (endOnBackRelease && amount >= kSwipeCommitAmount) {
					*stop = YES;
					Finish(monitor);
					Send(monitor, "end", amount);
					return;
				}
				monitor->physicalEnded = true;
			}
			if (complete) {
				const bool ended = monitor->physicalEnded;
				Finish(monitor);
				Send(monitor, ended ? "end" : "cancel", amount);
				return;
			}
			Send(monitor, "update", amount);
		}];
}

static void Remove(const std::shared_ptr<Monitor>& monitor) {
	monitor->disposed = true;
	Finish(monitor);
	[NSEvent removeMonitor:monitor->observer];
	monitor->observer = nil;
	napi_release_threadsafe_function(monitor->callback, napi_tsfn_abort);
}

static void Cleanup(void*) {
	for (const auto& entry : monitors) { Remove(entry.second); }
	monitors.clear();
}

static napi_value Subscribe(napi_env env, napi_callback_info info) {
	napi_value callback = nullptr, name, result;
	size_t count = 1;
	napi_get_cb_info(env, info, &count, &callback, nullptr, nullptr);
	napi_valuetype type;
	if (count != 1 || napi_typeof(env, callback, &type) != napi_ok || type != napi_function || ![NSThread isMainThread]) {
		napi_throw_type_error(env, nullptr, "Trackpad subscriptions require a main-thread callback");
		return nullptr;
	}
	auto monitor = std::make_shared<Monitor>();
	napi_create_string_utf8(env, "ShortestPath AppKit history swipe", NAPI_AUTO_LENGTH, &name);
	if (napi_create_threadsafe_function(env, callback, nullptr, name, 0, 1, nullptr, nullptr, nullptr, Deliver, &monitor->callback) != napi_ok) {
		napi_throw_error(env, nullptr, "Cannot create trackpad callback");
		return nullptr;
	}
	napi_unref_threadsafe_function(env, monitor->callback);
	// App-local monitoring needs no global input permission. Only page-approved
	// horizontal gestures are tracked; ordinary scrolling reaches Chromium.
	monitor->observer = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^NSEvent*(NSEvent* event) {
		if (monitor->disposed || !event.hasPreciseScrollingDeltas) { return event; }
		if (event.phase & NSEventPhaseBegan) {
			Finish(monitor);
			monitor->gesture++;
			if (!NSEvent.swipeTrackingFromScrollEventsEnabled || event.momentumPhase != NSEventPhaseNone
				|| (event.modifierFlags & (NSEventModifierFlagControl | NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagShift))) { return event; }
			monitor->state = State::AwaitingApproval;
			monitor->horizontal = 0;
			monitor->vertical = 0;
			monitor->window = event.window ? event.window.windowNumber : -1;
			monitor->point = event.locationInWindow;
			if (event.scrollingDeltaX != 0) { monitor->event = event; }
			monitor->horizontal += std::abs(event.scrollingDeltaX);
			monitor->vertical += std::abs(event.scrollingDeltaY);
			Send(monitor, "begin");
			TryStart(monitor);
			return event;
		}
		if (monitor->window != (event.window ? event.window.windowNumber : -1)) { return event; }
		if (monitor->state == State::AwaitingApproval && event.momentumPhase == NSEventPhaseNone) {
			if (event.phase & (NSEventPhaseEnded | NSEventPhaseCancelled)) {
				Cancel(monitor);
			} else if (event.phase & (NSEventPhaseBegan | NSEventPhaseChanged)) {
				// Preserve a horizontal initiating event while the page replies,
				// rather than replacing it with a zero-X jitter sample.
				if (event.scrollingDeltaX != 0) { monitor->event = event; }
				monitor->horizontal += std::abs(event.scrollingDeltaX);
				monitor->vertical += std::abs(event.scrollingDeltaY);
				TryStart(monitor);
			}
		}
		return event;
	}];
	const uint32_t id = nextId++;
	monitors.emplace(id, monitor);
	napi_create_uint32(env, id, &result);
	return result;
}

static napi_value Start(napi_env env, napi_callback_info info) {
	napi_value args[4];
	size_t count = 4;
	napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
	uint32_t id, gesture;
	int32_t back;
	bool forward;
	if (count != 4 || ![NSThread isMainThread] || napi_get_value_uint32(env, args[0], &id) != napi_ok
		|| napi_get_value_uint32(env, args[1], &gesture) != napi_ok || napi_get_value_int32(env, args[2], &back) != napi_ok
		|| napi_get_value_bool(env, args[3], &forward) != napi_ok
		|| back < static_cast<int32_t>(BackAction::None) || back > static_cast<int32_t>(BackAction::Close)) {
		napi_throw_type_error(env, nullptr, "Swipe tracking requires a subscription, gesture and navigation actions");
		return nullptr;
	}
	const auto found = monitors.find(id);
	if (found != monitors.end()) {
		const auto& monitor = found->second;
		if (monitor->state == State::AwaitingApproval && monitor->gesture == gesture) {
			monitor->backAction = static_cast<BackAction>(back);
			monitor->canGoForward = forward;
			if (monitor->backAction == BackAction::None && !forward) {
				Cancel(monitor);
			} else {
				TryStart(monitor);
			}
		}
	}
	return nullptr;
}

static napi_value Cancel(napi_env env, napi_callback_info info) {
	napi_value value;
	size_t count = 1;
	napi_get_cb_info(env, info, &count, &value, nullptr, nullptr);
	uint32_t id;
	if (count == 1 && napi_get_value_uint32(env, value, &id) == napi_ok) {
		const auto found = monitors.find(id);
		if (found != monitors.end()) { Finish(found->second); }
	}
	return nullptr;
}

static napi_value Unsubscribe(napi_env env, napi_callback_info info) {
	napi_value value;
	size_t count = 1;
	napi_get_cb_info(env, info, &count, &value, nullptr, nullptr);
	uint32_t id;
	if (count == 1 && napi_get_value_uint32(env, value, &id) == napi_ok) {
		const auto found = monitors.find(id);
		if (found != monitors.end()) {
			Remove(found->second);
			monitors.erase(found);
		}
	}
	return nullptr;
}

// Convert an event location to the current Electron content view's coordinates.
// The caller obtains a fresh handle from a live BrowserWindow for each event.
static napi_value PointForWindow(napi_env env, napi_callback_info info) {
	napi_value args[4], result;
	size_t count = 4;
	napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
	napi_get_undefined(env, &result);
	void* data;
	size_t size;
	int32_t window;
	double x, y;
	if (count != 4 || napi_get_buffer_info(env, args[0], &data, &size) != napi_ok || size != sizeof(void*)
		|| napi_get_value_int32(env, args[1], &window) != napi_ok
		|| napi_get_value_double(env, args[2], &x) != napi_ok || napi_get_value_double(env, args[3], &y) != napi_ok) {
		return result;
	}
	NSView* view = (__bridge NSView*)*static_cast<void**>(data);
	if (!view.window || view.window.windowNumber != window) {
		return result;
	}
	NSPoint point = [view convertPoint:NSMakePoint(x, y) fromView:nil];
	napi_create_object(env, &result);
	napi_value coordinate;
	napi_create_double(env, point.x - view.bounds.origin.x, &coordinate);
	napi_set_named_property(env, result, "x", coordinate);
	napi_create_double(env, view.isFlipped ? point.y - view.bounds.origin.y : NSMaxY(view.bounds) - point.y, &coordinate);
	napi_set_named_property(env, result, "y", coordinate);
	return result;
}

static napi_value Init(napi_env env, napi_value exports) {
	napi_property_descriptor properties[] = {
		{"subscribe", nullptr, Subscribe, nullptr, nullptr, nullptr, napi_default, nullptr},
		{"start", nullptr, Start, nullptr, nullptr, nullptr, napi_default, nullptr},
		{"cancel", nullptr, Cancel, nullptr, nullptr, nullptr, napi_default, nullptr},
		{"unsubscribe", nullptr, Unsubscribe, nullptr, nullptr, nullptr, napi_default, nullptr},
		{"pointForWindow", nullptr, PointForWindow, nullptr, nullptr, nullptr, napi_default, nullptr}
	};
	napi_define_properties(env, exports, 5, properties);
	napi_add_env_cleanup_hook(env, Cleanup, nullptr);
	return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
