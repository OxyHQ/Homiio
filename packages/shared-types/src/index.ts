// User related types
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Authentication types
export interface AuthResponse {
  user: User;
  token: string;
  refreshToken?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

// Common pagination types
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Device types
export interface Device {
  id: string;
  name: string;
  type: 'mobile' | 'desktop' | 'tablet';
  platform: 'ios' | 'android' | 'web';
  userId: string;
  lastActive: Date;
  createdAt: Date;
}

// Export all types
// Additional type files can be added here as needed 