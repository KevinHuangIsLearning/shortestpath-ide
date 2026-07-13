globalThis.logger = { ...console };
import { words_in_text, toPascalCase, replaceFileNamePlaceholders } from '../utilsPure';

describe('problem name parser', () => {
    test('mix of latin, non latin and numbers', () => {
        const output = ['apple', '12345', 'mango', 'India', 'こんにちは', '7'];
        const input = 'apple 12345 mango India こんにちは 7';
        expect(words_in_text(input, '[\\p{L}]+|[0-9]+')).toEqual(output);
    });

    test('just a number', () => {
        const output = ['23'];
        const input = '23';
        expect(words_in_text(input, '[\\p{L}]+|[0-9]+')).toEqual(output);
    });

    test('just a word', () => {
        const output = ['grapes'];
        const input = 'grapes';
        expect(words_in_text(input, '[\\p{L}]+|[0-9]+')).toEqual(output);
    });

    test('word and number', () => {
        const output = ['grapes', '1'];
        const input = 'grapes1';
        expect(words_in_text(input, '[\\p{L}]+|[0-9]+')).toEqual(output);
    });

    test('mix of latin, non latin, numbers, and apostrophes', () => {
        const output = [
            "apple's",
            '12345',
            "mango's",
            "India's",
            "こん'に'ち'は",
            '7',
        ];
        const input = "apple's 12345 mango's India's こん'に'ち'は 7";
        expect(words_in_text(input, "[\\p{L}']+|[0-9']+")).toEqual(output);
    });

    test('number and apostrophe', () => {
        const output = ["2'3"];
        const input = "2'3";
        expect(words_in_text(input, "[\\p{L}']+|[0-9']+")).toEqual(output);
    });

    test('word and apostrophe', () => {
        const output = ["grape's"];
        const input = "grape's";
        expect(words_in_text(input, "[\\p{L}']+|[0-9']+")).toEqual(output);
    });

    test('word and number and apostrophes', () => {
        const output = ["grape's", "1's"];
        const input = "grape's 1's";
        expect(words_in_text(input, "[\\p{L}0-9']+")).toEqual(output);
    });
});

describe('replaceFileNamePlaceholders', () => {
    test('replaces simple placeholders', () => {
        const result = replaceFileNamePlaceholders('{slug}.{ext}', {
            slug: 'A_Watermelon',
            ext: 'cpp',
        });
        expect(result).toBe('A_Watermelon.cpp');
    });

    test('replaces multiple placeholders', () => {
        const result = replaceFileNamePlaceholders('{contestId}{problemId}_{slug}.{ext}', {
            contestId: '144',
            problemId: 'C',
            slug: 'A_Watermelon',
            ext: 'cpp',
        });
        expect(result).toBe('144C_A_Watermelon.cpp');
    });

    test('leaves unknown placeholders as-is', () => {
        const result = replaceFileNamePlaceholders('{slug}_{unknown}.{ext}', {
            slug: 'test',
            ext: 'py',
        });
        expect(result).toBe('test_{unknown}.py');
    });

    test('handles empty template', () => {
        const result = replaceFileNamePlaceholders('', {
            slug: 'test',
            ext: 'cpp',
        });
        expect(result).toBe('');
    });

    test('handles template with no placeholders', () => {
        const result = replaceFileNamePlaceholders('fixed_name.cpp', {
            slug: 'ignored',
            ext: 'cpp',
        });
        expect(result).toBe('fixed_name.cpp');
    });

    test('replaces empty string value', () => {
        const result = replaceFileNamePlaceholders('{contestId}{problemId}.{ext}', {
            contestId: '',
            problemId: 'A',
            ext: 'cpp',
        });
        expect(result).toBe('A.cpp');
    });

    test('handles {index} placeholder', () => {
        const result = replaceFileNamePlaceholders('{index}_{slug}.{ext}', {
            index: 'A',
            slug: 'Watermelon',
            ext: 'cpp',
        });
        expect(result).toBe('A_Watermelon.cpp');
    });

    test('handles {group} placeholder', () => {
        const result = replaceFileNamePlaceholders('{group}/{slug}.{ext}', {
            group: 'Codeforces Round',
            slug: 'Problem',
            ext: 'cpp',
        });
        expect(result).toBe('Codeforces Round/Problem.cpp');
    });
});

describe('toPascalCase', () => {
    test('converts underscore-separated words to PascalCase', () => {
        expect(toPascalCase('two_sum')).toBe('TwoSum');
    });

    test('handles multiple words', () => {
        expect(toPascalCase('hello_world_test')).toBe('HelloWorldTest');
    });

    test('handles single word', () => {
        expect(toPascalCase('hello')).toBe('Hello');
    });

    test('handles mixed case input', () => {
        expect(toPascalCase('HELLO_WORLD')).toBe('HelloWorld');
    });

    test('preserves numbers as-is', () => {
        expect(toPascalCase('problem_123_test')).toBe('Problem123Test');
    });

    test('prefixes with Problem when result starts with number', () => {
        expect(toPascalCase('123_456')).toBe('Problem123456');
    });

    test('prefixes single number with Problem', () => {
        expect(toPascalCase('123')).toBe('Problem123');
    });

    test('prefixes when starts with number followed by words', () => {
        expect(toPascalCase('123_hello_world')).toBe('Problem123HelloWorld');
    });

    test('handles empty string', () => {
        expect(toPascalCase('')).toBe('');
    });

    test('handles consecutive underscores', () => {
        expect(toPascalCase('hello__world')).toBe('HelloWorld');
    });

    test('handles real problem names', () => {
        expect(toPascalCase('A_Watermelon')).toBe('AWatermelon');
        expect(toPascalCase('Two_Sum')).toBe('TwoSum');
        expect(toPascalCase('Binary_Search_Tree')).toBe('BinarySearchTree');
    });
});
