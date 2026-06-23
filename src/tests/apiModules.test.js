const express = require('express');
const { API_PREFIX, modules, getModuleMountPath, registerApiModules } = require('../modules');

describe('API module registry', () => {
  it('declares every backend service boundary once', () => {
    const moduleNames = modules.map((moduleDefinition) => moduleDefinition.name);

    expect(moduleNames).toEqual([
      'auth',
      'customer',
      'serviceCatalog',
      'booking',
      'payment',
      'review',
      'support',
      'maid',
      'admin',
      'agent',
      'notification',
      'cart',
      'promotion',
      'content',
      'location',
      'system',
    ]);
  });

  it('keeps public API mount paths stable and unique', () => {
    const mountPaths = modules.map(getModuleMountPath);

    expect(API_PREFIX).toBe('/api/v1');
    expect(mountPaths).toEqual([
      '/api/v1/auth',
      '/api/v1/customers',
      '/api/v1/services',
      '/api/v1/bookings',
      '/api/v1/payments',
      '/api/v1/reviews',
      '/api/v1/support',
      '/api/v1/maids',
      '/api/v1/admin',
      '/api/v1/agents',
      '/api/v1/notifications',
      '/api/v1/cart',
      '/api/v1/promotions',
      '/api/v1/content',
      '/api/v1/locations',
      '/api/v1/system',
    ]);
    expect(new Set(mountPaths).size).toBe(mountPaths.length);
  });

  it('has ownership and capability metadata for every module', () => {
    for (const moduleDefinition of modules) {
      expect(moduleDefinition.owner).toEqual(expect.any(String));
      expect(moduleDefinition.capabilities).toEqual(expect.any(Array));
      expect(moduleDefinition.capabilities.length).toBeGreaterThan(0);
    }
  });

  it('registers every module on an express app', () => {
    const app = express();

    expect(() => registerApiModules(app)).not.toThrow();
  });
});
