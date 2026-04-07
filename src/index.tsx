import React, { useEffect, useState } from "react";
import { render, Box, Text, useApp, useInput } from "ink";

function App() {
  const { exit } = useApp();
  const [tick, setTick] = useState(0);

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      exit();
    }
  });

  useEffect(() => {
    const id = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(id);
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" paddingX={1} paddingY={0}>
        <Text bold>AI Agent Terminal Starter</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text>Terminal UI sudah kebuka ✅</Text>
        <Text>Detik berjalan: {tick}</Text>
        <Text dimColor>Tekan q atau esc untuk keluar</Text>
      </Box>
    </Box>
  );
}

render(<App />);
