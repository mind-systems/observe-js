import { describe, it, expect } from 'vitest';
import { buildResource } from '../src/core/index.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('buildResource', () => {
  it('returns exactly 3 attributes', () => {
    const resource = buildResource('myproject', 'my-service');
    expect(resource.attributes).toHaveLength(3);
  });

  it('attributes are in order: project, service.name, service.instance.id', () => {
    const resource = buildResource('myproject', 'my-service');
    expect(resource.attributes[0].key).toBe('project');
    expect(resource.attributes[1].key).toBe('service.name');
    expect(resource.attributes[2].key).toBe('service.instance.id');
  });

  it('project attribute carries the passed-in value as { stringValue }', () => {
    const resource = buildResource('tradeoxy', 'broker');
    expect(resource.attributes[0].value).toEqual({ stringValue: 'tradeoxy' });
  });

  it('service.name attribute carries the passed-in value as { stringValue }', () => {
    const resource = buildResource('tradeoxy', 'broker');
    expect(resource.attributes[1].value).toEqual({ stringValue: 'broker' });
  });

  it('service.instance.id value is a valid UUIDv4', () => {
    const resource = buildResource('myproject', 'my-service');
    const instanceId = resource.attributes[2].value;
    expect(instanceId).toHaveProperty('stringValue');
    expect((instanceId as { stringValue: string }).stringValue).toMatch(UUID_V4);
  });

  it('two separate calls produce different service.instance.id values', () => {
    const a = buildResource('myproject', 'my-service');
    const b = buildResource('myproject', 'my-service');
    const idA = (a.attributes[2].value as { stringValue: string }).stringValue;
    const idB = (b.attributes[2].value as { stringValue: string }).stringValue;
    expect(idA).not.toBe(idB);
  });
});
