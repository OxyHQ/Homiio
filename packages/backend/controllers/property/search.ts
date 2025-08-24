const { Property } = require('../../models');
const { AppError, paginationResponse } = require('../../middlewares/errorHandler');

// Core search builder utils could be shared later

export async function searchProperties(req, res, next) {
  try {
    const { query, type, minRent, maxRent, city, state, bedrooms, bathrooms, minBedrooms, maxBedrooms, minBathrooms, maxBathrooms, minSquareFootage, maxSquareFootage, minYearBuilt, maxYearBuilt, amenities, available, hasPhotos, verified, eco, housingType, layoutType, furnishedStatus, petFriendly, utilitiesIncluded, parkingType, petPolicy, leaseTerm, priceUnit, proximityToTransport, proximityToSchools, proximityToShopping, availableFromBefore, availableFromAfter, excludeIds, lat, lng, radius, bounds, budgetFriendly, page = 1, limit = 10 } = req.query;
    const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const andConditions = [];
    if (type) andConditions.push({ type });
    
    // Handle city and state filters with Address lookup
    if (city || state) {
      const { Address } = require('../../models');
      const addressQuery: any = {};
      if (city) addressQuery.city = new RegExp(String(city), 'i');
      if (state) addressQuery.state = new RegExp(String(state), 'i');
      
      console.log('Property search - Address lookup:', { city, state, addressQuery });
      
      const matchingAddresses = await Address.find(addressQuery).select('_id');
      const addressIds = matchingAddresses.map((addr: any) => addr._id);
      
      console.log('Property search - Found addresses:', { 
        count: matchingAddresses.length, 
        addressIds: addressIds.slice(0, 5) 
      });
      
      if (addressIds.length === 0) {
        // No matching addresses found, return empty result
        console.log('Property search - No addresses found for location, returning empty result');
        return res.json(paginationResponse([], parseInt(page), parseInt(limit), 0, 'No properties found for the specified location'));
      }
      
      andConditions.push({ addressId: { $in: addressIds } });
    }
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
    // Handle geospatial search with Address lookup
    if (lat && lng && radius) { 
      const latitude=parseFloat(lat); 
      const longitude=parseFloat(lng); 
      const radiusInMeters=parseFloat(radius); 
      if (latitude<-90||latitude>90||longitude<-180||longitude>180) return res.status(400).json({ success:false, message:'Invalid coordinates provided', error:'INVALID_COORDINATES'}); 
      
      // Find addresses within the radius first
      const { Address } = require('../../models');
      const nearbyAddresses = await Address.find({
        coordinates: { 
          $near: { 
            $geometry: { type:'Point', coordinates:[longitude, latitude]}, 
            $maxDistance: radiusInMeters 
          }
        }
      }).select('_id');
      
      const addressIds = nearbyAddresses.map(addr => addr._id);
      if (addressIds.length === 0) {
        return res.json(paginationResponse([], parseInt(page), parseInt(limit), 0, 'No properties found within the specified radius'));
      }
      
      andConditions.push({ addressId: { $in: addressIds } });
    }
    // For now, don't filter by coordinates when bounds are provided
    // This will return all properties so we can see if there are any properties at all
    // We can add geospatial filtering back once we confirm properties exist
    const skip = (parseInt(page)-1)*parseInt(limit);
    const baseFilter = andConditions.length? { $and: andConditions }: {};
    
    console.log('Property search - Final query setup:', { 
      hasQuery: !!query, 
      baseFilter: JSON.stringify(baseFilter, null, 2),
      skip,
      limit: parseInt(limit)
    });
    
    const runQuery = async (filter, useTextSort) => { 
      console.log('Property search - Running query:', { 
        filter: JSON.stringify(filter, null, 2), 
        useTextSort 
      });
      
      const q = Property.find(filter).populate('addressId').skip(skip).limit(parseInt(limit)); 
      const effBudget = (String(budgetFriendly).toLowerCase()==='true'); 
      if (useTextSort) { 
        if (effBudget) q.sort({ score:{ $meta:'textScore'}, 'rent.amount':1 }).select({ score:{ $meta:'textScore'} }); 
        else q.sort({ score:{ $meta:'textScore'} }).select({ score:{ $meta:'textScore'} }); 
      } else { 
        if (effBudget) q.sort({ 'rent.amount':1 }); 
        else q.sort({ createdAt:-1 }); 
      } 
      const [items,count]= await Promise.all([q.lean(), Property.countDocuments(filter)]); 
      
      console.log('Property search - Query result:', { 
        itemsCount: items.length, 
        totalCount: count 
      });
      
      return { items, count }; 
    };
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
        
        // For address field searches, we need to find matching addresses first
        const { Address } = require('../../models');
        const addressMatches = await Address.find({
          $or: [
            { city: regex },
            { state: regex }, 
            { street: regex }
          ]
        }).select('_id');
        
        const addressIds = addressMatches.map(addr => addr._id);
        
        // Build regex filter with address ID lookup when needed
        let regexOrConditions = [
          { title: regex }, 
          { description: regex }, 
          { amenities: regex }
        ];
        
        if (addressIds.length > 0) {
          regexOrConditions.push({ addressId: { $in: addressIds } });
        }
        
        const regexFilter = { ...baseFilter, $or: regexOrConditions }; 
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
        // Remove any geospatial conditions from addressId lookups
        if (fallbackFilter.$and) {
          fallbackFilter.$and = fallbackFilter.$and.filter(condition => {
            // Keep all conditions except those that might be geospatial address lookups
            // Since we've already converted to addressId lookups, this is less of a concern
            return true; 
          });
        }
        const fallbackRes = await runQuery(fallbackFilter, false);
        resultItems = fallbackRes.items;
        resultTotal = fallbackRes.count;
      }
    }
    
    console.log('Property search - Final results:', { 
      resultItems: resultItems.length, 
      resultTotal,
      query: query || 'no query'
    });
    
    res.json(paginationResponse(resultItems, parseInt(page), parseInt(limit), resultTotal, 'Search completed successfully'));
  } catch (error) { next(error); }
}
