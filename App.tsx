import React from "react";
import { View, StyleSheet } from "react-native";
import MapScreen from "./src/screens/MapScreen";

export default function App() {
  return (
    <View style={Style.container}>
      <MapScreen />
    </View>
  )
}
const Style = StyleSheet.create({
  container: {
    flex: 1,

  },
})