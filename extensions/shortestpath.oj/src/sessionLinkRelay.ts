/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';

interface Peer {
	id: number;
	origin: string;
	integrated: boolean;
	userId: string | null;
	sessionRef: string;
	challenge: string;
	send: (type: string, data: object) => void;
}
interface PendingLink { source: number; challenge: string; expiresAt: number }
const proofPattern = /^[A-Za-z0-9_-]{43}$/;

/** Routes scoped authorization codes; it never receives a cookie or PKCE verifier. */
export class SessionLinkRelay {
	readonly token = randomUUID();
	private readonly peers = new Map<number, Peer>();
	private readonly pending = new Map<number, PendingLink>();
	private readonly paused = new Map<number, Set<number>>();

	get nativeConnected(): boolean { return [...this.peers.values()].some(peer => peer.integrated); }

	handle(id: number, origin: string, type: string, data: unknown, send: Peer['send']): boolean {
		if (!type.startsWith('session.link.')) { return false; }
		if (!data || typeof data !== 'object' || Array.isArray(data)) { return true; }
		const value = data as Record<string, unknown>;
		if (type === 'session.link.hello') {
			if (value.token !== undefined && value.token !== this.token) { send('session.link.error', { code: 'invalid_bootstrap' }); return true; }
			const integrated = value.token === this.token;
			if (integrated && [...this.peers.values()].some(peer => peer.integrated && peer.id !== id)) { send('session.link.error', { code: 'already_connected' }); return true; }
			this.peers.set(id, { id, origin, integrated, userId: null, sessionRef: '', challenge: '', send });
			send('session.link.ready', {});
			return true;
		}
		const peer = this.peers.get(id);
		if (!peer) { return true; }
		if (type === 'session.link.state') {
			if (!(value.userId === null || typeof value.userId === 'string' && /^[1-9]\d*$/.test(value.userId)) || typeof value.sessionRef !== 'string' || !/^(?:\d+:\d+)?$/.test(value.sessionRef) || typeof value.challenge !== 'string' || !proofPattern.test(value.challenge)) { return true; }
			const changed = peer.userId !== value.userId || peer.sessionRef !== value.sessionRef;
			if (changed || peer.challenge !== value.challenge) { this.pending.delete(id); }
			peer.userId = value.userId; peer.sessionRef = value.sessionRef; peer.challenge = value.challenge;
			if (changed) {
				for (const other of this.peers.values()) { if (this.paired(peer, other)) { other.send('session.link.changed', {}); } }
			}
			this.link();
		} else if (type === 'session.link.grant') {
			if (typeof value.targetId !== 'number' || typeof value.code !== 'string' || !proofPattern.test(value.code)) { return true; }
			const pending = this.pending.get(value.targetId);
			const target = this.peers.get(value.targetId);
			if (target && pending?.source === id && pending.expiresAt > Date.now() && this.paired(peer, target)) {
				target.send('session.link.redeem', { code: value.code, challenge: pending.challenge });
			}
		} else if (type === 'session.link.failed') {
			const targetId = typeof value.targetId === 'number' ? value.targetId : id;
			const pending = this.pending.get(targetId);
			if (pending && (pending.source === id || targetId === id)) { pending.expiresAt = Date.now() + 1000; }
		} else if (type === 'session.link.pause') {
			const targets = this.paused.get(id) ?? new Set<number>();
			for (const other of this.peers.values()) { if (this.paired(peer, other) && (!other.userId || other.userId === peer.userId)) { targets.add(other.id); other.send('session.link.pause', {}); } }
			this.paused.set(id, targets);
		} else if (type === 'session.link.resume') {
			this.resume(id);
		}
		return true;
	}

	remove(id: number): void {
		this.resume(id);
		for (const targets of this.paused.values()) { targets.delete(id); }
		this.peers.delete(id); this.pending.delete(id);
		for (const [target, pending] of this.pending) { if (pending.source === id) { this.pending.delete(target); } }
	}

	private resume(id: number): void {
		for (const target of this.paused.get(id) ?? []) { this.peers.get(target)?.send('session.link.resume', {}); }
		this.paused.delete(id);
	}

	private paired(a: Peer, b: Peer): boolean {
		return a.id !== b.id && a.origin === b.origin && a.integrated !== b.integrated;
	}

	private link(): void {
		for (const target of this.peers.values()) {
			if (!target.challenge || (this.pending.get(target.id)?.expiresAt ?? 0) > Date.now()) { continue; }
			const source = [...this.peers.values()].find(peer => this.paired(peer, target) && peer.userId && peer.sessionRef && peer.sessionRef !== target.sessionRef && (!target.userId || target.userId === peer.userId));
			if (!source) { continue; }
			this.pending.set(target.id, { source: source.id, challenge: target.challenge, expiresAt: Date.now() + 30_000 });
			target.send('session.link.wait', {});
			source.send('session.link.offer', { targetId: target.id, challenge: target.challenge });
		}
	}
}
