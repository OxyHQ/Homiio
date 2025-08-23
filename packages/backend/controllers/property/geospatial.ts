const { Property } = require('../../models');
const { paginationResponse, AppError } = require('../../middlewares/errorHandler');

export async function findNearbyProperties(req, res, next) {
  try {
    const { longitude, latitude, maxDistance = 10000, minRent, maxRent, type, bedrooms, bathrooms, minBedrooms, maxBedrooms, minBathrooms, maxBathrooms, minSquareFootage, maxSquareFootage, minYearBuilt, maxYearBuilt, amenities, available, hasPhotos, verified, eco, housingType, layoutType, furnishedStatus, petFriendly, utilitiesIncluded, parkingType, petPolicy, leaseTerm, priceUnit, proximityToTransport, proximityToSchools, proximityToShopping, availableFromBefore, availableFromAfter, excludeIds, page = 1, limit = 10 } = req.query;
    if (!longitude || !latitude) return res.status(400).json({ success:false, message:'Longitude and latitude are required', error:'MISSING_COORDINATES'});
    const lng=parseFloat(longitude); const lat=parseFloat(latitude); const distance=parseFloat(maxDistance);
    if (lat<-90||lat>90||lng<-180||lng>180) return res.status(400).json({ success:false, message:'Invalid coordinates provided', error:'INVALID_COORDINATES'});
    const searchQuery:any = { 'address.coordinates': { $near: { $geometry:{ type:'Point', coordinates:[lng,lat]}, $maxDistance: distance }}, 'availability.isAvailable': available!==undefined? available==='true': true, status:'active' };
    if (excludeIds) { try { const mongoose=require('mongoose'); const list=String(excludeIds).split(',').map(s=>s.trim()).filter(Boolean).filter(id=>mongoose.Types.ObjectId.isValid(id)).map(id=> new mongoose.Types.ObjectId(id)); if(list.length) searchQuery._id={ $nin:list }; } catch {} }
    if (type) searchQuery.type=type;
    if (minRent||maxRent){ searchQuery['rent.amount']={}; if(minRent) searchQuery['rent.amount'].$gte=parseInt(String(minRent)); if(maxRent) searchQuery['rent.amount'].$lte=parseInt(String(maxRent)); }
    if (minBedrooms||maxBedrooms){ const br:any={}; if(minBedrooms) br.$gte=parseInt(String(minBedrooms)); if(maxBedrooms) br.$lte=parseInt(String(maxBedrooms)); searchQuery.bedrooms=br;} else if (bedrooms) searchQuery.bedrooms=parseInt(String(bedrooms));
    if (minBathrooms||maxBathrooms){ const ba:any={}; if(minBathrooms) ba.$gte=parseInt(String(minBathrooms)); if(maxBathrooms) ba.$lte=parseInt(String(maxBathrooms)); searchQuery.bathrooms=ba;} else if (bathrooms) searchQuery.bathrooms=parseInt(String(bathrooms));
    if (minSquareFootage||maxSquareFootage){ const sf:any={}; if(minSquareFootage) sf.$gte=parseInt(String(minSquareFootage)); if(maxSquareFootage) sf.$lte=parseInt(String(maxSquareFootage)); searchQuery.squareFootage=sf; }
    if (minYearBuilt||maxYearBuilt){ const yb:any={}; if(minYearBuilt) yb.$gte=parseInt(String(minYearBuilt)); if(maxYearBuilt) yb.$lte=parseInt(String(maxYearBuilt)); searchQuery.yearBuilt=yb; }
    if (amenities){ const list=String(amenities).split(',').map(a=>a.trim()).filter(Boolean); if(list.length) searchQuery.amenities={ $in:list }; }
    if (hasPhotos==='true') searchQuery['images.url']={ $exists:true, $nin:[null,''] };
    if (verified==='true') searchQuery.isVerified=true;
    if (eco==='true') searchQuery.isEcoFriendly=true;
    if (housingType) searchQuery.housingType=String(housingType);
    if (layoutType) searchQuery.layoutType=String(layoutType);
    if (furnishedStatus) searchQuery.furnishedStatus=String(furnishedStatus);
    if (petPolicy) searchQuery.petPolicy=String(petPolicy);
    if (leaseTerm) searchQuery.leaseTerm=String(leaseTerm);
    if (priceUnit) searchQuery.priceUnit=String(priceUnit);
    if (parkingType) searchQuery.parkingType=String(parkingType);
    if (petFriendly!==undefined) searchQuery.petFriendly=String(petFriendly)==='true';
    if (utilitiesIncluded!==undefined) searchQuery.utilitiesIncluded=String(utilitiesIncluded)==='true';
    if (proximityToTransport!==undefined) searchQuery.proximityToTransport=String(proximityToTransport)==='true';
    if (proximityToSchools!==undefined) searchQuery.proximityToSchools=String(proximityToSchools)==='true';
    if (proximityToShopping!==undefined) searchQuery.proximityToShopping=String(proximityToShopping)==='true';
    if (availableFromBefore||availableFromAfter){ const af:any={}; if(availableFromAfter){ const d=new Date(String(availableFromAfter)); if(!isNaN(d.getTime())) af.$gte=d;} if(availableFromBefore){ const d=new Date(String(availableFromBefore)); if(!isNaN(d.getTime())) af.$lte=d;} if(Object.keys(af).length) searchQuery.availableFrom=af; }
    const skip=(parseInt(page)-1)*parseInt(limit);
    const [properties,total]= await Promise.all([
      Property.find(searchQuery).sort({ 'address.coordinates':{ $meta:'geoNear'}}).skip(skip).limit(parseInt(limit)).lean(),
      Property.countDocuments(searchQuery)
    ]);
    res.json(paginationResponse(properties, parseInt(page), parseInt(limit), total, 'Nearby properties found successfully'));
  } catch (error) { next(error); }
}

