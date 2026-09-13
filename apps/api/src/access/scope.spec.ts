import type { StaffRole } from '@repo/db';

import type { RequestContext } from '../platform/context/request-context.js';
import { NotFoundError } from '../platform/errors/errors.js';
import {
  collectionScope,
  customerScope,
  foundInScope,
  inScope,
  lineScope,
  sectorScope,
} from './scope.js';

const context = (
  role: StaffRole,
  currentLineId: string | null = 'line-3',
): RequestContext => ({
  requestId: 'req_test',
  userId: 'user-1',
  staffProfileId: 'staff-1',
  organizationId: 'org-1',
  role,
  currentLineId,
});

const NO_ROWS = { id: { in: [] } };

describe('scope predicates (M02)', () => {
  describe('customers', () => {
    it.each(['SUPER_ADMIN', 'ADMIN'] as const)(
      '%s sees every customer in their organization',
      (role) => {
        expect(customerScope(context(role))).toEqual({
          organizationId: 'org-1',
        });
      },
    );

    it('a Senior sees their current line', () => {
      expect(customerScope(context('SENIOR'))).toEqual({ lineId: 'line-3' });
    });

    it('a Junior sees their current line — decision A, pending per-Junior assignment', () => {
      expect(customerScope(context('JUNIOR'))).toEqual({ lineId: 'line-3' });
    });

    it.each(['SENIOR', 'JUNIOR'] as const)(
      'a %s with no current assignment sees nothing, not everything',
      (role) => {
        expect(customerScope(context(role, null))).toEqual(NO_ROWS);
      },
    );

    it('an Admin with no assignment still sees their whole organization', () => {
      expect(customerScope(context('ADMIN', null))).toEqual({
        organizationId: 'org-1',
      });
    });
  });

  describe('collections', () => {
    it('a Senior sees collections attributed to their current line', () => {
      expect(collectionScope(context('SENIOR'))).toEqual({ lineId: 'line-3' });
    });

    it('a Junior sees only their own entries on their current line', () => {
      expect(collectionScope(context('JUNIOR'))).toEqual({
        lineId: 'line-3',
        collectedByUserId: 'user-1',
      });
    });

    it.each(['SENIOR', 'JUNIOR'] as const)(
      'a %s with no current assignment sees nothing',
      (role) => {
        expect(collectionScope(context(role, null))).toEqual(NO_ROWS);
      },
    );

    it.each(['SUPER_ADMIN', 'ADMIN'] as const)(
      '%s sees every collection on lines in their organization',
      (role) => {
        expect(collectionScope(context(role))).toEqual({
          line: { organizationId: 'org-1' },
        });
      },
    );
  });

  describe('sectors and lines', () => {
    it.each(['SUPER_ADMIN', 'ADMIN'] as const)(
      '%s sees every sector and line in their organization',
      (role) => {
        expect(sectorScope(context(role))).toEqual({ organizationId: 'org-1' });
        expect(lineScope(context(role))).toEqual({ organizationId: 'org-1' });
      },
    );

    it.each(['SENIOR', 'JUNIOR'] as const)(
      'a %s sees only their current line and its sector',
      (role) => {
        expect(lineScope(context(role))).toEqual({ id: 'line-3' });
        expect(sectorScope(context(role))).toEqual({
          lines: { some: { id: 'line-3' } },
        });
      },
    );

    it.each(['SENIOR', 'JUNIOR'] as const)(
      'a %s with no current assignment sees no sectors or lines',
      (role) => {
        expect(lineScope(context(role, null))).toEqual(NO_ROWS);
        expect(sectorScope(context(role, null))).toEqual(NO_ROWS);
      },
    );
  });

  describe('combining with a query', () => {
    it('requires both the scope and the query filter', () => {
      expect(inScope({ lineId: 'line-3' }, { status: 'ACTIVE' })).toEqual({
        AND: [{ lineId: 'line-3' }, { status: 'ACTIVE' }],
      });
    });

    it('applies the scope alone when the query has no filter', () => {
      expect(inScope({ lineId: 'line-3' })).toEqual({
        AND: [{ lineId: 'line-3' }],
      });
    });
  });

  describe('foundInScope', () => {
    it('returns a row that was found', () => {
      expect(foundInScope({ id: 'c1' }, 'customer')).toEqual({ id: 'c1' });
    });

    it.each([null, undefined])(
      'throws NotFoundError for %s — the same for missing and out of scope',
      (row) => {
        expect(() => foundInScope(row, 'customer')).toThrow(NotFoundError);
        expect(() => foundInScope(row, 'customer')).toThrow(
          'Customer not found',
        );
      },
    );
  });
});
