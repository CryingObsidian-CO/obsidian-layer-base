import { describe, expect, it } from 'vitest';
import { scopeLedger } from '../src/views/scope-ledger';

function ledgerFor(scope: string) {
	const pushed: string[] = [];
	const popped: string[] = [];
	const ledger = scopeLedger(
		scope,
		(inner) => pushed.push(inner),
		(inner) => popped.push(inner),
	);
	return { ledger, pushed, popped };
}

describe('scopeLedger', () => {
	it('puts the scope on the stack once for the pair a click sends', () => {
		// A click sends pointerdown, and the first one also sends focusin.
		const { ledger, pushed } = ledgerFor('view');
		ledger.acquire();
		ledger.acquire();
		expect(pushed).toEqual(['view']);
	});

	it('adds nothing for further clicks while it is already on the stack', () => {
		const { ledger, pushed } = ledgerFor('view');
		ledger.acquire();
		for (let press = 0; press < 5; press += 1) {
			ledger.acquire();
		}
		expect(pushed).toEqual(['view']);
	});

	it('takes it off the stack once, however many releases arrive', () => {
		const { ledger, popped } = ledgerFor('view');
		ledger.acquire();
		ledger.release();
		ledger.release();
		expect(popped).toEqual(['view']);
	});

	it('pushes again after it was released', () => {
		const { ledger, pushed, popped } = ledgerFor('view');
		ledger.acquire();
		ledger.release();
		ledger.acquire();
		expect(pushed).toEqual(['view', 'view']);
		expect(popped).toEqual(['view']);
	});

	it('does not pop a scope it never pushed', () => {
		const { ledger, popped } = ledgerFor('view');
		ledger.release();
		expect(popped).toEqual([]);
	});
});
