import { type ExtensionConfig } from 'src/types';
import { vscodeUtils } from 'src/utils/vscodeUtils';

/**
 * Update global setting `errorLens.enabledDiagnosticLevels`.
 * Either add a diagnostic severity or remove it.
 */
export async function toggleEnabledLevels(
	severity: ExtensionConfig['enabledDiagnosticLevels'][number],
	arrayValue: ExtensionConfig['enabledDiagnosticLevels'],
): Promise<void> {
	const oldValueIndex = arrayValue.indexOf(severity);
	if (oldValueIndex === -1) {
		arrayValue.push(severity);
	} else {
		arrayValue.splice(oldValueIndex, 1);
	}

	await vscodeUtils.updateGlobalSetting('errorLens.enabledDiagnosticLevels', arrayValue);
}
