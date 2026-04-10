import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Box, Text } from 'ink';
export function CommandBar({ value, width, }) {
    const placeholder = 'Enter command';
    const hasValue = value.length > 0;
    const shownValue = hasValue ? value.slice(-60) : '';
    return (_jsxs(Box, { width: width, borderStyle: "round", borderColor: "#5b5b5b", paddingX: 0, paddingY: 0, flexDirection: "row", children: [_jsx(Text, { color: "#8be9fd", bold: true, children: "\u00A0>\u00A0" }), !hasValue ? (_jsxs(Text, { color: "#c9d1d9", children: [_jsx(Text, { backgroundColor: "#8be9fd", color: "#1f1f1f", children: placeholder[0] }), placeholder.slice(1)] })) : (_jsxs(Text, { color: "#c9d1d9", children: [shownValue, _jsx(Text, { color: "#8be9fd", children: "\u258C" })] }))] }));
}
