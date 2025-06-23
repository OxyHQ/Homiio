import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '@/store/store';
import { addToFavorites, removeFromFavorites, toggleFavorite } from '@/store/reducers/favoritesReducer';

export const useFavorites = () => {
  const dispatch = useDispatch();
  const favoriteIds = useSelector((state: RootState) => state.favorites.favoriteIds);

  const isFavorite = (propertyId: string) => {
    return favoriteIds.includes(propertyId);
  };

  const addFavorite = (propertyId: string) => {
    dispatch(addToFavorites(propertyId));
  };

  const removeFavorite = (propertyId: string) => {
    dispatch(removeFromFavorites(propertyId));
  };

  const toggleFavoriteProperty = (propertyId: string) => {
    dispatch(toggleFavorite(propertyId));
  };

  const getFavoriteCount = () => {
    return favoriteIds.length;
  };

  return {
    favoriteIds,
    isFavorite,
    addFavorite,
    removeFavorite,
    toggleFavoriteProperty,
    getFavoriteCount,
  };
}; 