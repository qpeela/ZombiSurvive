import { isIP } from 'node:net';
import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os';

export const readHostAddress = (
    value: string | undefined,
    interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string => {
    if (value === undefined) {
        return '127.0.0.1';
    }

    const [first, second] = value.split('.').map(Number);
    const isPrivate =
        first === 10 ||
        (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
        (first === 192 && second === 168);
    const isAssigned = Object.values(interfaces).some(addresses =>
        Boolean(
            addresses?.some(address => {
                const isMatchingAddress = address.address === value;
                const isExternal = !address.internal;

                return isMatchingAddress && isExternal;
            }),
        ),
    );

    if (isIP(value) !== 4 || !isPrivate || !isAssigned) {
        throw new Error('COOP_HOST must be a private IPv4 address assigned to a local interface.');
    }

    return value;
};
