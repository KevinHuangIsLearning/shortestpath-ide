/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

#import <AppKit/AppKit.h>
#include <node_api.h>
#include <map>
#include <memory>

struct Gesture {
	const char* phase;
	NSInteger window;
	double x;
	double y;
	double timestamp;
};

struct Monitor {
	__strong id observer;
	napi_threadsafe_function callback;
};

static std::map<uint32_t, std::shared_ptr<Monitor>> monitors;
static uint32_t nextId = 1;

static void Deliver(napi_env env, napi_value callback, void*, void* data) {
	std::unique_ptr<Gesture> gesture(static_cast<Gesture*>(data));
	if (!env || !callback) {
		return;
	}
	napi_value args[5], receiver, result;
	napi_create_string_utf8(env, gesture->phase, NAPI_AUTO_LENGTH, &args[0]);
	napi_create_int32(env, static_cast<int32_t>(gesture->window), &args[1]);
	napi_create_double(env, gesture->x, &args[2]);
	napi_create_double(env, gesture->y, &args[3]);
	napi_create_double(env, gesture->timestamp, &args[4]);
	napi_get_undefined(env, &receiver);
	napi_call_function(env, receiver, callback, 5, args, &result);
}

static void Remove(const std::shared_ptr<Monitor>& monitor) {
	[NSEvent removeMonitor:monitor->observer];
	monitor->observer = nil;
	napi_release_threadsafe_function(monitor->callback, napi_tsfn_abort);
}

static void Cleanup(void*) {
	for (const auto& entry : monitors) {
		Remove(entry.second);
	}
	monitors.clear();
}

static napi_value Subscribe(napi_env env, napi_callback_info info) {
	napi_value callback = nullptr, name, result;
	size_t count = 1;
	napi_get_cb_info(env, info, &count, &callback, nullptr, nullptr);
	napi_valuetype type;
	if (count != 1 || napi_typeof(env, callback, &type) != napi_ok) {
		napi_throw_type_error(env, nullptr, "Trackpad subscriptions require a callback");
		return nullptr;
	}
	if (count != 1 || type != napi_function || ![NSThread isMainThread]) {
		napi_throw_type_error(env, nullptr, "Trackpad subscriptions require a main-thread callback");
		return nullptr;
	}
	auto monitor = std::make_shared<Monitor>();
	napi_create_string_utf8(env, "ShortestPath trackpad phases", NAPI_AUTO_LENGTH, &name);
	if (napi_create_threadsafe_function(env, callback, nullptr, name, 0, 1, nullptr, nullptr, nullptr, Deliver, &monitor->callback) != napi_ok) {
		napi_throw_error(env, nullptr, "Cannot create trackpad callback");
		return nullptr;
	}
	napi_unref_threadsafe_function(env, monitor->callback);
	// A local monitor observes only this app's events and returns every event
	// unchanged. It does not install a global event tap or need input monitoring.
	monitor->observer = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^NSEvent*(NSEvent* event) {
		if (!event.hasPreciseScrollingDeltas) {
			return event;
		}
		const char* phase = nullptr;
		if ((event.phase & NSEventPhaseBegan) && event.momentumPhase == NSEventPhaseNone) {
			phase = "begin";
		} else if (event.phase & NSEventPhaseCancelled) {
			phase = "cancel";
		} else if (event.phase & NSEventPhaseEnded) {
			phase = "end";
		}
		if (phase) {
			NSPoint point = event.locationInWindow;
			const double timestamp = ([NSDate date].timeIntervalSince1970 - (NSProcessInfo.processInfo.systemUptime - event.timestamp)) * 1000;
			auto gesture = new Gesture{phase, event.window ? event.window.windowNumber : -1, point.x, point.y, timestamp};
			if (napi_call_threadsafe_function(monitor->callback, gesture, napi_tsfn_nonblocking) != napi_ok) {
				delete gesture;
			}
		}
		return event;
	}];
	const uint32_t id = nextId++;
	monitors.emplace(id, monitor);
	napi_create_uint32(env, id, &result);
	return result;
}

static napi_value Unsubscribe(napi_env env, napi_callback_info info) {
	napi_value value, result;
	size_t count = 1;
	napi_get_cb_info(env, info, &count, &value, nullptr, nullptr);
	uint32_t id;
	if (count == 1 && napi_get_value_uint32(env, value, &id) == napi_ok) {
		auto found = monitors.find(id);
		if (found != monitors.end()) {
			Remove(found->second);
			monitors.erase(found);
		}
	}
	napi_get_undefined(env, &result);
	return result;
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
		{"unsubscribe", nullptr, Unsubscribe, nullptr, nullptr, nullptr, napi_default, nullptr},
		{"pointForWindow", nullptr, PointForWindow, nullptr, nullptr, nullptr, napi_default, nullptr}
	};
	napi_define_properties(env, exports, 3, properties);
	napi_add_env_cleanup_hook(env, Cleanup, nullptr);
	return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
