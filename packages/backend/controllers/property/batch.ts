const { Property } = require('../../models');
const { successResponse, paginationResponse, AppError } = require('../../middlewares/errorHandler');

export async function getPropertiesByIds(req, res, next) {
  try {
    const { ids } = req.query;
    if (!ids) return res.status(400).json({ success:false, message:'ids is required' });
    const mongoose = require('mongoose');
    const list = String(ids).split(',').map((s)=>s.trim()).filter(Boolean).filter((id)=>mongoose.Types.ObjectId.isValid(id)).map((id)=> new mongoose.Types.ObjectId(id));
    if (!list.length) return res.json(paginationResponse([],1,0,0,'No valid IDs provided'));
    const docs = await Property.find({ _id: { $in: list }, status:'active' }).populate('addressId').lean();
    return res.json(successResponse(docs,'Properties fetched by IDs'));
  } catch (error) { next(error); }
}

export async function getPropertiesByOwner(req, res, next) {
  try {
    const { profileId } = req.params; const { exclude, page=1, limit=10 } = req.query; const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(profileId)) return next(new AppError('Invalid profile ID',400,'INVALID_ID'));
    const query:any = { profileId: new mongoose.Types.ObjectId(profileId), status:'active' };
    if (exclude && mongoose.Types.ObjectId.isValid(exclude)) query._id = { $ne: new mongoose.Types.ObjectId(exclude) };
    const skip = (parseInt(page)-1)*parseInt(limit);
    const [properties,total] = await Promise.all([
      Property.find(query).populate('addressId').sort({ createdAt:-1 }).skip(skip).limit(parseInt(limit)).lean(),
      Property.countDocuments(query)
    ]);
    res.json(paginationResponse(properties, parseInt(page), parseInt(limit), total, "Owner's properties retrieved successfully"));
  } catch (error) { next(error); }
}
