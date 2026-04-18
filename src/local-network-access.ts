import {isLoopbackOrigin} from './remote-config';

export type LocalNetworkAccessState = PermissionState | 'unsupported';

type LocalNetworkPermissionDescriptor = PermissionDescriptor & {
  name: 'local-network-access';
};

type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace?: 'local' | 'loopback';
};

export async function readLocalNetworkAccessState(): Promise<LocalNetworkAccessState> {
  try {
    if (
      typeof navigator === 'undefined' ||
      !('permissions' in navigator) ||
      typeof navigator.permissions?.query !== 'function'
    ) {
      return 'unsupported';
    }

    const status = await navigator.permissions.query({
      name: 'local-network-access',
    } as LocalNetworkPermissionDescriptor);

    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state;
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
