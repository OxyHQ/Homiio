import { api, ApiResponse } from '@/utils/api';
import {
  AvailabilityWindow,
  AvailabilityWindowStatus,
  CancellationPolicy,
  CreateReservationData,
  OfferingType,
  Reservation,
  ReservationStatus,
  UpdateReservationData,
} from '@homiio/shared-types';

/**
 * Server availability response for a single property. Mirrors the shape the
 * backend's `GET /api/properties/:id/availability` route returns — the
 * short-term booking knobs (`instantBook`, `minNights`/`maxNights`) come from
 * the property's `shortTermRent` block, and `offerings` is the authoritative
 * offering axis.
 */
export interface PropertyAvailabilityResponse {
  propertyId: string;
  offerings?: OfferingType[];
  instantBook?: boolean;
  cancellationPolicy?: CancellationPolicy;
  minNights?: number;
  maxNights?: number;
  maxGuests?: number;
  windows: AvailabilityWindow[];
  booked: AvailabilityWindow[];
}

export interface ReservationListResponse {
  items: Reservation[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ListReservationsParams {
  asHost?: boolean;
  status?: ReservationStatus;
  page?: number;
  limit?: number;
}

export const reservationService = {
  async createReservation(payload: CreateReservationData): Promise<Reservation> {
    const response = await api.post<ApiResponse<Reservation>>(
      '/api/reservations',
      payload,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Reservation creation failed');
    }
    return response.data.data;
  },

  async listReservations(
    params: ListReservationsParams = {},
  ): Promise<ReservationListResponse> {
    const response = await api.get<{
      data?: Reservation[];
      pagination?: ReservationListResponse['pagination'];
    }>('/api/reservations', {
      params: {
        asHost: params.asHost ? 'true' : undefined,
        status: params.status,
        page: params.page,
        limit: params.limit,
      },
    });
    const items = response.data.data ?? [];
    const pagination = response.data.pagination ?? {
      page: 1,
      limit: items.length,
      total: items.length,
      totalPages: 1,
    };
    return { items, pagination };
  },

  async getReservationById(id: string): Promise<Reservation> {
    const response = await api.get<ApiResponse<Reservation>>(
      `/api/reservations/${id}`,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Reservation not found');
    }
    return response.data.data;
  },

  async updateReservation(
    id: string,
    payload: UpdateReservationData,
  ): Promise<Reservation> {
    const response = await api.patch<ApiResponse<Reservation>>(
      `/api/reservations/${id}`,
      payload,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Reservation update failed');
    }
    return response.data.data;
  },

  /**
   * The stay calendar for a listing — blocked windows and committed dates.
   *
   * **A failure is thrown, never flattened into an empty calendar.** This used
   * to answer `{ windows: [], booked: [] }` whenever the response carried no
   * `data`, which is indistinguishable from "this home is free every night" —
   * and the endpoint was behind the session, so every signed-out visitor took
   * that branch and was shown a full home as entirely available. The endpoint is
   * public now (`routes/public.ts`); if it still fails, the caller's query goes
   * to `isError` and the screen can say so, rather than quietly inventing
   * availability.
   */
  async getPropertyAvailability(
    propertyId: string,
  ): Promise<PropertyAvailabilityResponse> {
    const response = await api.get<ApiResponse<PropertyAvailabilityResponse>>(
      `/api/properties/${propertyId}/availability`,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Availability is unavailable');
    }
    const data = response.data.data;
    return {
      ...data,
      windows: data.windows ?? [],
      booked: (data.booked ?? []).map((entry) => ({
        ...entry,
        status: entry.status ?? AvailabilityWindowStatus.BOOKED,
      })),
    };
  },
};

export default reservationService;
