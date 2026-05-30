// Base URLs
export const API_URL = process.env.API_URL || 'http://localhost:4000';
export const API_URL_SOCKET = process.env.API_URL_SOCKET || 'ws://localhost:4000';
export const OXY_BASE_URL =
  process.env.EXPO_PUBLIC_OXY_BASE_URL ||
  (process.env.NODE_ENV === 'production' ? 'https://api.oxy.so' : 'http://192.168.86.44:3001');
