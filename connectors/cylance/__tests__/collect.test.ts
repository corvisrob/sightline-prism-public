import { describe, it, expect } from 'vitest';
import { buildAuthToken, parseOs, transformDevice } from '../collect.js';

// Minimal device fixture matching the AuroraDevice extended interface shape
const baseDevice = {
  id: 'abc-123',
  name: 'DESKTOP-TEST01',
  hostname: 'DESKTOP-TEST01',
  ip_addresses: ['10.0.0.1', '192.168.1.5'],
  mac_addresses: ['aa:bb:cc:dd:ee:ff', '11:22:33:44:55:66'],
  os_version: 'Windows 10 Professional, 64-bit',
  os_kernel_version: '10.0.17763.8276',
  state: 'Online',
  is_safe: true,
  agent_version: '3.4.1000',
  background_detection: false,
  date_first_registered: '2024-01-01T00:00:00.000Z',
  date_offline: undefined,
  dlcm_status: 'included',
  policy: { id: 'pol-1', name: 'Default Policy' },
  products: [{ name: 'Protect', version: '3.4.1000', status: 'Online' }],
};

describe('buildAuthToken', () => {
  it('returns a three-segment JWT string', () => {
    const token = buildAuthToken('tenant-1', 'app-1', 'secret');
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
  });

  it('header decodes to HS256 JWT', () => {
    const token = buildAuthToken('tenant-1', 'app-1', 'secret');
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    expect(header).toEqual({ typ: 'JWT', alg: 'HS256' });
  });

  it('payload contains expected claims', () => {
    const token = buildAuthToken('my-tenant', 'my-app', 'secret');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(payload.iss).toBe('http://cylance.com');
    expect(payload.sub).toBe('my-app');
    expect(payload.tid).toBe('my-tenant');
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof payload.iat).toBe('number');
    expect(payload.exp).toBe(payload.iat + 1800);
  });

  it('produces different jti on each call', () => {
    const t1 = buildAuthToken('t', 'a', 's');
    const t2 = buildAuthToken('t', 'a', 's');
    const p1 = JSON.parse(Buffer.from(t1.split('.')[1], 'base64url').toString());
    const p2 = JSON.parse(Buffer.from(t2.split('.')[1], 'base64url').toString());
    expect(p1.jti).not.toBe(p2.jti);
  });
});

describe('parseOs', () => {
  it('detects Windows', () => {
    const result = parseOs('Windows 10 Professional, 64-bit');
    expect(result.os).toBe('Windows');
    expect(result.osVersion).toBe('Windows 10 Professional, 64-bit');
  });

  it('detects macOS', () => {
    const result = parseOs('macOS 13.2.1');
    expect(result.os).toBe('macOS');
  });

  it('detects Linux by distro name', () => {
    const result = parseOs('Ubuntu 20.04.5 LTS');
    expect(result.os).toBe('Linux');
  });

  it('falls back to full string for unknown OS', () => {
    const result = parseOs('SomeUnknownOS 1.0');
    expect(result.os).toBe('SomeUnknownOS 1.0');
    expect(result.osVersion).toBe('SomeUnknownOS 1.0');
  });

  it('handles empty string without throwing', () => {
    const result = parseOs('');
    expect(result.os).toBe('');
  });
});

describe('transformDevice', () => {
  it('maps core identity fields', () => {
    const asset = transformDevice(baseDevice);
    expect(asset.id).toBe('abc-123');
    expect(asset.name).toBe('DESKTOP-TEST01');
    expect(asset.hostname).toBe('DESKTOP-TEST01');
    expect(asset.type).toBe('computer');
    expect(asset.source).toBe('cylance');
    expect(asset.schemaVersion).toBe(1);
  });

  it('maps Online state to running', () => {
    expect(transformDevice({ ...baseDevice, state: 'Online' }).status).toBe('running');
  });

  it('maps Offline state to stopped', () => {
    expect(transformDevice({ ...baseDevice, state: 'Offline' }).status).toBe('stopped');
  });

  it('maps Inactive state to stopped', () => {
    expect(transformDevice({ ...baseDevice, state: 'Inactive' }).status).toBe('stopped');
  });

  it('defaults unknown states to unknown', () => {
    expect(transformDevice({ ...baseDevice, state: undefined }).status).toBe('unknown');
  });

  it('maps ip and mac addresses to network interfaces', () => {
    const asset = transformDevice(baseDevice);
    expect(asset.network).toHaveLength(2);
    expect(asset.network![0]).toMatchObject({ interface: 'primary', ipAddress: '10.0.0.1', macAddress: 'aa:bb:cc:dd:ee:ff' });
    expect(asset.network![1]).toMatchObject({ interface: 'eth1', ipAddress: '192.168.1.5', macAddress: '11:22:33:44:55:66' });
  });

  it('handles missing ip/mac arrays without throwing', () => {
    const asset = transformDevice({ ...baseDevice, ip_addresses: undefined, mac_addresses: undefined });
    expect(asset.network).toHaveLength(0);
  });

  it('parses OS fields from os_version', () => {
    const asset = transformDevice(baseDevice);
    expect(asset.os).toBe('Windows');
    expect(asset.osVersion).toBe('Windows 10 Professional, 64-bit');
  });

  it('uses hostname field when present', () => {
    const asset = transformDevice(baseDevice);
    expect(asset.hostname).toBe('DESKTOP-TEST01');
  });

  it('falls back to name for hostname when hostname absent', () => {
    const asset = transformDevice({ ...baseDevice, hostname: undefined });
    expect(asset.hostname).toBe('DESKTOP-TEST01');
  });

  it('populates cylance-prefixed extendedData', () => {
    const asset = transformDevice(baseDevice);
    expect(asset.extendedData).toMatchObject({
      cylanceAgentVersion: '3.4.1000',
      cylanceState: 'Online',
      cylanceIsSafe: true,
      cylanceOsKernelVersion: '10.0.17763.8276',
      cylancePolicyId: 'pol-1',
      cylancePolicyName: 'Default Policy',
      cylanceDlcmStatus: 'included',
    });
  });

  it('uses date_first_registered as discoveredAt', () => {
    const asset = transformDevice(baseDevice);
    expect(asset.discoveredAt).toBe('2024-01-01T00:00:00.000Z');
  });
});
