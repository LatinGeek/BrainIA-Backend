import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native";
import { HomeScreen } from "./src/screens/HomeScreen";

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0b1020" }}>
      <StatusBar style="light" />
      <HomeScreen />
    </SafeAreaView>
  );
}
