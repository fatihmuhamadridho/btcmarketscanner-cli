import React from 'react';
import { Box, Text } from 'ink';

export function CommandSuggestions({
  suggestions,
  selectedIndex,
}: {
  suggestions: Array<{
    command: string;
    description: string;
  }>;
  selectedIndex: number;
}) {
  if (suggestions.length === 0) {
    return null;
  }

  const visibleCount = 6;
  const maxStartIndex = Math.max(0, suggestions.length - visibleCount);
  const startIndex = Math.min(
    maxStartIndex,
    Math.max(0, selectedIndex - Math.floor(visibleCount / 2)),
  );
  const visibleSuggestions = suggestions.slice(startIndex, startIndex + visibleCount);

  return (
    <Box flexDirection="column" paddingTop={0} paddingLeft={1}>
      {visibleSuggestions.map((suggestion, index) => {
        const absoluteIndex = startIndex + index;
        const isSelected = absoluteIndex === selectedIndex;
        return (
          <Box key={suggestion.command} flexDirection="row">
            <Box width={12} marginRight={2}>
              <Text color={isSelected ? '#7ee7ff' : '#8b949e'} bold={isSelected}>
                {suggestion.command}
              </Text>
            </Box>
            <Box flexGrow={1}>
              <Text color={isSelected ? '#7ee7ff' : '#8b949e'} bold={isSelected}>
                {suggestion.description}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
