import type { NetworkInterfaceInfo } from 'node:os';

import { expect, test } from 'vitest';

import { readHostAddress } from '../../apps/server/src/host-address.ts';

const address = (value: string): NetworkInterfaceInfo => ({
    address: value,
    family: 'IPv4',
    netmask: '255.255.255.0',
    internal: false,
    cidr: `${value}/24`,
    mac: '00:00:00:00:00:00',
});

test('solo always defaults to loopback even with private interfaces available', () => {
    expect(readHostAddress(undefined, { eth0: [address('192.168.1.5')] })).toBe('127.0.0.1');
});

test.each(['10.2.3.4', '172.16.1.2', '172.31.1.2', '192.168.1.5'])(
    'explicit co-op binds only an assigned private IPv4: %s',
    value => {
        expect(readHostAddress(value, { eth0: [address(value)] })).toBe(value);
        expect(() => readHostAddress(value, {})).toThrow('COOP_HOST');
    },
);

test.each(['', '0.0.0.0', '127.0.0.1', '8.8.8.8', '169.254.1.2', '172.32.1.2', '::1', 'localhost'])(
    'invalid, wildcard, loopback and public co-op addresses are rejected: %s',
    value => {
        expect(() => readHostAddress(value, { eth0: [address(value)] })).toThrow('COOP_HOST');
    },
);

test.each(['100.64.0.1', '100.80.12.34', '100.127.255.254'])(
    'Tailscale range requires explicit opt-in and an assigned interface: %s',
    value => {
        const interfaces = { utun: [address(value)] };
        expect(readHostAddress(value, interfaces, 'tailscale')).toBe(value);
        expect(() => readHostAddress(value, interfaces)).toThrow('COOP_HOST');
        expect(() => readHostAddress(value, {}, 'tailscale')).toThrow('COOP_HOST');
        expect(() =>
            readHostAddress(value, { lo: [{ ...address(value), internal: true }] }, 'tailscale'),
        ).toThrow('COOP_HOST');
    },
);

test.each([
    '100.63.255.255',
    '100.128.0.0',
    '192.168.1.5',
    '0.0.0.0',
    '127.0.0.1',
    '8.8.8.8',
    '::1',
])('Tailscale mode rejects other ranges even when assigned: %s', value => {
    expect(() => readHostAddress(value, { eth0: [address(value)] }, 'tailscale')).toThrow(
        'COOP_HOST',
    );
});

test('invalid network selection and Tailscale without an address fail closed', () => {
    expect(() => readHostAddress(undefined, {}, 'tailscale')).toThrow('COOP_HOST');
    expect(() => readHostAddress(undefined, {}, '')).toThrow('COOP_NETWORK');
    expect(() => readHostAddress('192.168.1.5', {}, 'tailcsale')).toThrow('COOP_NETWORK');
});
