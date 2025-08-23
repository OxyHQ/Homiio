const { Property } = require('../../models');
const { AppError, paginationResponse } = require('../../middlewares/errorHandler');

// Core search builder utils could be shared later

export async function searchProperties(req, res, next) {
  try {
    const { query, type, minRent, maxRent, city, state, bedrooms, bathrooms, minBedrooms, maxBedrooms, minBathrooms, maxBathrooms, minSquareFootage, maxSquareFootage, minYearBuilt, maxYearBuilt, amenities, available, hasPhotos, verified, eco, housingType, layoutType, furnishedStatus, petFriendly, utilitiesIncluded, parkingType, petPolicy, leaseTerm, priceUnit, proximityToTransport, proximityToSchools, proximityToShopping, availableFromBefore, availableFromAfter, excludeIds, lat, lng, radius, bounds, budgetFriendly, page = 1, limit = 10 } = req.query;
    const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const andConditions = [];
    if (type) andConditions.push({ type });
    if (city) andConditions.push({ 'address.city': new RegExp(String(city), 'i') });
    if (state) andConditions.push({ 'address.state': new RegExp(String(state), 'i') });
    if (minRent || maxRent) {
      const rentFilter = {} as any; if (minRent) rentFilter.$gte = parseInt(String(minRent)); if (maxRent) rentFilter.$lte = parseInt(String(maxRent)); andConditions.push({ 'rent.amount': rentFilter });
    }
    if (minBedrooms || maxBedrooms) { const br:any={}; if (minBedrooms) br.$gte=parseInt(String(minBedrooms)); if (maxBedrooms) br.$lte=parseInt(String(maxBedrooms)); andConditions.push({ bedrooms: br }); } else if (bedrooms) andConditions.push({ bedrooms: parseInt(String(bedrooms)) });
    if (minBathrooms || maxBathrooms) { const ba:any={}; if (minBathrooms) ba.$gte=parseInt(String(minBathrooms)); if (maxBathrooms) ba.$lte=parseInt(String(maxBathrooms)); andConditions.push({ bathrooms: ba }); } else if (bathrooms) andConditions.push({ bathrooms: parseInt(String(bathrooms)) });
    if (minSquareFootage || maxSquareFootage) { const sf:any={}; if (minSquareFootage) sf.$gte=parseInt(String(minSquareFootage)); if (maxSquareFootage) sf.$lte=parseInt(String(maxSquareFootage)); andConditions.push({ squareFootage: sf }); }
    if (minYearBuilt || maxYearBuilt) { const yb:any={}; if (minYearBuilt) yb.$gte=parseInt(String(minYearBuilt)); if (maxYearBuilt) yb.$lte=parseInt(String(maxYearBuilt)); andConditions.push({ yearBuilt: yb }); }
    if (amenities) { const list = String(amenities).split(',').map(a=>a.trim()).filter(Boolean); andConditions.push({ amenities: { $in: list } }); }
    if (hasPhotos==='true') andConditions.push({ 'images.url': { $exists:true, $nin:[null,''] }});
    if (verified==='true') andConditions.push({ isVerified: true });
    if (eco==='true') andConditions.push({ isEcoFriendly: true });
    if (housingType) andConditions.push({ housingType: String(housingType) });
    if (layoutType) andConditions.push({ layoutType: String(layoutType) });
    if (furnishedStatus) andConditions.push({ furnishedStatus: String(furnishedStatus) });
    if (petPolicy) andConditions.push({ petPolicy: String(petPolicy) });
    if (leaseTerm) andConditions.push({ leaseTerm: String(leaseTerm) });
    if (priceUnit) andConditions.push({ priceUnit: String(priceUnit) });
    if (parkingType) andConditions.push({ parkingType: String(parkingType) });
    if (petFriendly!==undefined) andConditions.push({ petFriendly: String(petFriendly)==='true' });
    if (utilitiesIncluded!==undefined) andConditions.push({ utilitiesIncluded: String(utilitiesIncluded)==='true' });
    if (proximityToTransport!==undefined) andConditions.push({ proximityToTransport: String(proximityToTransport)==='true' });
    if (proximityToSchools!==undefined) andConditions.push({ proximityToSchools: String(proximityToSchools)==='true' });
    if (proximityToShopping!==undefined) andConditions.push({ proximityToShopping: String(proximityToShopping)==='true' });
    if (availableFromBefore || availableFromAfter) { const af:any={}; if (availableFromAfter){ const d=new Date(String(availableFromAfter)); if(!isNaN(d.getTime())) af.$gte=d;} if (availableFromBefore){ const d=new Date(String(availableFromBefore)); if(!isNaN(d.getTime())) af.$lte=d;} if(Object.keys(af).length) andConditions.push({ availableFrom: af }); }
    const effAvailable = available!==undefined ? available==='true': undefined; if (effAvailable!==undefined) andConditions.push({ 'availability.isAvailable': effAvailable }); else andConditions.push({ 'availability.isAvailable': true });
    andConditions.push({ status: 'active' });
    if (excludeIds) { try { const mongoose = require('mongoose'); const list = String(excludeIds).split(',').map((s)=>s.trim()).filter(Boolean).filter((id)=>mongoose.Types.ObjectId.isValid(id)).map((id)=> new mongoose.Types.ObjectId(id)); if (list.length) andConditions.push({ _id: { $nin: list } }); } catch {} }
    if (lat && lng && radius) { const latitude=parseFloat(lat); const longitude=parseFloat(lng); const radiusInMeters=parseFloat(radius); if (latitude<-90||latitude>90||longitude<-180||longitude>180) return res.status(400).json({ success:false, message:'Invalid coordinates provided', error:'INVALID_COORDINATES'}); andConditions.push({ 'address.coordinates': { $near: { $geometry: { type:'Point', coordinates:[longitude, latitude]}, $maxDistance: radiusInMeters }}}); }
    // For now, don't filter by coordinates when bounds are provided
    // This will return all properties so we can see if there are any properties at all
    // We can add geospatial filtering back once we confirm properties exist
    const skip = (parseInt(page)-1)*parseInt(limit);
    const baseFilter = andConditions.length? { $and: andConditions }: {};
    const runQuery = async (filter, useTextSort) => { const q = Property.find(filter).skip(skip).limit(parseInt(limit)); const effBudget = (String(budgetFriendly).toLowerCase()==='true'); if (useTextSort) { if (effBudget) q.sort({ score:{ $meta:'textScore'}, 'rent.amount':1 }).select({ score:{ $meta:'textScore'} }); else q.sort({ score:{ $meta:'textScore'} }).select({ score:{ $meta:'textScore'} }); } else { if (effBudget) q.sort({ 'rent.amount':1 }); else q.sort({ createdAt:-1 }); } const [items,count]= await Promise.all([q.lean(), Property.countDocuments(filter)]); return { items, count }; };
    let resultItems=[]; let resultTotal=0;
    if (query) { 
      const textFilter = { ...baseFilter, $text: { $search: String(query) } }; 
      const textRes = await runQuery(textFilter, true); 
      if (textRes.count>0){ 
        resultItems=textRes.items; 
        resultTotal=textRes.count;
      } else { 
        const safe=escapeRegExp(String(query)); 
        const regex=new RegExp(safe,'i'); 
        const regexFilter = { ...baseFilter, $or:[ { title:regex }, { description:regex }, { 'address.city':regex }, { 'address.state':regex }, { 'address.street':regex }, { amenities: regex } ]}; 
        const regexRes = await runQuery(regexFilter,false); 
        resultItems=regexRes.items; 
        resultTotal=regexRes.count; 
      }
    } else { 
      const baseRes = await runQuery(baseFilter,false); 
      resultItems=baseRes.items; 
      resultTotal=baseRes.count; 
      
      // If no results and we have bounds, try without geospatial filter
      if (resultItems.length === 0 && bounds) {
        const fallbackFilter = { ...baseFilter };
        // Remove the geospatial condition
        if (fallbackFilter.$and) {
          fallbackFilter.$and = fallbackFilter.$and.filter(condition => 
            !condition['address.coordinates'] || !condition['address.coordinates'].$geoWithin
          );
        }
        const fallbackRes = await runQuery(fallbackFilter, false);
        resultItems = fallbackRes.items;
        resultTotal = fallbackRes.count;
      }
    }
    res.json(paginationResponse(resultItems, parseInt(page), parseInt(limit), resultTotal, 'Search completed successfully'));
  } catch (error) { next(error); }
}
