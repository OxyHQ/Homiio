import { Property } from '../../models';
import { successResponse, paginationResponse, AppError } from '../../middlewares/errorHandler';
import mongoose from 'mongoose';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';
import { getQueryInteger, getQueryString } from '../queryParams';

export async function getPropertiesByIds(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { ids } = req.query;
    if (!ids) return res.status(400).json({ success:false, message:'ids is required' });
    const list = String(ids).split(',').map((s)=>s.trim()).filter(Boolean).filter((id)=>mongoose.Types.ObjectId.isValid(id)).map((id)=> new mongoose.Types.ObjectId(id));
    if (!list.length) return res.json(paginationResponse([],1,0,0,'No valid IDs provided'));
    const docs = await Property.find({ _id: { $in: list }, status:'active' }).populate('addressId').lean();
    return res.json(successResponse(docs,'Properties fetched by IDs'));
  } catch (error) { next(error); }
}

export async function getPropertiesByOwner(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { oxyUserId } = req.params;
    const exclude = getQueryString(req.query.exclude);
    const page = getQueryInteger(req.query.page, 1);
    const limit = getQueryInteger(req.query.limit, 10);
    if (!oxyUserId || typeof oxyUserId !== 'string') {
      return next(new AppError('Invalid owner id', 400, 'INVALID_ID'));
    }
    const query: Record<string, unknown> = { oxyUserId, status: 'active' };
    if (exclude && mongoose.Types.ObjectId.isValid(exclude)) query._id = { $ne: new mongoose.Types.ObjectId(exclude) };
    const skip = (page - 1) * limit;
    const [properties,total] = await Promise.all([
      Property.find(query).populate('addressId').sort({ createdAt:-1 }).skip(skip).limit(limit).lean(),
      Property.countDocuments(query)
    ]);
    res.json(paginationResponse(properties, page, limit, total, "Owner's properties retrieved successfully"));
  } catch (error) { next(error); }
}
