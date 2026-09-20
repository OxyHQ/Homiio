import { api, ApiResponse } from '@/utils/api';
import type {
  ViewingAvailability,
  ViewingModality,
  ViewingWindow,
  ViewingWindowInput,
} from '@homiio/shared-types';

export type ViewingStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

export interface ViewingRequest {
  id: string;
  propertyId: string;
  requesterOxyUserId: string;
  ownerOxyUserId: string;
  scheduledAt: string;
  /**
   * The civil day and clock time in the PROPERTY's zone, and the zone itself.
   *
   * Derived server side (#518 §7.5) rather than from `scheduledAt` here. The
   * screen used to compute them with `toLocaleTimeString` in the DEVICE's zone,
   * so a viewing agreed for Tuesday morning in Madrid was shown as Monday night
   * to somebody in Los Angeles with nothing saying so. `null` when the listing
   * is not in hand; `scheduledAt` is always there to render in any other zone
   * on purpose.
   */
  date: string | null;
  time: string | null;
  timeZone: string | null;
  durationMinutes: number;
  modality: ViewingModality;
  message?: string;
  /** What the owner wrote when they answered. */
  ownerResponse?: string | null;
  status: ViewingStatus;
  cancelledBy?: 'requester' | 'owner';
  propertyTitle?: string; // Might be populated by backend
  createdAt: string;
  updatedAt: string;
}

/** The owner's own view of their schedule. */
export interface ViewingSchedule {
  propertyId: string;
  timeZone: string;
  timeZoneSource: 'property' | 'city' | 'fallback';
  windows: ViewingWindow[];
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
  /**
   * The slots this listing offers, in the PROPERTY's zone.
   *
   * Public — no session needed, exactly like the stay calendar — so a
   * signed-out visitor sees real times instead of an empty screen or an
   * invented list.
   */
  async getAvailability(
    propertyId: string,
    params?: { days?: number },
  ): Promise<ApiResponse<ViewingAvailability>> {
    const response = await api.get<ApiResponse<ViewingAvailability>>(
      `/api/properties/${propertyId}/viewing-availability`,
      { params },
    );
    return response.data;
  },

  /** The owner's own schedule. 404 to anybody else — ownership is a predicate. */
  async getSchedule(propertyId: string): Promise<ApiResponse<ViewingSchedule>> {
    const response = await api.get<ApiResponse<ViewingSchedule>>(
      `/api/properties/${propertyId}/viewing-windows`,
    );
    return response.data;
  },

  /**
   * Replace the whole schedule, and the zone it is expressed in.
   *
   * One call for both because they are one fact: "17:00" is not a time until
   * the zone is known, so moving the windows and the zone separately would
   * briefly offer slots at an hour the owner did not choose.
   */
  async putSchedule(
    propertyId: string,
    payload: { windows: ViewingWindowInput[]; timeZone?: string | null },
  ): Promise<ApiResponse<ViewingSchedule>> {
    const response = await api.put<ApiResponse<ViewingSchedule>>(
      `/api/properties/${propertyId}/viewing-windows`,
      payload,
    );
    return response.data;
  },

  async createViewingRequest(
    propertyId: string,
    payload: { date: string; time: string; modality?: ViewingModality; message?: string },
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

  /** `response` is the owner's own words, and only an owner may send it. */
  async approve(viewingId: string, response?: string): Promise<ApiResponse<ViewingRequest>> {
    const res = await api.post<ApiResponse<ViewingRequest>>(
      `/api/viewings/${viewingId}/approve`,
      { response },
    );
    return res.data;
  },

  async decline(viewingId: string, response?: string): Promise<ApiResponse<ViewingRequest>> {
    const res = await api.post<ApiResponse<ViewingRequest>>(
      `/api/viewings/${viewingId}/decline`,
      { response },
    );
    return res.data;
  },

  async cancel(viewingId: string, response?: string): Promise<ApiResponse<ViewingRequest>> {
    const res = await api.post<ApiResponse<ViewingRequest>>(
      `/api/viewings/${viewingId}/cancel`,
      { response },
    );
    return res.data;
  },

  async update(
    viewingId: string,
    payload: { date: string; time: string; modality?: ViewingModality; message?: string },
  ): Promise<ApiResponse<ViewingRequest>> {
    const response = await api.put<ApiResponse<ViewingRequest>>(
      `/api/viewings/${viewingId}`,
      payload,
    );
    return response.data;
  },
};

export default viewingService;


