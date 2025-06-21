import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { OxyServices } from '@oxyhq/services';

import axios, { AxiosError, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { router } from 'expo-router';
import { toast } from 'sonner';
import { getData, storeData } from './storage';
import { disconnectSocket } from './socket';
import { API_URL } from '@/config';

// Global OxyServices instance and session ID
let globalOxyServices: OxyServices | null = null;
let globalActiveSessionId: string | null = null;

// Function to set OxyServices instance
export function setOxyServices(oxyServices: OxyServices, activeSessionId: string) {
  globalOxyServices = oxyServices;
  globalActiveSessionId = activeSessionId;
}

export function clearOxyServices() {
  globalOxyServices = null;
  globalActiveSessionId = null;
}

export function getOxyServices() {
  return { oxyServices: globalOxyServices, activeSessionId: globalActiveSessionId };
}

// Cache interface
interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  expiration: number;
}

// In-memory cache
const cache = new Map<string, CacheEntry>();

// Base API request function with OxyServices token management
async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {},
  oxyServices?: OxyServices,
  activeSessionId?: string
): Promise<T> {
  const url = `${API_URL}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  // Use OxyServices to get the proper token
  if (oxyServices && activeSessionId) {
    try {
      const tokenData = await oxyServices.getTokenBySession(activeSessionId);
      
      if (!tokenData) {
        toast.error('No authentication token found');
        throw new Error('No authentication token found');
      }
      
      headers['Authorization'] = `Bearer ${tokenData.accessToken}`;
    } catch (error) {
      console.error('Failed to get token:', error);
      toast.error('Authentication failed');
      throw new Error('Authentication failed');
    }
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMessage = data.message || data.error || `HTTP ${response.status}`;
      toast.error(errorMessage);
      throw new Error(errorMessage);
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      // Don't show toast again if we already showed it above
      if (!error.message.includes('HTTP')) {
        toast.error(error.message);
      }
      throw error;
    }
    
    console.error('API Request failed:', error);
    const errorMessage = 'Network request failed';
    toast.error(errorMessage);
    throw new Error(errorMessage);
  }
}

// Create axios instance
const api = axios.create({
  baseURL: API_URL,
  timeout: 15000, // Increase timeout to 15 seconds
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    try {
      console.log('API Request interceptor - URL:', config.url);
      console.log('API Request interceptor - Method:', config.method);
      console.log('API Request interceptor - Global OxyServices available:', !!globalOxyServices);
      console.log('API Request interceptor - Global ActiveSessionId:', globalActiveSessionId);
      
      // Use OxyServices if available
      if (globalOxyServices && globalActiveSessionId) {
        console.log('API Request interceptor - Getting token from OxyServices...');
        const tokenData = await globalOxyServices.getTokenBySession(globalActiveSessionId);
        
        if (tokenData) {
          console.log('API Request interceptor - Token obtained successfully');
          config.headers.Authorization = `Bearer ${tokenData.accessToken}`;
          return config;
        } else {
          console.log('API Request interceptor - No token data from OxyServices');
        }
      }
      
      // Fallback to legacy token
      console.log('API Request interceptor - Trying legacy token...');
      const token = await getData('authToken');
      if (token) {
        console.log('API Request interceptor - Legacy token found');
        config.headers.Authorization = `Bearer ${token}`;
      } else {
        console.log('API Request interceptor - No legacy token found');
      }
    } catch (error) {
      console.error('API Request interceptor - Failed to get auth token:', error);
    }
    return config;
  },
  (error: AxiosError) => {
    console.error('API Request interceptor - Error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor
api.interceptors.response.use(
  (response: AxiosResponse) => {
    console.log('API Response interceptor - Success:', {
      url: response.config.url,
      method: response.config.method,
      status: response.status,
      statusText: response.statusText
    });
    return response;
  },
  async (error: AxiosError) => {
    console.log('API Response interceptor - Error:', {
      url: error.config?.url,
      method: error.config?.method,
      status: error.response?.status,
      statusText: error.response?.statusText,
      message: error.message,
      responseData: error.response?.data
    });
    
    const status = error.response?.status;
    
    if (status === 401) {
      // Handle unauthorized access
      await storeData('authToken', null);
      disconnectSocket();
      toast.error('Session expired. Please login again.');
      router.replace('/(auth)/login');
    } else if (status === 403) {
      toast.error('Access denied');
    } else if (status && status >= 500) {
      toast.error('Server error. Please try again later.');
    } else if (error.message === 'Network Error') {
      toast.error('Network error. Please check your connection.');
    }
    
    return Promise.reject(error);
  }
);

// Cache management functions
export function getCacheKey(url: string, params?: Record<string, any>): string {
  const paramString = params ? JSON.stringify(params) : '';
  return `${url}${paramString}`;
}

export function setCacheEntry<T>(key: string, data: T, ttl: number = 300000): void {
  const expiration = Date.now() + ttl;
  cache.set(key, { data, timestamp: Date.now(), expiration });
}

export function getCacheEntry<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  
  if (Date.now() > entry.expiration) {
    cache.delete(key);
    return null;
  }
  
  return entry.data as T;
}

export function clearCache(keyPattern?: string): void {
  if (!keyPattern) {
    cache.clear();
    return;
  }
  
  for (const key of cache.keys()) {
    if (key.includes(keyPattern)) {
      cache.delete(key);
    }
  }
}

export function getCacheSize(): number {
  return cache.size;
}

export function cleanExpiredCache(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiration) {
      cache.delete(key);
    }
  }
}

// Web-compatible alert function
export function webAlert(title: string, message: string, buttons?: Array<{ text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }>) {
  if (Platform.OS === 'web') {
    if (buttons && buttons.length > 1) {
      // For confirmation dialogs, use browser confirm
      const result = window.confirm(`${title}\n\n${message}`);
      if (result) {
        // Find the non-cancel button and call its onPress
        const confirmButton = buttons.find(btn => btn.style !== 'cancel');
        if (confirmButton?.onPress) {
          confirmButton.onPress();
        }
      } else {
        // Find the cancel button and call its onPress
        const cancelButton = buttons.find(btn => btn.style === 'cancel');
        if (cancelButton?.onPress) {
          cancelButton.onPress();
        }
      }
    } else {
      // For simple alerts, use browser alert
      window.alert(`${title}\n\n${message}`);
      if (buttons?.[0]?.onPress) {
        buttons[0].onPress();
      }
    }
  } else {
    // On mobile, use React Native Alert
    const { Alert } = require('react-native');
    Alert.alert(title, message, buttons);
  }
}

// Export the axios instance as default
export default api;