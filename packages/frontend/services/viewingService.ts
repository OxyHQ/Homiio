import { OxyServices } from '@oxyhq/services';
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
    oxyServices: OxyServices,
    activeSessionId: string,
  ): Promise<ApiResponse<ViewingRequest>> {
    const response = await api.post<ApiResponse<ViewingRequest>>(
      `/api/properties/${propertyId}/viewings`,
      payload,
      { oxyServices, activeSessionId },
    );
    return response.data;
  },

  async listMyViewingRequests(
    params: { status?: ViewingStatus; page?: number; limit?: number } | undefined,
    oxyServices: OxyServices,
    activeSessionId: string,
  ): Promise<ApiResponse<ViewingRequest[]>> {
    const response = await api.get<ApiResponse<ViewingRequest[]>>('/api/viewings/me', {
      params,
      oxyServices,
      activeSessionId,
    });
    return response.data;
  },

  async listPropertyViewingRequests(
    propertyId: string,
    params: { status?: ViewingStatus; page?: number; limit?: number } | undefined,
    oxyServices: OxyServices,
    activeSessionId: string,
  ): Promise<ApiResponse<ViewingRequest[]>> {
    const response = await api.get<ApiResponse<ViewingRequest[]>>(
      `/api/properties/${propertyId}/viewings`,
      {
        params,
        oxyServices,
        activeSessionId,
      },
    );
    return response.data;
  },

  async approve(viewingId: string, oxyServices: OxyServices, activeSessionId: string): Promise<ApiResponse<ViewingRequest>> {
    const response = await api.post<ApiResponse<ViewingRequest>>(
      `/api/viewings/${viewingId}/approve`,
      {},
      { oxyServices, activeSessionId },
    );
    return response.data;
  },

  async decline(viewingId: string, oxyServices: OxyServices, activeSessionId: string): Promise<ApiResponse<ViewingRequest>> {
    const response = await api.post<ApiResponse<ViewingRequest>>(
      `/api/viewings/${viewingId}/decline`,
      {},
      { oxyServices, activeSessionId },
    );
    return response.data;
  },

  async cancel(viewingId: string, oxyServices: OxyServices, activeSessionId: string): Promise<ApiResponse<ViewingRequest>> {
    const response = await api.post<ApiResponse<ViewingRequest>>(
      `/api/viewings/${viewingId}/cancel`,
      {},
      { oxyServices, activeSessionId },
    );
    return response.data;
  },

  async update(
    viewingId: string,
    payload: { date: string; time: string; message?: string },
    oxyServices: OxyServices,
    activeSessionId: string,
  ): Promise<ApiResponse<ViewingRequest>> {
    const response = await api.put<ApiResponse<ViewingRequest>>(
      `/api/viewings/${viewingId}`,
      payload,
      { oxyServices, activeSessionId },
    );
    return response.data;
  },
};

export default viewingService;


