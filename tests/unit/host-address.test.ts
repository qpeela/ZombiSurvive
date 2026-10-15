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
