/**
 * Reservation-related types shared across Homiio frontend and backend.
 *
 * A `Reservation` is a vacation/short-term booking (Airbnb-style) and is
 * DISTINCT from a `ViewingRequest` (which is an in-person property tour
 * for the long-term rent flow).
 */

import { CancellationPolicy, ISODate } from './common';

export enum ReservationStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
  DECLINED = 'declined'
}

export interface Reservation {
  id: string;
  propertyId: string;
  guestProfileId: string;
  hostProfileId: string;
  checkIn: ISODate;
  checkOut: ISODate;
  guestCount: number;
  /** Number of nights between checkIn (inclusive) and checkOut (exclusive). */
  nights: number;
  nightlyRate: number;
  subtotal: number;
  cleaningFee: number;
  serviceFee: number;
  /** Tax amount in currency units (already computed; not a percentage). */
  taxes: number;
  total: number;
  currency: string;
  status: ReservationStatus;
  /** True when booking went through instant-book and skipped host approval. */
  instantBooked: boolean;
  cancellationPolicy: CancellationPolicy;
  specialRequests?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface CreateReservationData {
  propertyId: string;
  checkIn: ISODate;
  checkOut: ISODate;
  guestCount: number;
  specialRequests?: string;
}

export interface UpdateReservationData {
  status?: ReservationStatus;
  specialRequests?: string;
}

export interface ReservationQuote {
  propertyId: string;
  checkIn: ISODate;
  checkOut: ISODate;
  guestCount: number;
  nights: number;
  nightlyRate: number;
  subtotal: number;
  cleaningFee: number;
  serviceFee: number;
  taxes: number;
  total: number;
  currency: string;
  cancellationPolicy: CancellationPolicy;
  instantBook: boolean;
}
