// Copyright (c) 2026 ShortestPath IDE contributors.
// Licensed under the GPL-3.0-or-later license. See LICENSE in the project root.
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
