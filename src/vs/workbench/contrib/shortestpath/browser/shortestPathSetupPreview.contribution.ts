/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IUserDataProfileService } from '../../../services/userDataProfile/common/userDataProfile.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { TokenizationRegistry } from '../../../../editor/common/languages.js';
import { LineTokens } from '../../../../editor/common/tokens/lineTokens.js';

CommandsRegistry.registerCommand('_shortestpath.snippetsHome', accessor => accessor.get(IUserDataProfileService).currentProfile.snippetsHome.toString());

// Share the workbench's C++ grammar and active theme with the setup webview.
CommandsRegistry.registerCommand('_shortestpath.cppPreviewTokens', async (accessor, source: string) => {
	if (typeof source !== 'string' || source.length > 100_000) { throw new Error('Invalid preview source'); }
	const languages = accessor.get(ILanguageService);
	languages.requestRichLanguageFeatures('cpp');
	const support = await TokenizationRegistry.getOrCreate('cpp');
	if (!support) { throw new Error('C++ tokenization is unavailable'); }
	const colors = TokenizationRegistry.getColorMap()?.map(color => color ? color.toString() : '') ?? [];
	let state = support.getInitialState();
	return source.split(/\r?\n/).map(line => {
		const tokenized = support.tokenizeEncoded(line, true, state);
		state = tokenized.endState;
		LineTokens.convertToEndOffset(tokenized.tokens, line.length);
		const tokens = new LineTokens(tokenized.tokens, line, languages.languageIdCodec);
		let start = 0;
		return Array.from({ length: tokens.getCount() }, (_, index) => {
			const end = tokens.getEndOffset(index);
			const token = { text: line.slice(start, end), style: tokens.getInlineStyle(index, colors) };
			start = end;
			return token;
		});
	});
});
