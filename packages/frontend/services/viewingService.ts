import { api, ApiResponse } from '@/utils/api';

export type ViewingStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

export interface ViewingRequest {
  _id: string;
  propertyId: string;
  requesterProfileId: string;
  ownerProfileId: string;
  scheduledAt: string;
  date: string; // Derived from scheduledAt for convenience
  time: string; // Derived from scheduledAt for convenience
  message?: string;
  status: ViewingStatus;
  cancelledBy?: 'requester' | 'owner';
  propertyTitle?: string; // Might be populated by backend
  createdAt: string;
  updatedAt: string;
}

export interface ViewingListResponse {
  items: ViewingRequest[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const viewingService = {
  async createViewingRequest(
    propertyId: string,
    payload: { date: string; time: string; message?: string },
  ): Promise<ApiResponse<ViewingRequest>> {
    const response = await api.post<ApiResponse<ViewingRequest>>(
      `/api/properties/${propertyId}/viewings`,
      payload,
    );
    return response.data;
  },

  async listMyViewingRequests(
    params?: { status?: ViewingStatus; page?: number; limit?: number },
  ): Promise<ApiResponse<ViewingRequest[]>> {
    const response = await api.get<ApiResponse<ViewingRequest[]>>('/api/viewings/me', {
      params,
    });
    return response.data;
  },

  async listPropertyViewingRequests(
    propertyId: string,
    params?: { status?: ViewingStatus; page?: number; limit?: number },
  ): Promise<ApiResponse<ViewingRequest[]>> {
    const response = await api.get<ApiResponse<ViewingRequest[]>>(
      `/api/properties/${propertyId}/viewings`,
      {
        params,
      },
    );
    return response.data;
  },

  async approve(viewingId: string): Promise<ApiResponse<ViewingRequest>> {
    const response = await api.post<ApiResponse<ViewingRequest>>(
      `/api/viewings/${viewingId}/approve`,
      {},
    );
    return response.data;
  },

  async decline(viewingId: string): Promise<ApiResponse<ViewingRequest>> {
    const response = await api.post<ApiResponse<ViewingRequest>>(
      `/api/viewings/${viewingId}/decline`,
      {},
    );
    return response.data;
  },

  async cancel(viewingId: string): Promise<ApiResponse<ViewingRequest>> {
    const response = await api.post<ApiResponse<ViewingRequest>>(
      `/api/viewings/${viewingId}/cancel`,
      {},
    );
    return response.data;
  },

  async update(
    viewingId: string,
    payload: { date: string; time: string; message?: string },
  ): Promise<ApiResponse<ViewingRequest>> {
    const response = await api.put<ApiResponse<ViewingRequest>>(
      `/api/viewings/${viewingId}`,
      payload,
    );
    return response.data;
  },
};

export default viewingService;


