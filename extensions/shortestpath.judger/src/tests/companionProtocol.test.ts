/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import http from 'http';
import { AddressInfo } from 'net';
import { CompanionRequestError, readCompanionRequest, renderProblemTemplate, validateCompanionProblem } from '../companionProtocol';

test('real HTTP accepts split UTF-8, rejects malformed schema and bounds a chunked body', async () => {
	const server = http.createServer(async (req, res) => {
		try { const value = validateCompanionProblem(await readCompanionRequest(req, 1024)); res.end(JSON.stringify(value)); }
		catch (error) { res.statusCode = error instanceof CompanionRequestError ? error.status : 500; res.end(); }
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const send = (parts: Buffer[]) => new Promise<{ status: number; body: string }>((resolve, reject) => {
		const req = http.request({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port, method: 'POST' }, res => {
			let body = ''; res.on('data', data => body += data); res.on('end', () => resolve({ status: res.statusCode!, body }));
		});
		req.on('error', reject);
		for (const part of parts) { req.write(part); }
		req.end();
	});
	try {
		const payload = Buffer.from(JSON.stringify({ name: '中文', url: '', tests: [{ input: '中', output: '文' }] }));
		const index = payload.indexOf(Buffer.from('中'));
		const result = await send([payload.subarray(0, index + 1), payload.subarray(index + 1)]);
		expect(result.status).toBe(200);
		expect(JSON.parse(result.body).name).toBe('中文');
		expect((await send([Buffer.from('{"name":"A","url":""}')])).status).toBe(422);
		expect((await send([Buffer.alloc(2048, 120)])).status).toBe(413);
		expect((await send([Buffer.from('{')])).status).toBe(400);
	} finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('templates retain typed values, replace every occurrence, and preserve literal code', () => {
	expect(renderProblemTemplate('$n$ $n$ $flag$ $object$ $code$', { n: 3000, flag: true, object: { a: 1 }, code: 'a\\b $&' })).toBe('3000 3000 true {"a":1} a\\b $&');
});
