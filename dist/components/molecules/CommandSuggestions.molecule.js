import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Box, Text } from 'ink';
export function CommandSuggestions({ suggestions, selectedIndex, }) {
    if (suggestions.length === 0) {
        return null;
    }
    const visibleCount = 6;
    const maxStartIndex = Math.max(0, suggestions.length - visibleCount);
    const startIndex = Math.min(maxStartIndex, Math.max(0, selectedIndex - Math.floor(visibleCount / 2)));
    const visibleSuggestions = suggestions.slice(startIndex, startIndex + visibleCount);
    return (_jsx(Box, { flexDirection: "column", paddingTop: 0, paddingLeft: 1, children: visibleSuggestions.map((suggestion, index) => {
            const absoluteIndex = startIndex + index;
            const isSelected = absoluteIndex === selectedIndex;
            return (_jsxs(Box, { flexDirection: "row", children: [_jsx(Box, { width: 12, marginRight: 2, children: _jsx(Text, { color: isSelected ? '#8be9fd' : '#8b949e', bold: isSelected, children: suggestion.command }) }), _jsx(Box, { flexGrow: 1, children: _jsx(Text, { color: isSelected ? '#f8f8f2' : '#c9d1d9', bold: isSelected, children: suggestion.description }) })] }, suggestion.command));
        }) }));
}
