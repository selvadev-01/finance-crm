import { accountSchema, collectionFrequencySchema } from '@repo/contracts';
import { COLLECTION_FREQUENCIES } from '@repo/domain';
import { describe, expect, it } from 'vitest';

/**
 * BR-04's cadences are spelled out twice — in `@repo/domain`, which may not
 * depend on zod, and in `@repo/contracts`, which may depend on nothing else.
 * Neither can import the other, so `apps/api` is the first place that sees
 * both, and this is where they are held together. A cadence added to one and
 * not the other fails here rather than at a customer's door.
 */
describe('the API contract and the domain agree on the collection frequencies', () => {
  it('offers exactly the same set, in the same order', () => {
    expect(collectionFrequencySchema.options).toEqual([
      ...COLLECTION_FREQUENCIES,
    ]);
  });

  it('every frequency the domain knows parses as a contract value', () => {
    for (const frequency of COLLECTION_FREQUENCIES) {
      expect(collectionFrequencySchema.parse(frequency)).toBe(frequency);
    }
  });

  it('an account carries its frequency to the screen', () => {
    // The response is parsed through the contract, so a field missing here is
    // silently stripped rather than wrong — which is why it is asserted.
    expect(accountSchema.shape.collectionFrequency).toBeDefined();
  });
});
