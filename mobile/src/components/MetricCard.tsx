import { StyleSheet, Text, View } from "react-native";

type MetricCardProps = {
  label: string;
  value: number | string;
};

export function MetricCard({ label, value }: MetricCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#111827",
    borderRadius: 20,
    padding: 16,
    minWidth: 120,
  },
  value: {
    color: "#f9fafb",
    fontSize: 28,
    fontWeight: "700",
  },
  label: {
    color: "#9ca3af",
    marginTop: 6,
    fontSize: 13,
  },
});
