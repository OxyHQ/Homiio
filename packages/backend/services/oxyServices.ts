/**
 * Shared OxyServices instance
 * This module provides a centralized OxyServices instance for use across the application
 */

import { OxyServices } from '@oxyhq/services/core';
import config from '../config';

// Initialize OxyServices with your Oxy API URL
const oxyServices = new OxyServices({
  baseURL: config.oxy.baseURL
});

console.log('[OXY] Services initialized with baseURL:', config.oxy.baseURL);

export default oxyServices;