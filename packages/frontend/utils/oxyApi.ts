/**
 * OxyServices API Utility
 * 
 * This module provides API request functionality using OxyServices for authentication.
 * It replaces the refresh token approach with proper OxyServices token management.
 * 
 * Usage Example:
 * ```typescript
 * import { oxyApiRequest } from '@/utils/oxyApi';
 * import { useOxy } from '@oxyhq/services';
 * 
 * const { oxyServices, activeSessionId } = useOxy();
 * 
 * const data = await oxyApiRequest('/api/properties', {
 *   method: 'POST',
 *   body: JSON.stringify(propertyData)
 * }, oxyServices, activeSessionId);
 * ```
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { OxyServices } from '@oxyhq/services';
import { API_URL } from '@/config';

// API Configuration
const API_BASE_URL = API_URL || Platform.select({
  web: 'http://localhost:4000',
  android: 'http://10.0.2.2:4000', 
  ios: 'http://localhost:4000',
  default: 'http://localhost:4000',
});

// API Error class for consistent error handling
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public data?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Base API request function with OxyServices token management
 * 
 * This function handles authentication using OxyServices instead of refresh tokens.
 * It automatically adds the proper Authorization header using the active session token.
 * 
 * @param endpoint - API endpoint (e.g., '/api/properties')
 * @param options - Fetch options (method, body, etc.)
 * @param oxyServices - OxyServices instance for token management
 * @param activeSessionId - Active session ID for token retrieval
 * @returns Promise with the response data
 */
export async function oxyApiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {},
  oxyServices?: OxyServices,
  activeSessionId?: string
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  // Use OxyServices to get the proper token
  if (oxyServices && activeSessionId) {
    try {
      const tokenData = await oxyServices.getTokenBySession(activeSessionId);
      
      if (!tokenData) {
        throw new ApiError('No authentication token found', 401);
      }
      
      headers['Authorization'] = `Bearer ${tokenData.accessToken}`;
    } catch (error) {
      console.error('Failed to get token:', error);
      throw new ApiError('Authentication failed', 401);
    }
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(
        data.message || data.error || `HTTP ${response.status}`,
        response.status,
        data
      );
    }

    return data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    
    console.error('API Request failed:', error);
    throw new ApiError(
      error instanceof Error ? error.message : 'Network request failed'
    );
  }
}

/**
 * Convenience wrapper for GET requests
 */
export async function oxyApiGet<T = any>(
  endpoint: string,
  params?: Record<string, any>,
  oxyServices?: OxyServices,
  activeSessionId?: string
): Promise<T> {
  const searchParams = params ? new URLSearchParams(params).toString() : '';
  const url = searchParams ? `${endpoint}?${searchParams}` : endpoint;
  
  return oxyApiRequest<T>(url, { method: 'GET' }, oxyServices, activeSessionId);
}

/**
 * Convenience wrapper for POST requests
 */
export async function oxyApiPost<T = any>(
  endpoint: string,
  data?: any,
  oxyServices?: OxyServices,
  activeSessionId?: string
): Promise<T> {
  return oxyApiRequest<T>(
    endpoint,
    {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    },
    oxyServices,
    activeSessionId
  );
}

/**
 * Convenience wrapper for PUT requests
 */
export async function oxyApiPut<T = any>(
  endpoint: string,
  data?: any,
  oxyServices?: OxyServices,
  activeSessionId?: string
): Promise<T> {
  return oxyApiRequest<T>(
    endpoint,
    {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    },
    oxyServices,
    activeSessionId
  );
}

/**
 * Convenience wrapper for DELETE requests
 */
export async function oxyApiDelete<T = any>(
  endpoint: string,
  oxyServices?: OxyServices,
  activeSessionId?: string
): Promise<T> {
  return oxyApiRequest<T>(
    endpoint,
    { method: 'DELETE' },
    oxyServices,
    activeSessionId
  );
}