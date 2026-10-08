import { Redirect, router } from 'expo-router';
import { useCallback } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useMemberData } from '@/hooks/use-member-data';
import { SITE_BASE_URL, type SpaBooking } from '@/lib/api';

const STATUS: Record<string, string> = {
  unassigned: 'Menunggu terapis',
  assigned: 'Terapis ditugaskan',
  in_treatment: 'Sedang treatment',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
  expired: 'Lewat jadwal',
};

function BookingCard({ booking }: { booking: SpaBooking }) {
  const when = new Date(booking.scheduled_at).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', dateStyle: 'full', timeStyle: 'short',
  });
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.row}>
        <ThemedText style={styles.branch}>{booking.branch_name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{STATUS[booking.status] ?? booking.status}</ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">{when} WIB</ThemedText>
      <ThemedText>{booking.items.map((item) => `${item.treatment_name} ${item.variant_name}`).join(', ')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">Kode {booking.booking_code} · {booking.payment_status === 'paid' ? 'Lunas' : 'Bayar di outlet'}</ThemedText>
      {booking.branch_phone ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Hubungi ${booking.branch_name}`} onPress={() => void Linking.openURL(`tel:${booking.branch_phone!.replace(/\s+/g, '')}`)}>
          <ThemedText style={styles.link}>Hubungi outlet</ThemedText>
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

export default function HomeScreen() {
  const { signOut } = useAuth();
  const { state, reload } = useMemberData();
  const onSignOut = useCallback(() => { void signOut().then(() => router.replace('/login')); }, [signOut]);

  if (state.status === 'unauthenticated') return <Redirect href="/login" />;
  if (state.status === 'loading') {
    return <ThemedView style={[styles.container, styles.center]}><ThemedText>Memuat booking…</ThemedText></ThemedView>;
  }
  if (state.status === 'error') {
    return (
      <ThemedView style={[styles.container, styles.center]}>
        <ThemedText>Data member belum bisa dimuat.</ThemedText>
        <Pressable onPress={reload}><ThemedText style={styles.link}>Coba lagi</ThemedText></Pressable>
        <Pressable onPress={onSignOut}><ThemedText themeColor="textSecondary">Keluar</ThemedText></Pressable>
      </ThemedView>
    );
  }

  const upcoming = state.bookings.filter((booking) =>
    new Date(booking.scheduled_at).getTime() >= Date.now() && !['cancelled', 'expired', 'completed'].includes(booking.status));
  const history = state.bookings.filter((booking) => !upcoming.some((item) => item.id === booking.id));

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}>
          <View style={styles.row}>
            <ThemedText style={styles.wordmark}>MIZU</ThemedText>
            <Pressable onPress={onSignOut} accessibilityRole="button"><ThemedText type="small" themeColor="textSecondary">Keluar</ThemedText></Pressable>
          </View>
          <ThemedText type="subtitle">Halo{state.member.profile.name ? `, ${state.member.profile.name.split(' ')[0]}` : ''}</ThemedText>
          <ThemedText themeColor="textSecondary">Atur waktu untuk beristirahat di Mizu.</ThemedText>
          <Pressable style={styles.button} accessibilityRole="button" onPress={() => void Linking.openURL(`${SITE_BASE_URL}/booking/spa`)}>
            <ThemedText style={styles.buttonText}>Booking treatment</ThemedText>
          </Pressable>

          <ThemedText style={styles.heading}>Booking mendatang</ThemedText>
          {state.bookingsError ? <ThemedText themeColor="textSecondary">Booking belum bisa dimuat. Tarik ke bawah untuk mencoba lagi.</ThemedText> : null}
          {!state.bookingsError && upcoming.length === 0 ? <ThemedText themeColor="textSecondary">Belum ada booking mendatang.</ThemedText> : null}
          {upcoming.map((booking) => <BookingCard key={booking.id} booking={booking} />)}

          {history.length > 0 ? <ThemedText style={styles.heading}>Riwayat</ThemedText> : null}
          {history.slice(0, 10).map((booking) => <BookingCard key={booking.id} booking={booking} />)}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  content: { padding: Spacing.four, gap: Spacing.three },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  wordmark: { fontSize: 22, fontWeight: '800', letterSpacing: 4, color: '#3d2b20' },
  heading: { fontSize: 20, fontWeight: '700', marginTop: Spacing.two },
  branch: { fontSize: 17, fontWeight: '700', flexShrink: 1 },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.one },
  link: { color: '#725127', fontWeight: '700', textDecorationLine: 'underline' },
  button: { backgroundColor: '#3d2b20', borderRadius: 12, padding: Spacing.three, alignItems: 'center' },
  buttonText: { color: '#fffaf2', fontWeight: '700', fontSize: 16 },
});
