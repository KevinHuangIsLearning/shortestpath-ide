/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
jest.mock('vscode', () => ({}), { virtual: true });
import http from 'http';
import { handleScriptRequest } from '../userScriptBridge';

test('host GM request can fetch JSON without browser CORS and refuses redirecting requests', async () => {
	const server = http.createServer((request, response) => {
		if (request.url === '/redirect') {
			response.writeHead(302, { Location: '/target' });
			response.end();
		} else {
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end('{"value":42}');
		}
	});
	await new Promise<void>((resolve) =>
		server.listen(0, '127.0.0.1', resolve),
	);
	try {
		const address = server.address();
		if (!address || typeof address === 'string') {
			throw new Error('No test server port');
		}
		const url = `http://127.0.0.1:${address.port}`;
		const response = (await handleScriptRequest(
			{
				id: 1,
				operation: 'request',
				args: { url, responseType: 'json' },
			},
			'test',
			{},
		)) as { response: object };
		expect(response.response).toEqual({ value: 42 });
		await expect(
			handleScriptRequest(
				{
					id: 2,
					operation: 'request',
					args: { url: url + '/redirect' },
				},
				'test',
				{},
			),
		).rejects.toThrow();
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
