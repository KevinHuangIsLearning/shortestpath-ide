/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ExtensionIdentifier, IExtensionDescription, TargetPlatform } from '../../../../../platform/extensions/common/extensions.js';
import { ApiProposalName } from '../../../../../platform/extensions/common/extensionsApiProposals.js';
import { checkProposedApiEnabled, isProposedApiEnabled, setEnabledApiProposalsFallbackExperiment } from '../../common/extensions.js';

suite('Proposed API checks', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function desc(id: string, enabledApiProposals: string[] | undefined): IExtensionDescription {
		return {
			name: id,
			publisher: 'test',
			version: '0.0.0',
			engines: { vscode: '^1.0.0' },
			identifier: new ExtensionIdentifier(id),
			extensionLocation: URI.parse('nothing://nowhere'),
			isBuiltin: false,
			isUnderDevelopment: false,
			isUserBuiltin: false,
			activationEvents: ['*'],
			main: 'index.js',
			targetPlatform: TargetPlatform.UNDEFINED,
			extensionDependencies: [],
			enabledApiProposals: enabledApiProposals as ApiProposalName[] | undefined,
			preRelease: false,
		};
	}

	test('only enables explicitly declared proposals', () => {
		assert.deepStrictEqual(
			{
				declared: isProposedApiEnabled(desc('test.declared', ['fileSearchProvider']), 'fileSearchProvider'),
				missing: isProposedApiEnabled(desc('test.missing', ['textSearchProvider']), 'fileSearchProvider'),
				empty: isProposedApiEnabled(desc('test.empty', []), 'fileSearchProvider'),
				undefined: isProposedApiEnabled(desc('test.undefined', undefined), 'fileSearchProvider'),
			},
			{
				declared: true,
				missing: false,
				empty: false,
				undefined: false,
			}
		);
	});

	test('checking a declared proposal succeeds', () => {
		assert.doesNotThrow(() => checkProposedApiEnabled(desc('test.declared', ['fileSearchProvider']), 'fileSearchProvider'));
	});

	test('experiment has no effect on non-stable builds', () => {
		const missing = desc('test.missing', ['unrelatedProposal']);
		store.add(setEnabledApiProposalsFallbackExperiment('test.missing:someProposal', 'insider'));
		assert.strictEqual(isProposedApiEnabled(missing, 'someProposal' as ApiProposalName), false);
	});

	test('disposing the experiment removes the fallback', () => {
		const missing = desc('test.missing', ['unrelatedProposal']);
		const disposable = store.add(setEnabledApiProposalsFallbackExperiment('test.missing:someProposal', 'stable'));
		assert.strictEqual(isProposedApiEnabled(missing, 'someProposal' as ApiProposalName), true);
		disposable.dispose();
		assert.strictEqual(isProposedApiEnabled(missing, 'someProposal' as ApiProposalName), false);
	});
});
