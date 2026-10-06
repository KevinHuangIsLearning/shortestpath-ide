/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>
#include <thread>
#include <filesystem>
#include <vector>
#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
#include <shellapi.h>
#else
#include <cerrno>
#include <csignal>
#include <fcntl.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>
#ifdef __APPLE__
#include <libproc.h>
#else
#include <time.h>
#endif
static volatile sig_atomic_t childPid = 0;
static void stopChild(int) { if (childPid > 0) kill(-childPid, SIGKILL); }
#endif

// CPU limit and a separate wall watchdog: startup waits must not consume the CPU budget.
static constexpr bool exceededLimit(long long cpuMs, long long wallMs, long long cpuLimit, long long wallLimit) {
	return cpuMs > cpuLimit || wallMs >= wallLimit;
}
static_assert(!exceededLimit(5, 350, 100, 5000), "Cold startup is not CPU time");
static_assert(exceededLimit(101, 350, 100, 5000), "CPU overrun must stop");
static_assert(exceededLimit(0, 5000, 100, 5000), "Sleeping processes remain bounded");

// program, input, output, stderr, metrics, timeout-ms, unlimited-stack, max-output-bytes , wall-timeout-ms
int main(int argc, char** argv) {
#ifdef _WIN32
	int wideCount = 0;
	wchar_t** wide = CommandLineToArgvW(GetCommandLineW(), &wideCount);
	if (!wide || wideCount != 10) return 2;
	std::vector<std::string> arguments;
	std::vector<char*> pointers;
	for (int i = 0; i < wideCount; ++i) {
		int length = WideCharToMultiByte(CP_UTF8, 0, wide[i], -1, nullptr, 0, nullptr, nullptr);
		std::string text(length, '\0');
		WideCharToMultiByte(CP_UTF8, 0, wide[i], -1, &text[0], length, nullptr, nullptr);
		text.resize(length - 1); arguments.push_back(text);
	}
	for (auto& argument : arguments) pointers.push_back(&argument[0]);
	argc = wideCount; argv = pointers.data();
#endif
	if (argc != 10) return 2;
	const auto start = std::chrono::steady_clock::now();
	const auto cpuLimit = std::strtoll(argv[6], nullptr, 10);
	const auto wallLimit = std::strtoll(argv[9], nullptr, 10);
	const auto maxOutput = std::strtoull(argv[8], nullptr, 10);
	if (maxOutput == 0 || cpuLimit <= 0 || wallLimit <= 0) return 2;
	bool timedOut = false;
	long long cpu = 0, memory = 0;
	int code = -1, signal = 0;
#ifdef _WIN32
	SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
	HANDLE input = CreateFileW(wide[2], GENERIC_READ, FILE_SHARE_READ, &security, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
	HANDLE output = CreateFileW(wide[3], GENERIC_WRITE, FILE_SHARE_READ, &security, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
	HANDLE error = CreateFileW(wide[4], GENERIC_WRITE, FILE_SHARE_READ, &security, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
	if (input == INVALID_HANDLE_VALUE || output == INVALID_HANDLE_VALUE || error == INVALID_HANDLE_VALUE) return 3;
	HANDLE job = CreateJobObjectW(nullptr, nullptr);
	JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
	limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
	if (!job || !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) return 3;
	STARTUPINFOW startup{}; startup.cb = sizeof(startup); startup.dwFlags = STARTF_USESTDHANDLES;
	startup.hStdInput = input; startup.hStdOutput = output; startup.hStdError = error;
	PROCESS_INFORMATION process{};
	std::wstring command = std::wstring(L"\"") + wide[1] + L"\"";
	if (!CreateProcessW(wide[1], &command[0], nullptr, nullptr, TRUE, CREATE_SUSPENDED | CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process)) return 3;
	if (!AssignProcessToJobObject(job, process.hProcess)) { TerminateProcess(process.hProcess, 1); return 3; }
	ResumeThread(process.hThread);
	while (WaitForSingleObject(process.hProcess, 5) == WAIT_TIMEOUT) {
		LARGE_INTEGER outSize{}, errSize{}; GetFileSizeEx(output, &outSize); GetFileSizeEx(error, &errSize);
		FILETIME created{}, exited{}, kernel{}, user{};
		if (GetProcessTimes(process.hProcess, &created, &exited, &kernel, &user)) {
			ULARGE_INTEGER k{}, u{}; k.LowPart = kernel.dwLowDateTime; k.HighPart = kernel.dwHighDateTime; u.LowPart = user.dwLowDateTime; u.HighPart = user.dwHighDateTime;
			cpu = (k.QuadPart + u.QuadPart) / 10000;
		}
		const auto wallMs = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count();
		if (exceededLimit(cpu, wallMs, cpuLimit, wallLimit) || (static_cast<unsigned long long>(outSize.QuadPart) > maxOutput || static_cast<unsigned long long>(errSize.QuadPart) > maxOutput)) {
			timedOut = exceededLimit(cpu, wallMs, cpuLimit, wallLimit);
			TerminateJobObject(job, 1); break;
		}
	}
	WaitForSingleObject(process.hProcess, INFINITE);
	FILETIME created{}, exited{}, kernel{}, user{}; GetProcessTimes(process.hProcess, &created, &exited, &kernel, &user);
	ULARGE_INTEGER k{}, u{}; k.LowPart = kernel.dwLowDateTime; k.HighPart = kernel.dwHighDateTime; u.LowPart = user.dwLowDateTime; u.HighPart = user.dwHighDateTime;
	cpu = (k.QuadPart + u.QuadPart) / 10000;
	PROCESS_MEMORY_COUNTERS counters{}; if (GetProcessMemoryInfo(process.hProcess, &counters, sizeof(counters))) memory = counters.PeakWorkingSetSize;
	DWORD exitCode; GetExitCodeProcess(process.hProcess, &exitCode); code = static_cast<int>(exitCode);
	CloseHandle(process.hThread); CloseHandle(process.hProcess); CloseHandle(job); CloseHandle(input); CloseHandle(output); CloseHandle(error);
#else
	pid_t pid = fork();
	if (pid < 0) return 3;
	if (pid == 0) {
		setpgid(0, 0);
		if (!std::freopen(argv[2], "rb", stdin) || !std::freopen(argv[3], "wb", stdout) || !std::freopen(argv[4], "wb", stderr)) _exit(126);
		rlimit outputLimit{static_cast<rlim_t>(maxOutput + 1), static_cast<rlim_t>(maxOutput + 1)}; setrlimit(RLIMIT_FSIZE, &outputLimit);
		if (std::string(argv[7]) == "1") { rlimit stack{}; if (getrlimit(RLIMIT_STACK, &stack) == 0) { stack.rlim_cur = stack.rlim_max; setrlimit(RLIMIT_STACK, &stack); } }
		execl(argv[1], argv[1], static_cast<char*>(nullptr)); _exit(127);
	}
	childPid = pid; setpgid(pid, pid); std::signal(SIGTERM, stopChild); std::signal(SIGINT, stopChild);
	int status = 0; rusage usage{};
	for (;;) {
		pid_t result = wait4(pid, &status, WNOHANG, &usage);
		if (result == pid) break;
		if (result < 0 && errno != EINTR) { stopChild(0); return 3; }
		std::error_code outError, errError;
		const auto outSize = std::filesystem::file_size(argv[3], outError);
		const auto errSize = std::filesystem::file_size(argv[4], errError);
		if (!outError && !errError && (outSize > maxOutput || errSize > maxOutput)) { stopChild(0); }
		#ifdef __APPLE__
		rusage_info_v2 liveUsage{};
		if (proc_pid_rusage(pid, RUSAGE_INFO_V2, reinterpret_cast<rusage_info_t*>(&liveUsage)) == 0) {
			cpu = (liveUsage.ri_user_time + liveUsage.ri_system_time) / 1000000;
		}
#else
		clockid_t cpuClock; timespec liveUsage{};
		if (clock_getcpuclockid(pid, &cpuClock) == 0 && clock_gettime(cpuClock, &liveUsage) == 0) {
			cpu = liveUsage.tv_sec * 1000LL + liveUsage.tv_nsec / 1000000;
		}
#endif
		const auto wallMs = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count();
		if (exceededLimit(cpu, wallMs, cpuLimit, wallLimit)) { timedOut = true; stopChild(0); }
		std::this_thread::sleep_for(std::chrono::milliseconds(5));
	}
	// Do not leave descendants running after their original parent exits.
	kill(-pid, SIGKILL); childPid = 0;
	cpu = (usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) * 1000LL + (usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1000;
	memory = usage.ru_maxrss;
#ifndef __APPLE__
	memory *= 1024;
#endif
	if (WIFEXITED(status)) code = WEXITSTATUS(status);
	if (WIFSIGNALED(status)) signal = WTERMSIG(status);
#endif
	timedOut = timedOut || cpu > cpuLimit;
	std::ofstream result(std::filesystem::u8path(argv[5]));
	result << "{\"cpuMs\":" << cpu << ",\"memoryBytes\":" << memory << ",\"code\":" << code << ",\"signal\":" << signal << ",\"timeOut\":" << (timedOut ? "true" : "false") << "}";
	return result ? 0 : 4;
}
