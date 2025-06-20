import api, { getCacheKey, setCacheEntry, getCacheEntry } from '@/utils/api';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  username: string;
  firstName: string;
  lastName: string;
}

export interface User {
  id: string;
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  role: string;
  emailVerified?: boolean;
  createdAt: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

class AuthService {
  private baseUrl = '/api/auth';

  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await api.post(`${this.baseUrl}/login`, credentials);
    
    // Store tokens
    if (response.data.success && response.data.data) {
      const { accessToken, refreshToken } = response.data.data;
      // Tokens will be stored by the API interceptors
    }
    
    return response.data.data;
  }

  async register(userData: RegisterData): Promise<AuthResponse> {
    const response = await api.post(`${this.baseUrl}/register`, userData);
    
    // Store tokens
    if (response.data.success && response.data.data) {
      const { accessToken, refreshToken } = response.data.data;
      // Tokens will be stored by the API interceptors
    }
    
    return response.data.data;
  }

  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const response = await api.post(`${this.baseUrl}/refresh`, { refreshToken });
    return response.data.data;
  }

  async validateToken(): Promise<{ valid: boolean; user?: User }> {
    try {
      const response = await api.get(`${this.baseUrl}/validate`);
      return response.data.data;
    } catch (error) {
      return { valid: false };
    }
  }

  async logout(): Promise<void> {
    try {
      await api.post(`${this.baseUrl}/logout`);
    } catch (error) {
      // Continue with logout even if request fails
      console.warn('Logout request failed:', error);
    }
    
    // Clear local storage is handled by the API utils
  }

  async forgotPassword(email: string): Promise<void> {
    await api.post(`${this.baseUrl}/forgot-password`, { email });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await api.post(`${this.baseUrl}/reset-password`, { token, newPassword });
  }

  // Utility methods
  isAuthenticated(): boolean {
    // This would check if valid tokens exist in storage
    // Implementation depends on storage mechanism used in api.ts
    return false; // Placeholder
  }

  getCurrentUser(): User | null {
    // This would retrieve current user from storage or cache
    // Implementation depends on storage mechanism used in api.ts
    return null; // Placeholder
  }
}

export const authService = new AuthService();