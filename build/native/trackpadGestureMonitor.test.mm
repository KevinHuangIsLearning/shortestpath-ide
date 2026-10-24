/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Compile as a standalone executable with the same AppKit and Node headers as
// the addon. Capture only its outgoing queue; exercise the production state machine.
#include "trackpadGestureMonitor.mm"
#include <cassert>
#include <vector>
#include <string>

static std::vector<Gesture> delivered;

napi_status napi_call_threadsafe_function(napi_threadsafe_function, void* data, napi_threadsafe_function_call_mode) {
	std::unique_ptr<Gesture> gesture(static_cast<Gesture*>(data));
	delivered.push_back(*gesture);
	return napi_ok;
}

static std::shared_ptr<Monitor> Begin(bool approved = true, BackAction back = BackAction::Navigate, bool forward = true) {
	delivered.clear();
	auto monitor = std::make_shared<Monitor>();
	monitor->state = State::AwaitingApproval;
	monitor->approved = approved;
	monitor->backAction = back;
	monitor->canGoForward = forward;
	return monitor;
}

static void ExpectTerminal(const std::shared_ptr<Monitor>& monitor, const char* phase) {
	Release(monitor);
	assert(monitor->state == State::Idle);
	assert(std::string(delivered.back().phase) == phase);
	const size_t count = delivered.size();
	Release(monitor);
	assert(delivered.size() == count);
}

int main() {
	@autoreleasepool {
		for (const int direction : {-1, 1}) {
			// Threshold and release are independent. Arbitrarily many stationary
			// samples between them must neither commit nor lose progress.
			auto monitor = Begin();
			Move(monitor, direction * 90, 0);
			for (int i = 0; i < 1000; i++) { Move(monitor, 0, 0); }
			for (const auto& event : delivered) { assert(std::string(event.phase) == "update"); }
			ExpectTerminal(monitor, "end");
			assert(delivered.back().amount == direction * kSwipeCommitAmount);

			monitor = Begin();
			Move(monitor, direction * 89, 0);
			ExpectTerminal(monitor, "cancel");

			monitor = Begin();
			Move(monitor, direction * 120, 0);
			Move(monitor, direction * -100, 0);
			ExpectTerminal(monitor, "cancel");

			monitor = Begin(false);
			Move(monitor, direction * 120, 0);
			ExpectTerminal(monitor, "cancel");
			monitor->approved = true;
			TryStart(monitor);
			assert(monitor->state == State::Idle);

			monitor = Begin(false);
			Move(monitor, direction * 120, 0);
			monitor->approved = true;
			TryStart(monitor);
			ExpectTerminal(monitor, "end");
		}
		auto monitor = Begin(true, BackAction::Close, false);
		Move(monitor, 120, 0);
		ExpectTerminal(monitor, "end");
		monitor = Begin(true, BackAction::None, true);
		Move(monitor, 120, 0);
		assert(monitor->state == State::Idle);
		monitor = Begin();
		Move(monitor, 10, 120);
		assert(monitor->state == State::Idle);
		monitor = Begin();
		Move(monitor, 120, 0);
		Cancel(monitor);
		const size_t count = delivered.size();
		Release(monitor);
		assert(delivered.size() == count);
	}
	return 0;
}
