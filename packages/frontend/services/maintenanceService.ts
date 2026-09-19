/**
 * The client for `/api/maintenance` — repair requests (#518 §7.1, #519 §7.1).
 *
 * Transport failures PROPAGATE, as everywhere else in this package: a caught
 * error returning an empty list would make a network failure, a 500 and a
 * tenancy with nothing wrong produce the same value, and the one a screen would
 * render is the reassuring, wrong one.
 *
 * The one deliberate exception is {@link isTransitionConflict}, which does not
 * swallow anything — it lets a caller tell "the request has moved on" from "the
 * request is broken", because those two produce different sentences.
 */

import { Platform } from 'react-native';

import type {
  MaintenanceAttachment,
  MaintenanceCategory,
  MaintenanceRequest,
  MaintenanceStatus,
  MaintenanceUrgency,
} from '@homiio/shared-types';

import { ApiError, api, type ApiResponse } from '@/utils/api';

const BASE = '/api/maintenance';

export interface MaintenanceListFilters {
  readonly leaseId?: string;
  readonly propertyId?: string;
  /** Hide the two terminal states. */
  readonly openOnly?: boolean;
  readonly page?: number;
  readonly limit?: number;
}

export interface MaintenanceListResponse {
  readonly requests: readonly MaintenanceRequest[];
  readonly total: number;
}

/** A photo chosen on the device, in the shape both platforms can send. */
export interface MaintenancePhotoUpload {
  readonly uri: string;
  readonly filename: string;
  readonly mimeType?: string;
}

export interface CreateMaintenanceInput {
  readonly leaseId: string;
  readonly category: MaintenanceCategory;
  readonly urgency: MaintenanceUrgency;
  readonly title: string;
  readonly description: string;
}

/**
 * Whether a failure is "the request has moved on since you looked".
 *
 * `409` is the status the server reserves for an illegal transition, and the
 * distinction matters at the surface: a conflict means refresh and look again,
 * a 500 means something is broken. Telling somebody to retry a genuine failure,
 * or reporting a stale screen as an outage, are both wrong in ways they can see.
 */
export function isTransitionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

class MaintenanceService {
  async list(filters: MaintenanceListFilters = {}): Promise<MaintenanceListResponse> {
    const params: Record<string, string | number> = {};
    if (filters.leaseId) params.leaseId = filters.leaseId;
    if (filters.propertyId) params.propertyId = filters.propertyId;
    if (filters.openOnly) params.openOnly = 'true';
    if (filters.page) params.page = filters.page;
    if (filters.limit) params.limit = filters.limit;

    const { data } = await api.get<ApiResponse<MaintenanceRequest[]>>(BASE, { params });
    return {
      requests: data.data ?? [],
      // The envelope carries pagination beside `data`; a caller that only needs
      // the page does not have to know its shape.
      total:
        (data as unknown as { pagination?: { total?: number }; total?: number }).pagination?.total ??
        (data as unknown as { total?: number }).total ??
        (data.data?.length ?? 0),
    };
  }

  async get(id: string): Promise<MaintenanceRequest> {
    const { data } = await api.get<ApiResponse<MaintenanceRequest>>(`${BASE}/${id}`);
    if (!data.data) throw new Error('The maintenance response carried no request.');
    return data.data;
  }

  async create(input: CreateMaintenanceInput): Promise<MaintenanceRequest> {
    const { data } = await api.post<ApiResponse<MaintenanceRequest>>(BASE, input);
    if (!data.data) throw new Error('The maintenance response carried no request.');
    return data.data;
  }

  /**
   * Move a request along the state machine.
   *
   * `scheduledFor` is required by the server for `scheduled` and refused for
   * everything else; it is optional here because the caller knows which move it
   * is making, and duplicating the rule would make two places to change it.
   */
  async transition(
    id: string,
    status: MaintenanceStatus,
    scheduledFor?: string,
  ): Promise<MaintenanceRequest> {
    const { data } = await api.post<ApiResponse<MaintenanceRequest>>(`${BASE}/${id}/status`, {
      status,
      ...(scheduledFor ? { scheduledFor } : {}),
    });
    if (!data.data) throw new Error('The maintenance response carried no request.');
    return data.data;
  }

  async comment(id: string, body: string): Promise<void> {
    await api.post<ApiResponse<unknown>>(`${BASE}/${id}/comments`, { body });
  }

  /**
   * Attach one photo.
   *
   * One per request, not a batch: a partial failure then loses a single photo
   * rather than everything somebody selected, and the per-request ceiling is
   * enforced server-side against the rows that already exist rather than
   * against the size of a form.
   *
   * The file goes up as multipart — the same two shapes
   * `applicationService` handles, because React Native has no `File` and web
   * has no `{uri, name, type}`.
   */
  async attach(id: string, photo: MaintenancePhotoUpload): Promise<MaintenanceAttachment> {
    const formData = new FormData();
    if (Platform.OS === 'web') {
      const response = await fetch(photo.uri);
      if (!response.ok) throw new ApiError('Could not read the selected photo.', response.status);
      const blob = await response.blob();
      formData.append('photo', blob, photo.filename);
    } else {
      formData.append('photo', {
        uri: photo.uri,
        name: photo.filename,
        type: photo.mimeType || 'image/jpeg',
      } as unknown as Blob);
    }

    const { data } = await api.post<ApiResponse<MaintenanceAttachment>>(
      `${BASE}/${id}/attachments`,
      formData,
    );
    if (!data.data) throw new Error('The attachment response carried no attachment.');
    return data.data;
  }
}

export const maintenanceService = new MaintenanceService();
