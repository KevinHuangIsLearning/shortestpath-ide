
/**
 * log. console.log (when developing).
 */
export class Logger {
	private readonly isEnabled: boolean;

	constructor({ isDev }: { isDev: boolean }) {
		this.isEnabled = isDev;
	}

	log(message: string, ...args: unknown[]): void {
		this.innerLog('log', message, ...args);
	}

	warn(message: string, ...args: unknown[]): void {
		this.innerLog('warn', message, ...args);
	}

	private innerLog(severity: 'log' | 'warn', message: string, ...args: unknown[]): void {
		if (!this.isEnabled) {
			return;
		}

		if (args.length) {
			console[severity](message, args);
		} else {
			console[severity](message);
		}
	}
}
