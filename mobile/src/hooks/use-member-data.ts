import { useCallback, useEffect, useState } from 'react';

import { fetchMe, fetchSpaBookings, type MemberProfileResponse, type SpaBooking } from '@/lib/api';

export type MemberDataState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'error' }
  | { status: 'ready'; member: MemberProfileResponse; bookings: SpaBooking[]; bookingsError: boolean };

export function useMemberData(): { state: MemberDataState; reload: () => void } {
  const [state, setState] = useState<MemberDataState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    const [me, spa] = await Promise.all([fetchMe(), fetchSpaBookings()]);
    if (me.status === 401) {
      setState({ status: 'unauthenticated' });
    } else if (!me.ok || !me.data) {
      setState({ status: 'error' });
    } else {
      setState({
        status: 'ready',
        member: me.data,
        bookings: spa.ok ? spa.data ?? [] : [],
        bookingsError: !spa.ok,
      });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  return { state, reload: load };
}
