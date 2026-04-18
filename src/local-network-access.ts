import {isLoopbackOrigin} from './remote-config';

export type LocalNetworkAccessState = PermissionState | 'unsupported';

type LocalNetworkPermissionDescriptor = PermissionDescriptor & {
  name: 'local-network-access' | 'local-network' | 'loopback-network';
};

type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace?: 'local' | 'loopback';
};

export async function readLocalNetworkAccessState(origin = ''): Promise<LocalNetworkAccessState> {
  try {
    if (
      typeof navigator === 'undefined' ||
      !('permissions' in navigator) ||
      typeof navigator.permissions?.query !== 'function'
    ) {
      return 'unsupported';
    }

    const permissionNames = isLoopbackOrigin(origin)
      ? (['loopback-network', 'local-network-access'] as const)
      : (['local-network', 'local-network-access'] as const);

    for (const name of permissionNames) {
      try {
        const status = await navigator.permissions.query({
          name,
        } as LocalNetworkPermissionDescriptor);

        if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
          return status.state;
        }
      } catch {
        continue;
      }
    }
  } catch {
    return 'unsupported';
  }

  return 'unsupported';
}

export function withLocalNetworkAccess(init: RequestInit, origin = ''): RequestInit {
  return {
    ...init,
    targetAddressSpace: isLoopbackOrigin(origin) ? 'loopback' : 'local',
  } as LocalNetworkRequestInit;
}
