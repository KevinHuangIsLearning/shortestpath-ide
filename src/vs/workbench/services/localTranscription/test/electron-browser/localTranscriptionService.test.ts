/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { LocalTranscriptionModelState } from '../../../../../platform/localTranscription/common/localTranscription.js';
import { LocalTranscriptionService } from '../../electron-browser/localTranscriptionService.js';

suite('ShortestPath LocalTranscriptionService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('stays a complete no-op when the AI runtime is not packaged', async () => {
		const service = new LocalTranscriptionService();

		assert.strictEqual(service.isSupported, false);
		assert.strictEqual(service.onDidChangeModelStatus, Event.None);
		assert.strictEqual(service.onDidTranscribe, Event.None);
		assert.deepStrictEqual(await service.getModelStatus(), {
			state: LocalTranscriptionModelState.Error,
			error: 'unsupported'
		});
		await assert.rejects(
			service.start({ cacheDir: '/unused' }),
			/On-device transcription is not supported/
		);
		await service.pushAudio(VSBuffer.alloc(0));
		assert.strictEqual(await service.stop(), '');
		await service.cancel();
	});
});
