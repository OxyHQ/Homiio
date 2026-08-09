/**
 * Per-listing statistics for an owner's dashboard.
 *
 * Rooms are not a separate collection — a room is a listing whose
 * `parent_property_id` points at this one, or this listing itself when it IS a
 * room — so every count here is over `properties` with that predicate.
 *
 * ## All three stores this touched had already moved
 *
 * This file read Mongo `Property`, `Lease` AND `Saved`, and all three are
 * Postgres tables now. That is why every figure it returned had quietly become
 * wrong rather than merely stale: a listing created after the cutover exists in
 * neither the Mongo `properties` collection nor its leases, so the endpoint
 * answered 404 for it, and for an older listing it reported zero rooms, zero
 * revenue and zero saves.
 *
 * The `.catch(() => 0)` fallbacks the Mongo version wrapped each aggregate in
 * are gone with it. They existed to keep one failing aggregate from taking the
 * whole response down, and they are exactly what let this endpoint report a
 * confident `0` for a query that never ran — the failure mode this port is
 * about. A statistic that cannot be computed is an error, not a zero.
 */

import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { leases, properties, savedItems } from '../../db/schema';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

export async function getPropertyStats(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { propertyId } = req.params;
    // No id-SHAPE guard. `mongoose.Types.ObjectId.isValid` answered `false` for
    // every listing minted after the cutover, so this endpoint 400'd on exactly
    // the listings most likely to be looked at. A `text` primary key takes any
    // string and a nonsense id simply matches no row — see `db/ids.ts`.
    const [target] = await getDb()
      .select({
        id: properties.id,
        type: properties.type,
        monthlyAmount: properties.longTermRentMonthlyAmount,
      })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1);
    if (!target) return next(new AppError('Property not found', 404, 'NOT_FOUND'));

    // "This listing's rooms": its children, plus itself when it is a room.
    const roomScope = or(
      eq(properties.parentPropertyId, propertyId),
      and(eq(properties.id, propertyId), eq(properties.type, 'room')),
    );

    const now = new Date();

    const [roomCounts, leaseTotals, roomRent, savesCount] = await Promise.all([
      // The three room counts in ONE pass, as filtered aggregates. Three
      // separate `countDocuments` could each see a different instant, so an
      // `occupiedRooms` could exceed the `totalRooms` reported beside it.
      getDb()
        .select({
          total: sql<number>`count(*)::int`,
          occupied: sql<number>`count(*) filter (where ${properties.status} = 'occupied')::int`,
          available: sql<number>`count(*) filter (
            where ${properties.status} = 'active' and ${properties.availabilityIsAvailable}
          )::int`,
        })
        .from(properties)
        .where(and(roomScope, isNull(properties.deletedAt))),
      getDb()
        .select({
          total: sql<number>`coalesce(sum(${leases.rentDetailsMonthlyRent}), 0)`,
          avg: sql<number | null>`avg(${leases.rentDetailsMonthlyRent})`,
          count: sql<number>`count(*)::int`,
        })
        .from(leases)
        .where(
          and(
            eq(leases.propertyId, propertyId),
            eq(leases.status, 'active'),
            sql`${leases.leaseTermsStartDate} <= ${now}`,
            sql`${leases.leaseTermsEndDate} >= ${now}`,
          ),
        ),
      getDb()
        .select({
          avg: sql<number | null>`avg(${properties.longTermRentMonthlyAmount})`,
          count: sql<number>`count(*)::int`,
        })
        .from(properties)
        .where(and(roomScope, gt(properties.longTermRentMonthlyAmount, 0))),
      getDb()
        .select({ total: sql<number>`count(*)::int` })
        .from(savedItems)
        .where(and(eq(savedItems.targetType, 'property'), eq(savedItems.targetId, propertyId))),
    ]);

    const totalRooms = roomCounts[0]?.total ?? 0;
    const occupiedRooms = roomCounts[0]?.occupied ?? 0;
    const availableRooms = roomCounts[0]?.available ?? 0;

    const activeLeases = leaseTotals[0]?.count ?? 0;
    const monthlyRevenue = Number(leaseTotals[0]?.total ?? 0);

    // Preference order, unchanged: what the active leases actually charge, else
    // what this listing's rooms ask, else what the listing itself asks.
    const averageRent =
      activeLeases > 0 && leaseTotals[0]?.avg != null
        ? Number(leaseTotals[0].avg)
        : (roomRent[0]?.count ?? 0) > 0 && roomRent[0]?.avg != null
          ? Number(roomRent[0].avg)
          : (target.monthlyAmount ?? 0);

    const occupancyRate = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

    res.json(
      successResponse(
        {
          totalRooms,
          occupiedRooms,
          availableRooms,
          monthlyRevenue,
          averageRent,
          occupancyRate,
          savesCount: savesCount[0]?.total ?? 0,
        },
        'Property statistics retrieved successfully',
      ),
    );
  } catch (error) {
    next(error);
  }
}
