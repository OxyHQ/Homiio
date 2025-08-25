const { Property } = require('../../models');
const { AppError, successResponse } = require('../../middlewares/errorHandler');

export async function getPropertyStats(req, res, next) {
  try {
    const { propertyId } = req.params;
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(propertyId)) return next(new AppError('Invalid property ID', 400, 'INVALID_ID'));
    const exists = await Property.exists({ _id: propertyId });
    if (!exists) return next(new AppError('Property not found', 404, 'NOT_FOUND'));
    const { Saved, Lease } = require('../../models');
    let savesCount = await Saved.countDocuments({ targetType: 'property', targetId: new mongoose.Types.ObjectId(propertyId) }).catch(()=>0);
    const now = new Date();
    const objId = new mongoose.Types.ObjectId(propertyId);
    
    // Use Property model with type='room' filter instead of separate Room model
    const [ totalRoomsResult, occupiedRoomsResult, availableRoomsResult, leaseAgg, roomRentAgg, propertyDoc ] = await Promise.all([
      Property.countDocuments({ $or: [{ parentPropertyId: objId }, { _id: objId, type: 'room' }] }).catch(()=>0),
      Property.countDocuments({ 
        $and: [
          { $or: [{ parentPropertyId: objId }, { _id: objId, type: 'room' }] },
          { $or: [{ 'occupancy.currentOccupants': { $gt: 0 } }, { status: 'occupied' }] }
        ]
      }).catch(()=>0),
      Property.countDocuments({ 
        $and: [
          { $or: [{ parentPropertyId: objId }, { _id: objId, type: 'room' }] },
          { status: 'active', 'availability.isAvailable': true }
        ]
      }).catch(()=>0),
      Lease.aggregate([{ $match: { propertyId: objId, status: 'active', 'leaseTerms.startDate': { $lte: now }, 'leaseTerms.endDate': { $gte: now } }}, { $group: { _id: null, total: { $sum: '$rentDetails.monthlyRent' }, avg: { $avg: '$rentDetails.monthlyRent' }, count: { $sum: 1 }}}]).catch(()=>[]),
      Property.aggregate([{ $match: { $or: [{ parentPropertyId: objId }, { _id: objId, type: 'room' }], 'rent.amount': { $gt: 0 } }}, { $group: { _id: null, avg: { $avg: '$rent.amount' }, count: { $sum: 1 }}}]).catch(()=>[]),
      Property.findById(propertyId).select('rent').lean().catch(()=>null)
    ]);
    const totalRooms = typeof totalRoomsResult === 'number'? totalRoomsResult:0;
    const occupiedRooms = typeof occupiedRoomsResult === 'number'? occupiedRoomsResult:0;
    const availableRooms = typeof availableRoomsResult === 'number'? availableRoomsResult: Math.max(totalRooms-occupiedRooms,0);
    const leaseTotals = Array.isArray(leaseAgg) && leaseAgg[0]? leaseAgg[0]: { total:0, avg:null, count:0 };
    const monthlyRevenue = leaseTotals.total || 0;
    let averageRent=0; if (leaseTotals.count>0 && leaseTotals.avg!=null) averageRent=leaseTotals.avg; else if (Array.isArray(roomRentAgg) && roomRentAgg[0]?.avg!=null) averageRent=roomRentAgg[0].avg; else if (propertyDoc?.rent?.amount!=null) averageRent=propertyDoc.rent.amount;
    const occupancyRate = totalRooms>0? Math.round((occupiedRooms/totalRooms)*100):0;
    const stats = { totalRooms, occupiedRooms, availableRooms, monthlyRevenue, averageRent, occupancyRate, savesCount };
    res.json(successResponse(stats, 'Property statistics retrieved successfully'));
  } catch (error) { next(error); }
}