import { Alert, Platform } from 'react-native';
import { oxyClient } from '@oxyhq/services';
import { API_URL } from '@/config';

// API Configuration
const API_CONFIG = {
  baseURL: API_URL,
};

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}

/**
 * Custom API Error class for handling API-specific errors
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public response?: any,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const extractErrorMessage = (data: any, status: number): string => {
  if (!data) return `HTTP ${status}`;
  if (typeof data.message === 'string' && data.message.trim()) return data.message;
  if (typeof data.error === 'string' && data.error.trim()) return data.error;
  // Handle common validation/error shapes
  if (data.error && typeof data.error === 'object') {
    const err = data.error;
    // Mongoose ValidationError format
    if (err.errors && typeof err.errors === 'object') {
      const details = Object.values(err.errors)
        .map((e: any) => (typeof e?.message === 'string' ? e.message : ''))
        .filter(Boolean)
        .join('; ');
      if (details) return details;
    }
    // Generic object -> try string fields
    if (typeof err.message === 'string' && err.message.trim()) return err.message;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return `HTTP ${status}`;
  }
}

/**
 * Standard REST API methods for consistent usage across the app
 */
export const api = {
  /**
   * GET request
   */
  async get<T = any>(
    endpoint: string,
    options?: {
      params?: Record<string, any>;
      requireAuth?: boolean;
    },
  ): Promise<{ data: T }> {

    const url = new URL(`${API_CONFIG.baseURL}${endpoint}`);

    // Add query parameters if provided
    if (options?.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Handle authentication if required
    if (options?.requireAuth !== false) {
      try {
        const token = await oxyClient.getAccessToken();


        headers['Authorization'] = `Bearer ${token}`;
      } catch (error) {
        console.error('Failed to get token:', error);
        throw new ApiError('Authentication failed', 401);
      }
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(extractErrorMessage(data, response.status), response.status, data);
    }

    return { data };
  },

  /**
   * POST request
   */
  async post<T = any>(
    endpoint: string,
    body?: any,
    options?: {
      requireAuth?: boolean;
    },
  ): Promise<{ data: T }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Handle authentication if required
    if (options?.requireAuth !== false) {
      try {
        const token = await oxyClient.getAccessToken();


        headers['Authorization'] = `Bearer ${token}`;
      } catch (error) {
        console.error('Failed to get token:', error);
        throw new ApiError('Authentication failed', 401);
      }
    }

    const response = await fetch(`${API_CONFIG.baseURL}${endpoint}`, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(extractErrorMessage(data, response.status), response.status, data);
    }

    return { data };
  },

  /**
   * PUT request
   */
  async put<T = any>(
    endpoint: string,
    body?: any,
    options?: {
      requireAuth?: boolean;
    },
  ): Promise<{ data: T }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Handle authentication if required
    if (options?.requireAuth !== false) {
      try {
        const token = await oxyClient.getAccessToken();


        headers['Authorization'] = `Bearer ${token}`;
      } catch (error) {
        console.error('Failed to get token:', error);
        throw new ApiError('Authentication failed', 401);
      }
    }

    const response = await fetch(`${API_CONFIG.baseURL}${endpoint}`, {
      method: 'PUT',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(extractErrorMessage(data, response.status), response.status, data);
    }

    return { data };
  },

  /**
   * DELETE request
   */
  async delete<T = any>(
    endpoint: string,
    options?: {
      requireAuth?: boolean;
    },
  ): Promise<{ data: T }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Handle authentication if required
    if (options?.requireAuth !== false) {
      try {
        const token = await oxyClient.getAccessToken();


        headers['Authorization'] = `Bearer ${token}`;
      } catch (error) {
        console.error('Failed to get token:', error);
        throw new ApiError('Authentication failed', 401);
      }
    }

    const response = await fetch(`${API_CONFIG.baseURL}${endpoint}`, {
      method: 'DELETE',
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(extractErrorMessage(data, response.status), response.status, data);
    }

    return { data };
  },

  /**
   * PATCH request
   */
  async patch<T = any>(
    endpoint: string,
    body?: any,
    options?: {
      requireAuth?: boolean;
    },
  ): Promise<{ data: T }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Handle authentication if required
    if (options?.requireAuth !== false) {
      try {
        const token = await oxyClient.getAccessToken();


        headers['Authorization'] = `Bearer ${token}`;
      } catch (error) {
        console.error('Failed to get token:', error);
        throw new ApiError('Authentication failed', 401);
      }
    }

    const response = await fetch(`${API_CONFIG.baseURL}${endpoint}`, {
      method: 'PATCH',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(extractErrorMessage(data, response.status), response.status, data);
    }

    return { data };
  },
};

// Web-compatible alert function
export function webAlert(
  title: string,
  message: string,
  buttons?: {
    text: string;
    style?: 'default' | 'cancel' | 'destructive';
    onPress?: () => void;
  }[],
) {
  if (Platform.OS === 'web') {
    if (buttons && buttons.length > 1) {
      // For confirmation dialogs, use browser confirm
      const result = window.confirm(`${title}\n\n${message}`);
      if (result) {
        // Find the non-cancel button and call its onPress
        const confirmButton = buttons.find((btn) => btn.style !== 'cancel');
        if (confirmButton?.onPress) {
          confirmButton.onPress();
        }
      } else {
        // Find the cancel button and call its onPress
        const cancelButton = buttons.find((btn) => btn.style === 'cancel');
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
    Alert.alert(title, message, buttons);
  }
}

// Export the API configuration for external use
export { API_CONFIG };

// Default export
export default api;
