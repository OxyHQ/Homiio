import { combineReducers, configureStore } from "@reduxjs/toolkit";
import trendsReducer from "./reducers/trendsReducer";
import analyticsReducer from "./reducers/analyticsReducer";
import profileReducer from "./reducers/profileReducer";
import bottomSheetReducer from "./reducers/bottomSheetReducer";
import propertyReducer from "./reducers/propertyReducer";
import roomReducer from "./reducers/roomReducer";
import recentlyViewedReducer from "./reducers/recentlyViewedReducer";
import trustScoreReducer from "./reducers/trustScoreReducer";
import savedPropertiesReducer from "./reducers/savedPropertiesReducer";
import savedSearchesReducer from "./reducers/savedSearchesReducer";

const rootReducer = combineReducers({
  trends: trendsReducer,
  analytics: analyticsReducer,
  profile: profileReducer,
  bottomSheet: bottomSheetReducer,
  properties: propertyReducer,
  rooms: roomReducer,
  recentlyViewed: recentlyViewedReducer,
  trustScore: trustScoreReducer,
  savedProperties: savedPropertiesReducer,
  savedSearches: savedSearchesReducer,
});

export const store = configureStore({
  reducer: rootReducer,
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
