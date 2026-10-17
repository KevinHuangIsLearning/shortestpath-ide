/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Long reference solution for checking line numbers, spacing and automatic wrapping.
#include <array>
#include <cstdio>
#include <limits>
#include <string_view>

namespace reference_solution {

class BufferedInput {
public:
    static constexpr std::size_t buffer_capacity = 1U << 16;

    bool read_integer(long long& value) {
        int current = next_character();
        while (current != EOF && current <= ' ') {
            current = next_character();
        }
        if (current == EOF) {
            return false;
        }

        bool negative = current == '-';
        if (negative) {
            current = next_character();
        }
        long long magnitude = 0;
        while (current >= '0' && current <= '9') {
            magnitude = magnitude * 10 + current - '0';
            current = next_character();
        }
        value = negative ? -magnitude : magnitude;
        return true;
    }

private:
    int next_character() {
        if (position_ == length_) {
            length_ = std::fread(buffer_.data(), 1, buffer_.size(), stdin);
            position_ = 0;
            if (length_ == 0) {
                return EOF;
            }
        }
        return static_cast<unsigned char>(buffer_[position_++]);
    }

    std::array<char, buffer_capacity> buffer_{};
    std::size_t position_ = 0;
    std::size_t length_ = 0;
};

// 这条长注释需要自动换行：the reader must preserve editor font size, indentation and original padding; continuation rows align with the code column and share one source line number: LONG_LINE_END.
constexpr std::string_view explanation = "Use a 64-bit accumulator so that adding two signed 32-bit input values remains safe; the right edge must remain readable through wrapping, without horizontal scrolling or squeezing the code.";

long long add_without_narrowing(long long first_value, long long second_value) {
    const long long minimum_input = std::numeric_limits<int>::min();
    const long long maximum_input = std::numeric_limits<int>::max();

    if (first_value < minimum_input || first_value > maximum_input || second_value < minimum_input || second_value > maximum_input) {
        // The problem guarantees signed 32-bit inputs.
        return first_value + second_value;
    }

    const long long answer = first_value + second_value;
    return answer;
}

void solve() {
    BufferedInput input;
    long long first_value = 0;
    long long second_value = 0;

    if (!input.read_integer(first_value)) {
        return;
    }
    if (!input.read_integer(second_value)) {
        return;
    }

    const long long answer = add_without_narrowing(first_value, second_value);
    std::printf("%lld\n", answer);
}

} // namespace reference_solution

int main() {
    reference_solution::solve();
    return 0;
}
