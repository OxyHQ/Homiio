/**
 * Cities Routes
 * API routes for city-related operations
 */

const express = require('express');
const { cityController } = require('../controllers');
const { asyncHandler } = require('../middlewares');

module.exports = function() {
  const router = express.Router();

  /**
   * @route   GET /api/cities
   * @desc    Get all cities with optional filtering
   * @access  Public
   */
  router.get('/', asyncHandler(cityController.getCities));

  /**
   * @route   GET /api/cities/popular
   * @desc    Get popular cities
   * @access  Public
   */
  router.get('/popular', asyncHandler(cityController.getPopularCities));

  /**
   * @route   GET /api/cities/search
   * @desc    Search cities by query
   * @access  Public
   */
  router.get('/search', asyncHandler(cityController.searchCities));

  /**
   * @route   GET /api/cities/lookup
   * @desc    Get city by name, state, and country
   * @access  Public
   */
  router.get('/lookup', asyncHandler(cityController.getCityByLocation));

  /**
   * @route   GET /api/cities/:id
   * @desc    Get city by ID
   * @access  Public
   */
  router.get('/:id', asyncHandler(cityController.getCityById));

  /**
   * @route   GET /api/cities/:id/properties
   * @desc    Get properties by city
   * @access  Public
   */
  router.get('/:id/properties', asyncHandler(cityController.getPropertiesByCity));

  /**
   * @route   POST /api/cities
   * @desc    Create a new city
   * @access  Private (Admin only)
   */
  router.post('/', asyncHandler(cityController.createCity));

  /**
   * @route   PUT /api/cities/:id/update-count
   * @desc    Update city properties count
   * @access  Private (Admin only)
   */
  router.put('/:id/update-count', asyncHandler(cityController.updateCityPropertiesCount));

  return router;
}; 