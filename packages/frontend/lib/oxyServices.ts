import { OxyServices } from '@oxyhq/core';
import { OXY_BASE_URL } from '@/config';

/**
 * Shared OxyServices instance — same object passed to OxyProvider.
 * Device-first session restore is owned by OxyProvider cold boot.
 */
export const oxyServices = new OxyServices({ baseURL: OXY_BASE_URL });
