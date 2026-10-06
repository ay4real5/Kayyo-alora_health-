import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Card, ErrorText, colors, styles } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';
import { dateRange, money, shortDate, type PayStub } from '@/lib/extras';

/** The caregiver's approved pay stubs, newest first (D-083). Stubs appear once the office approves payroll. */
export default function MyPayScreen() {
  const { request } = useAuth();
  const [stubs, setStubs] = useState<PayStub[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setStubs((await request<PayStub[]>('/payroll/my-stubs')).data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [request]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const latest = stubs?.[0];

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={stubs ?? []}
      keyExtractor={(s) => s.id}
      contentContainerStyle={{ padding: 20, gap: 10, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl
          tintColor={colors.brand}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 4 }}>
          <ErrorText>{error}</ErrorText>
          {latest && (
            <Card style={{ backgroundColor: colors.indigo, gap: 4, paddingVertical: 20 }}>
              <Text style={{ color: '#9aeedd', fontSize: 14 }}>Latest pay · {dateRange(latest.payPeriod.periodStart, latest.payPeriod.periodEnd)}</Text>
              <Text style={{ color: colors.white, fontSize: 34, fontWeight: '800' }}>{money(latest.grossPay)}</Text>
              <Text style={{ color: '#9aeedd', fontSize: 14 }}>
                Paid {shortDate(latest.payPeriod.payDate)} · {latest.regularHours + latest.overtimeHours} h · {latest.visitCount} visits
              </Text>
            </Card>
          )}
        </View>
      }
      ListEmptyComponent={
        stubs ? (
          <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}>
            <Ionicons name="wallet-outline" size={34} color={colors.brand} />
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>No pay stubs yet</Text>
            <Text style={[styles.subtitle, { textAlign: 'center' }]}>They appear here once the office approves payroll.</Text>
          </Card>
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${dateRange(item.payPeriod.periodStart, item.payPeriod.periodEnd)}, ${money(item.grossPay)}`}
          onPress={() => router.push({ pathname: '/pay/[id]', params: { id: item.id } })}
          style={({ pressed }) => pressed && { opacity: 0.75 }}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="cash-outline" size={20} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{dateRange(item.payPeriod.periodStart, item.payPeriod.periodEnd)}</Text>
              <Text style={{ fontSize: 14, color: colors.muted }}>Paid {shortDate(item.payPeriod.payDate)}</Text>
            </View>
            <Text style={{ fontSize: 17, fontWeight: '800', color: colors.ink }}>{money(item.grossPay)}</Text>
            <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
          </Card>
        </Pressable>
      )}
    />
  );
}
