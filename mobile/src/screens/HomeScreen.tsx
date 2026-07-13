import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { captureSample, getMetrics, inspectKnowledge } from "../lib/api";
import { MetricCard } from "../components/MetricCard";

const quickActions = [
  { kind: "note", label: "Capture note" },
  { kind: "wallet", label: "Capture wallet" },
  { kind: "notification", label: "Capture notification" },
  { kind: "email", label: "Capture email" },
] as const;

export function HomeScreen() {
  const [query, setQuery] = useState("Spotify");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof getMetrics>> | null>(null);
  const [insight, setInsight] = useState<Awaited<ReturnType<typeof inspectKnowledge>> | null>(null);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const response = await getMetrics();
        if (isMounted) {
          setMetrics(response);
        }
      } catch (error) {
        Alert.alert("Metrics unavailable", error instanceof Error ? error.message : "Unknown error");
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const metricCards = useMemo(() => {
    if (!metrics) {
      return [];
    }

    return [
      { label: "Raw events", value: metrics.rawEventsCount },
      { label: "Entities", value: metrics.entitiesCount },
      { label: "Relations", value: metrics.relationsCount },
      { label: "Linked events", value: metrics.eventEntitiesCount + metrics.eventRelationsCount },
    ];
  }, [metrics]);

  async function runInspect() {
    try {
      setBusyAction("inspect");
      const response = await inspectKnowledge(query);
      setInsight(response);
    } catch (error) {
      Alert.alert("Inspect failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setBusyAction(null);
    }
  }

  async function runCapture(kind: (typeof quickActions)[number]["kind"]) {
    try {
      setBusyAction(kind);
      await captureSample(kind);
      const response = await getMetrics();
      setMetrics(response);
      Alert.alert("Captured", `${kind} sent to BrainIA`);
    } catch (error) {
      Alert.alert("Capture failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>BrainIA mobile shell</Text>
        <Text style={styles.title}>Capture, inspect, and review knowledge from the phone.</Text>
        <Text style={styles.subtitle}>
          Thin client, backend-first. The app talks to the same API and keeps the mobile surface focused.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Metrics</Text>
        {loading ? <ActivityIndicator color="#f59e0b" /> : null}
        <View style={styles.metricRow}>
          {metricCards.map((card) => (
            <MetricCard key={card.label} label={card.label} value={card.value} />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Inspect</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search knowledge"
          placeholderTextColor="#6b7280"
          style={styles.input}
        />
        <Pressable style={styles.primaryButton} onPress={runInspect}>
          <Text style={styles.buttonText}>{busyAction === "inspect" ? "Inspecting..." : "Run inspect"}</Text>
        </Pressable>

        {insight ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{insight.summary ?? "No summary available"}</Text>
            <Text style={styles.panelText}>
              {insight.graphSummary
                ? `${insight.graphSummary.nodesCount} nodes, ${insight.graphSummary.relationsCount} relations, ${insight.graphSummary.pathCount} paths`
                : "No graph summary available"}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick capture</Text>
        <View style={styles.actionGrid}>
          {quickActions.map((action) => (
            <Pressable
              key={action.kind}
              style={styles.secondaryButton}
              onPress={() => runCapture(action.kind)}
            >
              <Text style={styles.secondaryButtonText}>
                {busyAction === action.kind ? "Sending..." : action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#0b1020",
    padding: 20,
    gap: 20,
  },
  hero: {
    paddingTop: 24,
    paddingBottom: 8,
    gap: 12,
  },
  kicker: {
    color: "#f59e0b",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    fontSize: 12,
    fontWeight: "700",
  },
  title: {
    color: "#f9fafb",
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "800",
  },
  subtitle: {
    color: "#cbd5e1",
    fontSize: 16,
    lineHeight: 24,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: "#f9fafb",
    fontSize: 18,
    fontWeight: "700",
  },
  metricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  input: {
    backgroundColor: "#111827",
    color: "#f9fafb",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  primaryButton: {
    backgroundColor: "#f59e0b",
    borderRadius: 16,
    alignItems: "center",
    paddingVertical: 14,
  },
  buttonText: {
    color: "#111827",
    fontWeight: "800",
  },
  panel: {
    backgroundColor: "#111827",
    borderRadius: 20,
    padding: 16,
    gap: 8,
  },
  panelTitle: {
    color: "#f9fafb",
    fontSize: 16,
    fontWeight: "700",
  },
  panelText: {
    color: "#cbd5e1",
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  secondaryButton: {
    backgroundColor: "#1f2937",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: "#f9fafb",
    fontWeight: "700",
  },
});
