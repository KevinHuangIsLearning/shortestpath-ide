/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ILocalTranscriptionModelStatus, ILocalTranscriptionResult, ILocalTranscriptionService, LocalTranscriptionModelState } from '../../../../platform/localTranscription/common/localTranscription.js';

/**
 * ShortestPath does not expose Chat or package its AI transcription runtime.
 * Keep the complete service surface as a no-op so no internal caller can spawn
 * the utility worker or dynamically load an intentionally absent dependency.
 */
export class LocalTranscriptionService implements ILocalTranscriptionService {

	declare readonly _serviceBrand: undefined;

	readonly isSupported = false;
	readonly onDidChangeModelStatus: Event<ILocalTranscriptionModelStatus> = Event.None;
	readonly onDidTranscribe: Event<ILocalTranscriptionResult> = Event.None;

	async getModelStatus(): Promise<ILocalTranscriptionModelStatus> {
		return { state: LocalTranscriptionModelState.Error, error: 'unsupported' };
	}

	async start(_options: Parameters<ILocalTranscriptionService['start']>[0]): Promise<void> {
		throw new Error('On-device transcription is not supported in ShortestPath IDE.');
	}

	async pushAudio(_chunk: VSBuffer): Promise<void> { }

	async stop(): Promise<string> {
		return '';
	}

	async cancel(): Promise<void> { }
}

registerSingleton(ILocalTranscriptionService, LocalTranscriptionService, InstantiationType.Delayed);
