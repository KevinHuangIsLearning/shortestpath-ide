/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type EnvironmentStepStatus = 'pending' | 'running' | 'complete' | 'error';

export type EnvironmentStepState = {
	id: string;
	title: string;
	description: string;
	status: EnvironmentStepStatus;
	log: string;
};

export type EnvironmentSetupState = {
	running: boolean;
	ready: boolean;
	steps: EnvironmentStepState[];
};

export type EnvironmentSetupStep = {
	id: string;
	title: string;
	description: string;
	run(report: (message: string) => void): Promise<void>;
};

/** Completion is determined by the host, never by messages from the Webview. */
export class EnvironmentSetupRunner {
	private state: EnvironmentSetupState;

	constructor(private readonly steps: readonly EnvironmentSetupStep[], private readonly publish: (state: EnvironmentSetupState) => void, private readonly translateError: (message: string) => string = message => message) {
		this.state = this.initialState();
	}

	get snapshot(): EnvironmentSetupState {
		return { ...this.state, steps: this.state.steps.map(step => ({ ...step })) };
	}

	private initialState(): EnvironmentSetupState {
		return { running: false, ready: false, steps: this.steps.map(step => ({ id: step.id, title: step.title, description: step.description, status: 'pending', log: '' })) };
	}

	async run(): Promise<void> {
		if (this.state.running || this.state.ready) {
			return;
		}
		this.state = this.initialState();
		this.state.running = true;
		this.publish(this.snapshot);
		try {
			for (const [index, step] of this.steps.entries()) {
				const current = this.state.steps[index];
				current.status = 'running';
				this.publish(this.snapshot);
				try {
					await step.run(message => {
						// Keep installer output bounded, including downloads that print
						// progress without newlines. The UI treats it as external text.
						current.log = `${current.log}${message}\n`.slice(-24000);
						this.publish(this.snapshot);
					});
					current.status = 'complete';
				} catch (error) {
					current.status = 'error';
					current.log = `${current.log}${this.translateError(error instanceof Error ? error.message : String(error))}\n`.slice(-24000);
					return;
				}
				this.publish(this.snapshot);
			}
			this.state.ready = this.steps.length > 0;
		} finally {
			this.state.running = false;
			this.publish(this.snapshot);
		}
	}
}
