// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root.
#ifndef SHORTESTPATH_JUDGER_STDIO
#define SHORTESTPATH_JUDGER_STDIO
#include <cstdio>
// Function-like interception keeps both freopen(...) and std::freopen(...) valid.
// freopen on stdin/stdout is intentionally disabled; other streams retain normal behavior.
namespace shortestpath_judger {
inline FILE* preserveStdio(const char* file, const char* mode, FILE* stream) {
    return stream == stdin || stream == stdout ? stream : std::freopen(file, mode, stream);
}
}
// Import the adapter alongside std::freopen for qualified OI source calls.
namespace std { using ::shortestpath_judger::preserveStdio; }
using shortestpath_judger::preserveStdio;
#define freopen preserveStdio
#endif
