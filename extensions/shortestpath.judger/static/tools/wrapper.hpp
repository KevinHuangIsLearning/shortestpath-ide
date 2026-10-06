// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root.
#ifndef SHORTESTPATH_JUDGER_TIMING
#define SHORTESTPATH_JUDGER_TIMING
#include <chrono>
#include <cstdio>
namespace shortestpath_judger {
struct Timer {
    std::chrono::steady_clock::time_point start = std::chrono::steady_clock::now();
    ~Timer() { std::fprintf(stderr, "\n[shortestpath-judger-time:%lld]\n", static_cast<long long>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count())); }
};
static Timer timer;
}
#endif
