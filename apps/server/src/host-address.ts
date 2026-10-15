import { isIP } from 'node:net';
import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os';

export const readHostAddress = (
    value: string | undefined,
    interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
    network: string = 'lan',
): string => {
    if (network !== 'lan' && network !== 'tailscale') {
        throw new Error('COOP_NETWORK must be lan or tailscale.');
    }

    if (value === undefined) {
        if (network === 'tailscale') {
            throw new Error('COOP_HOST is required with COOP_NETWORK=tailscale.');
        }

        return '127.0.0.1';
    }

    const [first, second] = value.split('.').map(Number);
    const isPrivate =
        first === 10 ||
        (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
        (first === 192 && second === 168);
    const isTailscale = first === 100 && second !== undefined && second >= 64 && second <= 127;
    const isAllowedRange = network === 'tailscale' ? isTailscale : isPrivate;
    const isAssigned = Object.values(interfaces).some(addresses =>
        Boolean(
            addresses?.some(address => {
                const isMatchingAddress = address.address === value;
                const isExternal = !address.internal;

                return isMatchingAddress && isExternal;
            }),
        ),
    );

    if (isIP(value) !== 4 || !isAllowedRange || !isAssigned) {
        throw new Error(
            `COOP_HOST must be an IPv4 address assigned to a local interface in the ${network} range.`,
        );
    }

    return value;
};