export async function findPropertiesInRadius(req, res, next) {
  try {
    const { longitude, latitude, radius, minRent, maxRent, type, bedrooms, bathrooms, minBedrooms, maxBedrooms, minBathrooms, maxBathrooms, minSquareFootage, maxSquareFootage, minYearBuilt, maxYearBuilt, amenities, available, hasPhotos, verified, eco, housingType, layoutType, furnishedStatus, petFriendly, utilitiesIncluded, parkingType, petPolicy, leaseTerm, priceUnit, proximityToTransport, proximityToSchools, proximityToShopping, availableFromBefore, availableFromAfter, excludeIds, page=1, limit=10 } = req.query;
    if (!longitude || !latitude || !radius) return res.status(400).json({ success:false, message:'Longitude, latitude, and radius are required', error:'MISSING_PARAMETERS'});
    const lng=parseFloat(longitude); const lat=parseFloat(latitude); const radiusInMeters=parseFloat(radius);
    if (lat<-90||lat>90||lng<-180||lng>180) return res.status(400).json({ success:false, message:'Invalid coordinates provided', error:'INVALID_COORDINATES'});
    const searchQuery:any = { 'address.coordinates': { $geoWithin: { $centerSphere: [[lng,lat], radiusInMeters/6371000] } }, 'availability.isAvailable': available!==undefined? available==='true': true, status:'active' };
    if (excludeIds) { try { const mongoose=require('mongoose'); const list=String(excludeIds).split(',').map(s=>s.trim()).filter(Boolean).filter(id=>mongoose.Types.ObjectId.isValid(id)).map(id=> new mongoose.Types.ObjectId(id)); if(list.length) searchQuery._id={ $nin:list }; } catch {} }
    if (type) searchQuery.type=type;
    if (minRent||maxRent){ searchQuery['rent.amount']={}; if(minRent) searchQuery['rent.amount'].$gte=parseInt(String(minRent)); if(maxRent) searchQuery['rent.amount'].$lte=parseInt(String(maxRent)); }
    if (minBedrooms||maxBedrooms){ const br:any={}; if(minBedrooms) br.$gte=parseInt(String(minBedrooms)); if(maxBedrooms) br.$lte=parseInt(String(maxBedrooms)); searchQuery.bedrooms=br;} else if (bedrooms) searchQuery.bedrooms=parseInt(String(bedrooms));
    if (minBathrooms||maxBathrooms){ const ba:any={}; if(minBathrooms) ba.$gte=parseInt(String(minBathrooms)); if(maxBathrooms) ba.$lte=parseInt(String(maxBathrooms)); searchQuery.bathrooms=ba;} else if (bathrooms) searchQuery.bathrooms=parseInt(String(bathrooms));
    if (minSquareFootage||maxSquareFootage){ const sf:any={}; if(minSquareFootage) sf.$gte=parseInt(String(minSquareFootage)); if(maxSquareFootage) sf.$lte=parseInt(String(maxSquareFootage)); searchQuery.squareFootage=sf; }
    if (minYearBuilt||maxYearBuilt){ const yb:any={}; if(minYearBuilt) yb.$gte=parseInt(String(minYearBuilt)); if(maxYearBuilt) yb.$lte=parseInt(String(maxYearBuilt)); searchQuery.yearBuilt=yb; }
    if (amenities){ const list=String(amenities).split(',').map(a=>a.trim()).filter(Boolean); if(list.length) searchQuery.amenities={ $in:list }; }
    if (hasPhotos==='true') searchQuery['images.url']={ $exists:true, $nin:[null,''] };
    if (verified==='true') searchQuery.isVerified=true;
    if (eco==='true') searchQuery.isEcoFriendly=true;
    if (housingType) searchQuery.housingType=String(housingType);
    if (layoutType) searchQuery.layoutType=String(layoutType);
    if (furnishedStatus) searchQuery.furnishedStatus=String(furnishedStatus);
    if (petPolicy) searchQuery.petPolicy=String(petPolicy);
    if (leaseTerm) searchQuery.leaseTerm=String(leaseTerm);
    if (priceUnit) searchQuery.priceUnit=String(priceUnit);
    if (parkingType) searchQuery.parkingType=String(parkingType);
    if (petFriendly!==undefined) searchQuery.petFriendly=String(petFriendly)==='true';
    if (utilitiesIncluded!==undefined) searchQuery.utilitiesIncluded=String(utilitiesIncluded)==='true';
    if (proximityToTransport!==undefined) searchQuery.proximityToTransport=String(proximityToTransport)==='true';
    if (proximityToSchools!==undefined) searchQuery.proximityToSchools=String(proximityToSchools)==='true';
    if (proximityToShopping!==undefined) searchQuery.proximityToShopping=String(proximityToShopping)==='true';
    if (availableFromBefore||availableFromAfter){ const af:any={}; if(availableFromAfter){ const d=new Date(String(availableFromAfter)); if(!isNaN(d.getTime())) af.$gte=d;} if(availableFromBefore){ const d=new Date(String(availableFromBefore)); if(!isNaN(d.getTime())) af.$lte=d;} if(Object.keys(af).length) searchQuery.availableFrom=af; }
    const skip=(parseInt(page)-1)*parseInt(limit);
    const [properties,total]= await Promise.all([
      Property.find(searchQuery).sort({ createdAt:-1 }).skip(skip).limit(parseInt(limit)).lean(),
      Property.countDocuments(searchQuery)
    ]);
    res.json(paginationResponse(properties, parseInt(page), parseInt(limit), total, 'Properties in radius found successfully'));
  } catch (error) { next(error); }
}
