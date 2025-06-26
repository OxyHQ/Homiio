import { combineReducers, configureStore } from "@reduxjs/toolkit";
import trendsReducer from "./reducers/trendsReducer";
import analyticsReducer from "./reducers/analyticsReducer";
import profileReducer from "./reducers/profileReducer";
import bottomSheetReducer from "./reducers/bottomSheetReducer";
import propertyReducer from "./reducers/propertyReducer";
import recentlyViewedReducer from "./reducers/recentlyViewedReducer";
import trustScoreReducer from "./reducers/trustScoreReducer";
import savedPropertiesReducer from "./reducers/savedPropertiesReducer";

const rootReducer = combineReducers({
  trends: trendsReducer,
  analytics: analyticsReducer,
  profile: profileReducer,
  bottomSheet: bottomSheetReducer,
  properties: propertyReducer,
  recentlyViewed: recentlyViewedReducer,
  trustScore: trustScoreReducer,
  savedProperties: savedPropertiesReducer,
});

export const store = configureStore({
  reducer: rootReducer,
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
