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

interface BackendReservation extends Omit<Reservation, 'id'> {
  _id?: string;
  id?: string;
}

const normalizeReservation = (raw: BackendReservation): Reservation => {
  const id = raw.id ?? raw._id ?? '';
  return {
    ...raw,
    id,
  } as Reservation;
};

export const reservationService = {
  async createReservation(payload: CreateReservationData): Promise<Reservation> {
    const response = await api.post<ApiResponse<BackendReservation>>(
      '/api/reservations',
      payload,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Reservation creation failed');
    }
    return normalizeReservation(response.data.data);
  },

  async listReservations(
    params: ListReservationsParams = {},
  ): Promise<ReservationListResponse> {
    const response = await api.get<{
      data?: BackendReservation[];
      pagination?: ReservationListResponse['pagination'];
    }>('/api/reservations', {
      params: {
        asHost: params.asHost ? 'true' : undefined,
        status: params.status,
        page: params.page,
        limit: params.limit,
      },
    });
    const items = (response.data.data ?? []).map(normalizeReservation);
    const pagination = response.data.pagination ?? {
      page: 1,
      limit: items.length,
      total: items.length,
      totalPages: 1,
    };
    return { items, pagination };
  },

  async getReservationById(id: string): Promise<Reservation> {
    const response = await api.get<ApiResponse<BackendReservation>>(
      `/api/reservations/${id}`,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Reservation not found');
    }
    return normalizeReservation(response.data.data);
  },

  async updateReservation(
    id: string,
    payload: UpdateReservationData,
  ): Promise<Reservation> {
    const response = await api.patch<ApiResponse<BackendReservation>>(
      `/api/reservations/${id}`,
      payload,
    );
    if (!response.data?.data) {
      throw new Error(response.data?.message || 'Reservation update failed');
    }
    return normalizeReservation(response.data.data);
  },

  async getPropertyAvailability(
    propertyId: string,
  ): Promise<PropertyAvailabilityResponse> {
    const response = await api.get<ApiResponse<PropertyAvailabilityResponse>>(
      `/api/properties/${propertyId}/availability`,
    );
    if (!response.data?.data) {
      return {
        propertyId,
        windows: [],
        booked: [],
      };
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
