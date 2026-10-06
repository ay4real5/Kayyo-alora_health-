import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Card, ErrorText, SectionTitle, colors, styles } from '@/components/ui';
import { errorMessage, useAuth } from '@/lib/auth-context';
import { dateRange, money, shortDate, type PayStub } from '@/lib/extras';
import { humanize } from '@/lib/visits';

/** One pay stub: totals, then each visit line. Gross pay — taxes are handled by the agency's payroll provider. */
export default function PayStubScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { request } = useAuth();
  const [stub, setStub] = useState<PayStub | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<PayStub>(`/payroll/pay-stubs/${id}`)
      .then(({ data }) => setStub(data))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id, request]);

  if (!stub) {
    return (
      <View style={styles.screen}>
        <ErrorText>{error}</ErrorText>
        {!error && <Text style={styles.subtitle}>Loading…</Text>}
      </View>
    );
  }

  const rows: [string, number, string?][] = [
    ['Regular', stub.regularPay, `${stub.regularHours} h`],
    ['Overtime', stub.overtimePay, `${stub.overtimeHours} h`],
    ['Per-visit pay', stub.perVisitPay],
    ['Mileage', stub.mileageAmount, `${stub.mileageMiles} mi`],
    ['Bonus', stub.bonusAmount],
  ];

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}>
      <Stack.Screen options={{ title: dateRange(stub.payPeriod.periodStart, stub.payPeriod.periodEnd) }} />
      <Card style={{ backgroundColor: colors.indigo, gap: 4, paddingVertical: 20 }}>
        <Text style={{ color: '#9aeedd', fontSize: 14 }}>Gross pay</Text>
        <Text style={{ color: colors.white, fontSize: 34, fontWeight: '800' }}>{money(stub.grossPay)}</Text>
        <Text style={{ color: '#9aeedd', fontSize: 14 }}>
          Paid {shortDate(stub.payPeriod.payDate)} · {stub.visitCount} visits
        </Text>
      </Card>

      <SectionTitle>Breakdown</SectionTitle>
      <Card style={{ paddingVertical: 8 }}>
        {rows
          .filter(([, amount]) => amount !== 0)
          .map(([label, amount, detail]) => (
            <Line key={label} label={label} detail={detail} amount={money(amount)} />
          ))}
        {stub.deductions !== 0 && <Line label="Deductions" amount={`−${money(stub.deductions)}`} />}
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4, paddingTop: 8 }}>
          <Line label="Total" amount={money(stub.grossPay)} bold />
        </View>
      </Card>
      {stub.notes ? <Text style={styles.subtitle}>Note from the office: {stub.notes}</Text> : null}

      <SectionTitle>Visits</SectionTitle>
      <Card style={{ paddingVertical: 8 }}>
        {stub.lines.length === 0 && <Text style={{ color: colors.muted }}>No visit lines.</Text>}
        {stub.lines.map((l) => (
          <Line
            key={l.id}
            label={`${shortDate(l.serviceDate)}${l.patientLabel ? ` · ${l.patientLabel}` : ''}`}
            detail={l.hours !== null ? `${l.hours} h${l.rate !== null ? ` × ${money(l.rate)}` : ''}` : humanize(l.payType)}
            amount={money(l.amount)}
          />
        ))}
      </Card>
      <Text style={[styles.subtitle, { fontSize: 13 }]}>
        This is gross pay before taxes. Your payroll provider sends the official statement. Questions? Message the office.
      </Text>
    </ScrollView>
  );
}

function Line({ label, detail, amount, bold }: { label: string; detail?: string; amount: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: bold ? '800' : '500', color: colors.text }}>{label}</Text>
        {detail ? <Text style={{ fontSize: 13, color: colors.muted }}>{detail}</Text> : null}
      </View>
      <Text style={{ fontSize: 15, fontWeight: bold ? '800' : '600', color: colors.ink }}>{amount}</Text>
    </View>
  );
}
